import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Journal from '../components/Journal';
import Warmup from '../components/Warmup';
import ActivityAnnouncements from '../components/ActivityAnnouncements';
import type { WarmupView } from '../../shared/warmup';
import { IDENTITY_NAMES } from '../../shared/warmupKinds';
import NamePicker from '../components/NamePicker';
import HelpRequest from '../components/HelpRequest';
import { LevelBar, Rewards } from '../components/LevelBar';
import { DEFAULT_STYLE, emotesFor, levelOf, type Style } from '../../shared/levels';
import { correctedSentence, readCorrection, wordDiff } from '../../shared/diff';
import Correction from '../components/Correction';
import { firstName } from '../../shared/names';
import { ALL, NEAR, TEACHER, TYPING_EVERY_MS, TYPING_SHOWN_MS, conversationOf, inEarshot, opensItself, partnerOf, privateChat, renamedTogether } from '../../shared/chat';
import PhaserGame from '../components/PhaserGame';
import type { QuestView } from '../../shared/campaign';
import type { StudentSupport } from '../../shared/support';
import { PlazaConnection } from '../plaza';
import { messageId } from '../utils/messageId';
import { loadChecker } from '../spellingData';
import type { Checker, Misspelling } from '../spelling';
import type { PlazaPlayer, PlazaStatus } from '../plaza';
import { readStudentSession } from '../studentAuth';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import Face from '../components/Face';
import { shade } from '../utils/shade';
import { GameAudio, soundIsMuted, unlockSound, type SoundState } from '../audio';
import './Game.css';

interface GameState {
  roomCode: string;
  avatarConfig: AvatarConfig | null; // null keeps the saved avatar
}

interface ChatMessage {
  id?: string;
  sender: string;
  text: string;
  at: number; // when it was said, by the server's clock: conversations are in this order
  timestamp?: number;
  whisper?: boolean;
  to?: string;
  all?: boolean; // for everyone in the plaza
  marks?: [number, number][]; // words the sender was offered a better version of and kept
  teacher?: boolean;
  voice?: string;
  conv?: string; // a notice belongs to the conversation it answers; '*' shows in every one
  heard?: number; // on the student's own message: how many classmates it reached
  waiting?: boolean; // the student's own message, still with the teacher
  declined?: boolean; // the student's own message, which the teacher did not post
  read?: boolean; // seen before the page was reloaded: never counted as new
}

type Typing = { scope: 'private' | 'nearby' | 'all'; until: number };

// Text with some character ranges wrapped, so a changed or mistaken word can have its own shade.
function Marked({ text, marks, className }: { text: string; marks?: readonly (readonly [number, number])[]; className: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of [...(marks ?? [])].sort((a, b) => a[0] - b[0])) {
    if (start < at || end > text.length) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start} className={className}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

// What became of the student's own message, in the marks messaging apps use: a clock while it waits
// for the teacher, one tick when nobody got it, two when someone did, a cross when it was not posted.
function Ticks({ message, conversation }: { message: ChatMessage; conversation: string }) {
  const group = conversation === NEAR || conversation === ALL;
  if (message.declined) return <span className="chat-ticks chat-ticks-no" title="Your teacher did not post this">✕</span>;
  if (message.waiting) return <span className="chat-ticks" title="Waiting for your teacher">🕓</span>;
  if (!message.heard) {
    const why = message.heard === undefined ? 'Sent' : conversation === NEAR ? 'Nobody was near enough to get it' : group ? 'Nobody else is in the Plaza' : 'Not delivered';
    return <span className="chat-ticks" title={why}>✓</span>;
  }
  return <span className="chat-ticks chat-ticks-got" title={group ? `${message.heard} got it` : 'Delivered'}>✓✓{group && <small>{message.heard}</small>}</span>;
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};
const sameClassmates = (a: PlazaPlayer[], b: PlazaPlayer[]) => a.length === b.length && a.every((item, index) => item.id === b[index].id && item.name === b[index].name);

export default function Game() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as GameState | null;
  const [session] = useState(() => readStudentSession());
  const audioRef = useRef<GameAudio | null>(null);
  const [sound, setSound] = useState<SoundState>(() => ({
    muted: session ? soundIsMuted(session.student.studentKey) : false,
    locked: false, messageId: null, needsInteraction: false, error: '',
  }));
  // Shown as the first name, with a surname letter added when a classmate shares it; the plaza tells us which.
  const [myName, setMyName] = useState(() => firstName(readStudentSession()?.student.displayName ?? ''));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  // A grammar hint waiting for the student's choice: what they wrote, the fix, and why.
  const [nudge, setNudge] = useState<{ original: string; corrected: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // A message on its way: the draft stays in the box until the server says it took it.
  const [sending, setSending] = useState(false);
  const [warmup, setWarmup] = useState<WarmupView | null>(null); // the opening warm-up, while the teacher has it on
  const [warmupFeedback, setWarmupFeedback] = useState<{ correct: boolean; wait: boolean } | null>(null);
  const warmupVocabulary = useRef<string[]>([]);
  const [alias, setAlias] = useState<{ name: string; kept: boolean } | null>(null); // set when this game gives made-up names
  const [quest, setQuest] = useState<QuestView | null>(null); // this student's part of the campaign, if one is running
  const [gameId, setGameId] = useState('');
  const [answered, setAnswered] = useState<{ objective: string; correct: boolean; wait: boolean } | null>(null);
  const [sendError, setSendError] = useState(''); // why the last message did not go, shown by the box
  const [support, setSupport] = useState<StudentSupport>({ request: null, messages: [] });
  const teacherMessageIds = useRef(new Set<string>());
  const submissionAttemptId = useRef<string | null>(null);
  const plazaRef = useRef<PlazaConnection | null>(null);
  const pending = useRef<{ cid: string; text: string; timer: number; conv: string } | null>(null);
  const keptRun = useRef(0); // hints in a row the student turned down
  const chatField = useRef<HTMLInputElement>(null);
  const [spelling, setSpelling] = useState<Misspelling[]>([]); // words that stopped the last message
  const [blockedRun, setBlockedRun] = useState(0); // messages stopped in a row by the word check
  // The conversations (see NEAR in shared/chat): the one open, private chats begun before anything was said in
  // them (and when), and the newest message read in each.
  const [active, setActive] = useState(NEAR);
  const [started, setStarted] = useState<Record<string, number>>({});
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const [showPeople, setShowPeople] = useState(false); // the faces for starting a private chat
  const [classmates, setClassmates] = useState<PlazaPlayer[]>([]); // everyone else here, nearest first
  const [earshot, setEarshot] = useState<string[]>([]); // who would hear nearby chat right now
  const [typing, setTyping] = useState<Record<string, Typing>>({}); // classmates writing a message that will reach this student, by id
  const [peek, setPeek] = useState<{ key: string; message: ChatMessage } | null>(null); // a private message that came while another chat was open
  // Who the open conversation is with, and where its messages go.
  const partnerName = partnerOf(active);
  const partner = partnerName ? classmates.find(classmate => classmate.name === partnerName) ?? null : null;
  const whisperTo = active === TEACHER ? 'teacher' : active === ALL ? 'everyone' : partnerName ? partner?.id ?? '' : '';
  const activeRef = useRef(NEAR);
  useEffect(() => { activeRef.current = active; }, [active]);
  // Something is being written or checked: nothing may switch the conversation under it.
  const composing = useRef(false);
  useEffect(() => { composing.current = !!chatInput || !!nudge || spelling.length > 0 || checking || sending; }, [chatInput, nudge, spelling.length, checking, sending]);
  const newest = useRef<Record<string, number>>({}); // the time of the newest message in each conversation
  const clock = useRef(0); // the server's clock minus this computer's, so notices fall in place among messages
  // Where "is writing" goes: the open conversation, nowhere for the teacher or a classmate who left.
  const typingTo = useRef<string | null>('');
  useEffect(() => { typingTo.current = whisperTo === 'teacher' || (partnerName && !partner) ? null : whisperTo; }, [whisperTo, partnerName, partner]);
  const typedAt = useRef(0);
  // Experience and levels: the bar at the bottom, and the look the levels unlock.
  const [xp, setXp] = useState(0);
  const [xpReason, setXpReason] = useState<string | undefined>();
  const [myStyle, setMyStyle] = useState<Style>(DEFAULT_STYLE);
  const [showRewards, setShowRewards] = useState(false);
  const [connection, setConnection] = useState<PlazaConnection | null>(null);
  const [status, setStatus] = useState<PlazaStatus>({ state: 'connecting' });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  // The chat box can be dragged out of the way of the map and folded away; it remembers where.
  const [chatSpot, setChatSpot] = useState<{ x: number; y: number; folded: boolean }>(() => {
    try { return { x: 0, y: 0, folded: false, ...JSON.parse(localStorage.getItem('pixelplaza.chat') || '{}') }; }
    catch { return { x: 0, y: 0, folded: false }; }
  });
  useEffect(() => {
    try { localStorage.setItem('pixelplaza.chat', JSON.stringify(chatSpot)); } catch { /* storage disabled */ }
  }, [chatSpot]);

  // Which conversation a message belongs to, and what is new in each.
  const convOf = (message: ChatMessage) => conversationOf(message, myName);
  const byConv = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const key = convOf(message);
    const list = byConv.get(key);
    if (list) list.push(message); else byConv.set(key, [message]);
  }
  for (const list of byConv.values()) list.sort((a, b) => a.at - b.at);
  const fromOthers = (message: ChatMessage) => !message.sender.startsWith('System') && message.sender !== myName && !message.read;
  const newIn = (key: string) => (byConv.get(key) ?? []).filter(message => fromOthers(message) && message.at > (lastSeen[key] ?? 0));
  // The open conversation counts as read; new messages in the others (or in all of them, folded) pile up.
  const openNewest = byConv.get(active)?.at(-1)?.at ?? 0;
  useEffect(() => {
    if (!chatSpot.folded && openNewest) setLastSeen(seen => (seen[active] ?? 0) >= openNewest ? seen : { ...seen, [active]: openNewest });
  }, [chatSpot.folded, active, openNewest]);
  const waitingKeys = [...byConv.keys()].filter(key => key !== '*' && (chatSpot.folded || key !== active));
  const unread = waitingKeys.reduce((sum, key) => sum + newIn(key).length, 0);
  const latest = chatSpot.folded ? waitingKeys.flatMap(newIn).sort((a, b) => b.at - a.at)[0] : undefined;

  // The conversation list: the ones always there (nearby, everyone, the teacher) in fixed places at the top, then the
  // private chats with the newest on top, right under the button that starts one.
  const privates = new Map<string, number>(Object.entries(started));
  for (const [key, list] of byConv) if (partnerOf(key)) privates.set(key, Math.max(privates.get(key) ?? 0, list.at(-1)?.at ?? 0));
  // Someone writing privately for the first time shows up at once, on top, before their message arrives.
  for (const [id, item] of Object.entries(typing)) {
    const name = item.scope === 'private' ? classmates.find(classmate => classmate.id === id)?.name : undefined;
    if (name && !privates.has(privateChat(name))) privates.set(privateChat(name), Number.MAX_SAFE_INTEGER);
  }
  const pinned = [NEAR, ALL, TEACHER];
  const chats = [...privates].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  // Who is writing in a conversation right now.
  const writers = (key: string): string[] => Object.keys(typing).flatMap(id => {
    const name = classmates.find(classmate => classmate.id === id)?.name;
    const scope = typing[id].scope;
    return name && (key === NEAR ? scope === 'nearby' : key === ALL ? scope === 'all' : scope === 'private' && key === privateChat(name)) ? [name] : [];
  });

  // "Is writing" runs out a little after the last report.
  useEffect(() => {
    const next = Math.min(...Object.values(typing).map(item => item.until));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setTyping(current => Object.fromEntries(Object.entries(current).filter(([, item]) => item.until > Date.now()))),
      Math.max(0, next - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [typing]);
  // A private message announced at the top of the chat goes away by itself; its conversation keeps it as new.
  useEffect(() => {
    if (!peek) return;
    const timer = window.setTimeout(() => setPeek(null), 12000);
    return () => window.clearTimeout(timer);
  }, [peek]);

  // Classmates see "is writing" while a message for them is on its way, so they wait for it.
  const reportTyping = useCallback(() => {
    const to = typingTo.current;
    if (to === null || Date.now() - typedAt.current < TYPING_EVERY_MS) return;
    if (plazaRef.current?.send({ t: 'typing', ...(to ? { to } : {}) })) typedAt.current = Date.now();
  }, []);
  // It stays on while the student checks a hint or the message is on its way.
  useEffect(() => {
    if (!nudge && !checking && !sending) return;
    const timer = window.setInterval(reportTyping, TYPING_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [nudge, checking, sending, reportTyping]);

  // A click on a classmate on the map opens a private chat with them.
  const pick = useRef<(id: string) => void>(() => {});
  const onPick = useCallback((id: string) => pick.current(id), []);

  // Enter jumps to the chat box from the map, and Escape leaves it, so a student never needs the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field = chatField.current;
      if (!field || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
      if (event.key === 'Enter' && !typing) { event.preventDefault(); field.focus(); }
      else if (event.key === 'Escape' && document.activeElement === field) field.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dragChat = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = chatBox.current;
    if (!box || (event.target as HTMLElement).closest('button')) return;
    const home = box.getBoundingClientRect(); // where it sits now, with the current offset
    const start = { x: event.clientX, y: event.clientY, spotX: chatSpot.x, spotY: chatSpot.y };
    const move = (next: PointerEvent) => {
      // Keep the whole box on screen
      const x = Math.min(Math.max(start.spotX + next.clientX - start.x, start.spotX - home.left), start.spotX + window.innerWidth - home.right);
      const y = Math.min(Math.max(start.spotY + next.clientY - start.y, start.spotY - home.top), start.spotY + window.innerHeight - home.bottom);
      setChatSpot(spot => ({ ...spot, x, y }));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  useEffect(() => {
    // Joining normally unlocks sound. These gestures also cover refreshed game
    // tabs where the browser requires a fresh interaction before autoplay.
    const enable = () => { if (audioRef.current && !audioRef.current.snapshot.muted) unlockSound(); };
    window.addEventListener('pointerdown', enable, true);
    window.addEventListener('keydown', enable, true);
    return () => {
      window.removeEventListener('pointerdown', enable, true);
      window.removeEventListener('keydown', enable, true);
    };
  }, []);

  useEffect(() => {
    if (!state?.roomCode || !session) {
      navigate('/');
      return;
    }

    const plaza = new PlazaConnection(state.roomCode, session.studentToken, state.avatarConfig, session.student.studentKey);
    const audio = new GameAudio(session.studentToken, session.student.studentKey);
    audioRef.current = audio;
    const unhear = audio.subscribe(setSound);
    plazaRef.current = plaza;
    const me = () => plaza.players.get(plaza.selfId)?.name ?? '';
    const names = new Map<string, string>(); // player id to the name shown, to follow a rename
    // Classmates nearest first, for the faces to start a chat with, and who would hear nearby chat.
    const findClassmates = () => {
      const self = plaza.players.get(plaza.selfId);
      if (!self) return;
      const others = [...plaza.players.values()].filter(player => player.id !== self.id)
        .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
      setClassmates(current => sameClassmates(current, others) ? current : others.map(player => ({ ...player })));
      const near = inEarshot(self, others).map(player => player.name);
      setEarshot(current => current.join('\n') === near.join('\n') ? current : near);
    };
    const nearestTimer = window.setInterval(findClassmates, 1000);
    // Adds a message, or turns one waiting for the teacher into the message as posted, in its place.
    const say = (message: Omit<ChatMessage, 'at'> & { at?: number }): ChatMessage => {
      const line = { ...message, at: message.at ?? Date.now() + clock.current };
      const key = conversationOf(line, me());
      newest.current[key] = Math.max(newest.current[key] ?? 0, line.at);
      setMessages(prev => {
        const index = line.id ? prev.findIndex(item => item.id === line.id) : -1;
        if (index < 0) return [...prev, line];
        if (!prev[index].waiting) return prev; // already shown: a replay
        const next = [...prev];
        next[index] = { ...line, at: prev[index].at };
        return next;
      });
      return line;
    };
    // A private message for a conversation that is not open opens by itself when nothing is being written and the
    // open one has gone quiet; otherwise it is announced at the top of the chat. The group chats only count as new.
    const arrived = (key: string, line: ChatMessage) => {
      const open = activeRef.current;
      if (key === open || (key !== TEACHER && !partnerOf(key))) return;
      if (opensItself({ from: key, open, writing: composing.current, lastInOpen: newest.current[open] ?? 0, now: Date.now() + clock.current })) {
        setActive(key);
        setShowPeople(false);
        setPeek(null);
      } else setPeek({ key, message: line });
    };
    let joinedGame = '';
    const unsubscribe = plaza.subscribe(event => {
      if (event.t === 'roster' && plaza.gameId !== joinedGame) {
        joinedGame = plaza.gameId;
        setGameId(joinedGame);
        setQuest(null); setWarmup(null); setAlias(null);
      }
      if (event.t === 'sound') { audio.setLocked(event.off); return; }
      if (event.t === 'magic' && event.power === 'lightning') audio.thunder();
      if (event.t === 'xp') { setXpReason(event.reason); setXp(event.xp); return; }
      if (event.t === 'roster' || (event.t === 'style' && event.id === plaza.selfId)) setMyStyle(plaza.players.get(plaza.selfId)?.style ?? DEFAULT_STYLE);
      // A namesake arrived: the messages of whoever was renamed, and the chat with them, follow the new name.
      if (event.t === 'rename' || event.t === 'names') {
        const before = event.t === 'rename' ? names.get(event.id) : null;
        const changes = new Map(event.t === 'names' ? event.changes.map(c => [c.from, c.name]) : before ? [[before, event.name]] : []);
        if (event.t === 'names') setAlias(null);
        if (changes.size) {
          const move = (key: string) => { const partner = partnerOf(key); return partner && changes.has(partner) ? privateChat(changes.get(partner)!) : key; };
          const moveKeys = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [move(key), value]));
          setMessages(prev => renamedTogether(prev, changes));
          setActive(move);
          setStarted(moveKeys);
          setLastSeen(moveKeys);
          newest.current = moveKeys(newest.current);
          setPeek(prev => prev && { key: move(prev.key), message: renamedTogether([prev.message], changes)[0] });
          if (pending.current) pending.current.conv = move(pending.current.conv);
        }
      }
      if (event.t === 'roster' || event.t === 'join' || event.t === 'leave' || event.t === 'rename' || event.t === 'names') {
        const self = plaza.players.get(plaza.selfId ?? '');
        if (self) setMyName(self.name);
        names.clear();
        for (const player of plaza.players.values()) names.set(player.id, player.name);
        findClassmates();
      }
      if (event.t === 'typing') {
        setTyping(current => ({ ...current, [event.id]: { scope: event.scope, until: Date.now() + TYPING_SHOWN_MS } }));
        return;
      }
      // What became of the message being sent. A refusal gives the draft back, with the reason beside it.
      const settled = (event.t === 'notice' || event.t === 'result') && !!event.cid && event.cid === pending.current?.cid;
      if (settled && pending.current) {
        const sent = pending.current;
        window.clearTimeout(sent.timer);
        pending.current = null;
        setSending(false);
        if (event.t === 'notice' && event.level === 'warning') {
          setChatInput(sent.text);
          setSendError(event.text);
          return;
        }
        setChatInput('');
        setSendError('');
        chatField.current?.blur(); // sent: the keys walk again until Enter opens the box
        // Waiting for the teacher: it shows in its conversation, with a clock, until the teacher decides.
        if (event.t === 'notice' && event.id) {
          say({ id: event.id, sender: me(), text: sent.text, conv: sent.conv, waiting: true });
          return;
        }
      }
      if (event.t === 'result') return;
      if (event.t === 'support') {
        setSupport(event.support);
        const unseen = event.support.messages.filter(message => !teacherMessageIds.current.has(message.id));
        for (const message of unseen) {
          teacherMessageIds.current.add(message.id);
          say({ id: `teacher:${message.id}`, sender: 'Teacher', text: message.text, timestamp: message.timestamp, at: message.timestamp, teacher: true, read: !!event.history });
        }
        // The teacher writing opens the chat on it, unless the student is in the middle of writing something.
        if (unseen.length && !event.history) {
          setChatSpot(spot => ({ ...spot, folded: false }));
          if (composing.current) setPeek({ key: TEACHER, message: { sender: 'Teacher', text: unseen.at(-1)!.text, at: unseen.at(-1)!.timestamp, teacher: true } });
          else { setActive(TEACHER); setShowPeople(false); }
        }
        return;
      }
      if (event.t === 'warmup') {
        warmupVocabulary.current = event.vocabulary ?? event.warmup?.vocabulary ?? warmupVocabulary.current;
        setWarmup(event.warmup); setWarmupFeedback(null); return;
      }
      if (event.t === 'warmup-answered') {
        setWarmupFeedback({ correct: event.correct, wait: event.wait });
        if (event.correct && !event.wait) audio.goal();
        return;
      }
      if (event.t === 'alias') { setAlias({ name: event.name, kept: event.kept }); return; }
      if (event.t === 'quest') { setQuest(event.quest); setAnswered(null); return; }
      if (event.t === 'answered') {
        setAnswered({ objective: event.objective, correct: event.correct, wait: event.wait });
        if (event.correct && !event.wait) audio.goal();
        return;
      }
      if (event.t === 'chat') {
        if (!event.history && typeof event.ts === 'number') clock.current = event.ts - Date.now();
        const mine = event.sender === me();
        const line = say({ id: event.id, sender: event.sender, text: event.text, timestamp: event.ts, at: event.ts, whisper: event.whisper, to: event.to, all: event.all,
          heard: event.heard, marks: event.marks, voice: event.voice, read: event.history });
        // Read aloud as it arrives, except the whole plaza's chatter while another conversation is open.
        if (event.id) audio.receive(event.id, !!event.history || (!!event.all && !mine && activeRef.current !== ALL));
        // Whoever was writing has written.
        const speaker = [...plaza.players.values()].find(player => player.name === event.sender);
        if (speaker) setTyping(current => without(current, speaker.id));
        if (!mine && !event.history && event.sender !== 'System') arrived(conversationOf(line, me()), line);
      }
      else if (event.t === 'retract') {
        audio.retract(event.id);
        setMessages(prev => prev.filter(message => message.id !== event.id));
      }
      // The teacher's decision on a message that was waiting shows on the message itself.
      else if (event.t === 'notice' && event.id && event.level === 'info') {
        const at = Date.now() + clock.current;
        setMessages(prev => {
          const index = prev.findIndex(message => message.id === event.id);
          if (index < 0) return [...prev, { sender: 'System', text: event.text, conv: activeRef.current, at }];
          if (!prev[index].waiting) return prev; // approved: it is there, posted
          const next = [...prev];
          next[index] = { ...prev[index], waiting: false, declined: true };
          return next;
        });
      }
      else if (event.t === 'notice') say({ sender: event.level === 'warning' ? 'System Warning' : 'System', text: event.text, conv: activeRef.current });
    });
    const unwatch = plaza.onStatus(next => {
      setStatus(next);
      if (next.state !== 'online') audio.stop();
      if (next.state === 'online') setConnection(plaza); // the map appears once connected
      if (next.state === 'stopped' && next.message) say({ sender: 'System Warning', text: next.message, conv: '*' });
    });

    return () => {
      window.clearInterval(nearestTimer);
      unsubscribe();
      unwatch();
      unhear();
      audio.dispose();
      if (audioRef.current === audio) audioRef.current = null;
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
      if (plazaRef.current === plaza) plazaRef.current = null;
      plaza.close();
    };
  }, [state, session, navigate]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, active, typing]);

  // Opens a conversation, leaving whatever the last one was being told.
  const choose = (key: string) => {
    if (checking || sending) return;
    if (partnerOf(key) && !byConv.has(key)) setStarted(current => key in current ? current : { ...current, [key]: Date.now() + clock.current });
    setActive(key);
    setShowPeople(false);
    setPeek(current => current?.key === key ? null : current);
    setNudge(null);
    setSpelling([]);
    setSendError('');
    submissionAttemptId.current = null;
  };
  // Opening a chat to talk in it: the box unfolds and takes the keys.
  const talk = (key: string) => {
    setChatSpot(spot => ({ ...spot, folded: false }));
    choose(key);
    window.requestAnimationFrame(() => chatField.current?.focus());
  };
  useEffect(() => {
    pick.current = id => { const name = plazaRef.current?.players.get(id)?.name; if (name) talk(privateChat(name)); };
  });

  if (!state?.roomCode || !session) return null;

  const sendRecorded = (plaza: PlazaConnection, message: object, attemptId: string): boolean => {
    const sent = plaza.send(message);
    if (!sent) plaza.recordAttemptOutcome(attemptId, 'not-sent', 'Not connected; this submission did not reach its recipient.');
    return sent;
  };

  // Sends a message; `extra` tells the teacher what the student did with a hint.
  const deliver = (text: string, extra: object = {}) => {
    const plaza = plazaRef.current;
    if (!plaza) return;
    const cid = messageId();
    const attemptId = submissionAttemptId.current;
    const message = { t: 'chat', text, cid, ...(attemptId ? { attemptId } : {}), ...(whisperTo ? { to: whisperTo } : {}), ...extra };
    if (attemptId ? sendRecorded(plaza, message, attemptId) : plaza.send(message)) {
      // The draft stays (as what is being sent) until the server answers.
      setChatInput(text);
      setNudge(null);
      setSpelling([]);
      setBlockedRun(0);
      setSendError('');
      setSending(true);
      const timer = window.setTimeout(() => {
        pending.current = null;
        setSending(false);
        setSendError('No answer from the server. Your message is still here; check the chat before sending it again.');
      }, 15000);
      pending.current = { cid, text, timer, conv: active };
    } else setSendError('Not connected. Your message is still here; try again in a moment.');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const plaza = plazaRef.current;
    if (!chatInput.trim() || !plaza || checking || sending || nudge) return;
    if (partnerName && !partner) { setSendError(`${partnerName} is not in the Plaza now.`); return; }
    const text = chatInput;
    const attemptId = plaza.recordAttempt(text, whisperTo || undefined);
    submissionAttemptId.current = attemptId;
    // Asking a teacher for help must still work when a student cannot write in English.
    if (whisperTo === 'teacher') return deliver(text);
    setChecking(true);
    try {
      // Every word must be English. Names of people in the Plaza are fine.
      // If the dictionary cannot load, chat carries on rather than stopping.
      // Names of classmates and of the famous people in the "Who am I?" warm-up are fine.
      const names = [session.student.displayName, ...[...plaza.players.values()].map(player => player.name), ...plaza.classNames, ...IDENTITY_NAMES, ...warmupVocabulary.current];
      let check: Checker | null = null;
      try {
        check = await loadChecker();
        const problems = check(text, names);
        setSpelling(problems);
        if (problems.length) {
          setBlockedRun(run => run + 1);
          plaza.recordAttemptOutcome(attemptId, 'language-blocked', problems.some(problem => problem.banned)
            ? `Not allowed: ${problems.filter(problem => problem.banned).map(problem => problem.word).join(', ')}`
            : `English word check: ${problems.map(problem => problem.word).join(', ')}`);
          return;
        }
      } catch { /* offline dictionary: the teacher still reviews the message */ }

      // Then a grammar hint, once, and only if they have not been turning them all down.
      if (keptRun.current >= 3) { keptRun.current = 2; return deliver(text); }
      const hint = await plaza.check(text, attemptId);
      if (!hint.ok && (!check || check(hint.corrected, names).length === 0)) {
        setNudge({ original: text, corrected: hint.corrected });
        return;
      }
      keptRun.current = 0;
      deliver(text);
    } finally {
      setChecking(false);
    }
  };

  // OK sends the corrected sentence; Ignore (below) sends the student's own, with the words that differ marked.
  const useHint = () => {
    if (!nudge) return;
    keptRun.current = 0;
    deliver(nudge.corrected, { was: nudge.original });
  };

  const keepMine = () => {
    if (!nudge) return;
    keptRun.current += 1;
    deliver(nudge.original, { better: nudge.corrected });
  };

  // Swaps one word for a suggestion and takes it off the list.
  const applySuggestion = (word: string, suggestion: string) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    setChatInput(current => current.replace(new RegExp(`(?<![\\p{L}'’])${escaped}(?![\\p{L}'’])`, 'u'), suggestion));
    setSpelling(current => current.filter(item => item.word !== word));
  };

  const handlePreventClipboard = (e: React.ClipboardEvent) => {
    e.preventDefault();
  };

  const openTeacherChat = () => talk(TEACHER);

  const group = active === NEAR || active === ALL;
  const shown = [...(byConv.get(active) ?? []), ...(byConv.get('*') ?? [])].sort((a, b) => a.at - b.at);
  const writing = writers(active);
  const nameOf = (key: string) => key === NEAR ? 'Nearby' : key === ALL ? 'Everyone' : key === TEACHER ? 'Teacher' : partnerOf(key) ?? '';
  const iconOf = (key: string) => key === NEAR ? '👥' : key === ALL ? '📢' : key === TEACHER ? '🧑‍🏫' : undefined;
  const playerOf = (key: string) => classmates.find(classmate => classmate.name === partnerOf(key)) ?? null;
  const conversationButton = (key: string) => {
    const count = key === active ? 0 : newIn(key).length;
    const away = !!partnerOf(key) && !playerOf(key);
    return <button key={key} type="button" role="tab" aria-selected={key === active}
      className={`chat-conv${pinned.includes(key) ? ` chat-conv-${key}` : ''}${key === active ? ' active' : ''}${count ? ' chat-conv-new' : ''}${away ? ' chat-conv-away' : ''}`}
      aria-label={count ? `${nameOf(key)}, ${count} new` : nameOf(key)}
      title={key === NEAR ? 'Everyone close to you' : key === ALL ? 'Everyone in the Plaza' : key === TEACHER ? 'Only your teacher' : `Only ${nameOf(key)} (and your teacher)`}
      onClick={() => choose(key)}>
      <Face player={playerOf(key)} name={nameOf(key)} icon={iconOf(key)} />
      {count > 0 && <span className="chat-conv-count">{count > 9 ? '9+' : count}</span>}
      {writers(key).length > 0 && <span className="chat-conv-writing" aria-hidden="true">•••</span>}
      <span className="chat-conv-name">{nameOf(key)}</span>
    </button>;
  };

  return (
    <div className="game-container">
      {/* Background Phaser Canvas */}
      {connection && <PhaserGame connection={connection} onPick={onPick} />}

      {/* React UI Overlay */}
      <div className="ui-layer">
        <header className="game-header glass-panel">
          <h1 className="heading-pixel" style={{fontSize: '1.2rem', margin: 0}}>Pixel Plaza</h1>
          <div className="room-info">
            <span className="badge">Room: Lobby</span>
            <span className="badge">{myName}</span>
            {state.roomCode && <span className="badge">Class: {state.roomCode}</span>}
            {status.state !== 'online' && <span className="badge badge-status">
              {status.state === 'stopped' ? 'Disconnected' : status.state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>}
          </div>
          <ActivityAnnouncements key={`${session?.student.studentKey}:${gameId}`} quest={quest} warmup={warmup}
            storageKey={`pixelplaza.instructions.v1:${JSON.stringify([session?.student.studentKey, gameId || state.roomCode])}`}
            paused={status.state !== 'online' || !!(alias && !alias.kept)} />
          <button type="button" className="sound-toggle" aria-pressed={!sound.muted && !sound.locked} disabled={sound.locked}
            title={sound.locked ? 'Your teacher turned your sound off' : sound.muted ? 'Turn on chat voices and game sounds' : 'Mute chat voices and game sounds'}
            onClick={() => audioRef.current?.setMuted(!sound.muted)}>
            {sound.locked ? '🔒 Sound off' : sound.muted ? '🔇 Sound off' : '🔊 Sound on'}
          </button>
          {!sound.muted && !sound.locked && sound.needsInteraction && <button type="button" className="sound-enable" onClick={unlockSound}>Enable sound</button>}
          {!sound.muted && !sound.locked && sound.error && <p className="sound-error" role="status">{sound.error}</p>}
        </header>

        <LevelBar xp={xp} reason={xpReason} onOpen={() => setShowRewards(open => !open)} />
        {showRewards && <Rewards xp={xp} style={myStyle} onClose={() => setShowRewards(false)}
          onChoose={style => { setMyStyle(style); connection?.send({ t: 'style', ...style }); }} />}

        <HelpRequest support={support} online={status.state === 'online'} chatDraft={chatInput}
          onRequest={(topic, text, route) => {
            const plaza = plazaRef.current;
            if (!plaza) return false;
            const topics = { writing: 'I need help writing my ideas in English.', instructions: 'I need help understanding game instructions.',
              'classmate-message': "I need help understanding a classmate's message.", other: 'I need help.' };
            const attemptId = plaza.recordAttempt(text || topics[topic], 'teacher', 'help', topic);
            return sendRecorded(plaza, { t: 'help-request', topic, text, route, attemptId }, attemptId);
          }}
          onOpenChat={openTeacherChat} />

        {status.state === 'stopped' && status.message && <div className="class-ended glass-panel" role="alert">
          <p>{status.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Back to the start</button>
        </div>}

        {warmup && (!alias || alias.kept) && <Warmup warmup={warmup} feedback={warmupFeedback}
          onAnswer={text => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const attemptId = plaza.recordAttempt(text, undefined, 'warmup');
            sendRecorded(plaza, { t: 'warmup-answer', text, attemptId }, attemptId);
          }} />}

        {alias && !alias.kept && <NamePicker name={alias.name}
          onAnother={() => connection?.send({ t: 'reroll' })} onKeep={() => connection?.send({ t: 'keep' })} />}

        {quest && <Journal quest={quest} feedback={answered}
          onTurn={turn => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const interview = turn.t === 'interview-reply' ? quest.interviews?.find(item => item.id === turn.id) : undefined;
            const objective = turn.t === 'interview-ask' ? turn.objective : interview?.objective;
            const target = turn.t === 'interview-ask' ? turn.witness : [...plaza.players.values()].find(player => player.name === interview?.name)?.id;
            const attemptId = plaza.recordAttempt(turn.text, target, 'interview', objective);
            sendRecorded(plaza, { ...turn, attemptId }, attemptId);
          }}
          onAccept={(objective, changePartner) => connection?.send({ t: 'quest-accept', objective, changePartner })}
          onAnswer={(objective, text) => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const attemptId = plaza.recordAttempt(text, undefined, 'answer', objective);
            sendRecorded(plaza, { t: 'answer', objective, text, attemptId }, attemptId);
          }} />}

        <div className={`chat-container glass-panel${chatSpot.folded ? ' chat-folded' : ''}`} ref={chatBox}
          style={{ transform: `translate(${chatSpot.x}px, ${chatSpot.y}px)` }}>
          <div className="chat-handle" onPointerDown={dragChat} title="Drag to move the chat">
            <span className={unread ? 'chat-unread' : undefined}>
              {unread ? `Chat · ${unread} new` : 'Chat'}
              {latest && <em className="chat-handle-peek"> · {latest.sender}: {latest.text}</em>}
            </span>
            <button type="button" aria-label={chatSpot.folded ? 'Show chat' : 'Hide chat'}
              onClick={() => setChatSpot(spot => ({ ...spot, folded: !spot.folded }))}>{chatSpot.folded ? '▲' : '▼'}</button>
          </div>
          <div className="chat-body">
            {/* Every conversation as a face, new private ones on top under ＋, so a student sees who is talking to them. */}
            <div className="chat-rail" role="tablist" aria-label="Conversations" aria-orientation="vertical">
              {pinned.map(conversationButton)}
              <button type="button" className={`chat-conv chat-conv-add${showPeople ? ' active' : ''}`} aria-expanded={showPeople}
                aria-label="Chat with a classmate" title="Chat with a classmate" onClick={() => setShowPeople(show => !show)}>
                <span className="chat-face" aria-hidden="true">＋</span>
              </button>
              {chats.map(conversationButton)}
            </div>
            <div className="chat-pane">
              {/* Who reads what is written here. */}
              <div className="chat-head">
                {active === NEAR ? <>
                  <strong>👥 Nearby</strong>
                  {earshot.length ? <span className="chat-head-people" title={earshot.join(', ')}>
                    {earshot.slice(0, 6).map(name => <Face key={name} player={classmates.find(classmate => classmate.name === name)} name={name} />)}
                    {earshot.length > 6 && <small>+{earshot.length - 6}</small>}
                  </span> : <span className="chat-head-note">Nobody near you</span>}
                </> : active === ALL ? <>
                  <strong>📢 Everyone</strong>
                  <span className="chat-head-note">{classmates.length ? `${classmates.length} ${classmates.length === 1 ? 'classmate' : 'classmates'}` : 'Nobody else is here yet'}</span>
                </> : active === TEACHER ? <>
                  <strong>🧑‍🏫 Teacher</strong><span className="chat-head-note">private · any language</span>
                </> : <>
                  <Face player={partner} name={partnerName ?? ''} />
                  <strong>{partnerName}</strong>
                  <span className="chat-head-note">{partner ? '🔒 only you two (and your teacher)' : 'not in the Plaza now'}</span>
                </>}
              </div>
              {peek && peek.key !== active && <button type="button" className="chat-peek" onClick={() => talk(peek.key)}>
                <Face player={playerOf(peek.key)} name={nameOf(peek.key)} icon={peek.key === TEACHER ? '🧑‍🏫' : undefined} />
                <span><b>{nameOf(peek.key)}:</b> {readCorrection(peek.message.text) ? `✏️ ${correctedSentence(readCorrection(peek.message.text)!)}` : peek.message.text}</span>
              </button>}
              {showPeople ? <div className="chat-people" role="menu" aria-label="Chat with">
                {classmates.map(person => <button key={person.id} type="button" role="menuitem" onClick={() => talk(privateChat(person.name))}>
                  <Face player={person} name={person.name} /><span>{person.name}</span>
                </button>)}
                {classmates.length === 0 && <em>Nobody else is in the Plaza yet.</em>}
              </div> : <div className="chat-messages">
                {shown.length === 0 && <p className="chat-empty">{active === NEAR ? (earshot.length ? '👋 Say hello!' : '🚶 Walk up to a classmate to talk.')
                  : active === ALL ? '📢 Say something to everyone!' : active === TEACHER ? 'Ask your teacher for help, in any language.' : `👋 Say hi to ${partnerName}!`}</p>}
                {shown.map((msg, i) => {
                  if (msg.sender.startsWith('System')) {
                    // Notices from the game are just the sentence, small, between the messages
                    return <div key={msg.id ?? `${msg.at}-${i}`} className={`chat-message system-msg${msg.sender.includes('Warning') ? ' warning-msg' : ''}`}>
                      <span className="chat-text">{msg.text}</span>
                    </div>;
                  }
                  const mine = !msg.teacher && msg.sender === myName;
                  const named = group && !mine && (shown[i - 1]?.sender !== msg.sender || shown[i - 1]?.teacher);
                  return <div key={msg.id ?? `${msg.at}-${i}`} className={`chat-message ${mine ? 'mine' : 'theirs'}${msg.teacher ? ' teacher-msg' : ''}${msg.waiting ? ' waiting' : ''}${msg.declined ? ' declined' : ''}${msg.id && sound.messageId === msg.id ? ' chat-speaking' : ''}`}>
                    {/* In a group chat, a name to tap opens a private chat with them */}
                    {named && <button type="button" className="chat-sender" style={{ color: shade(msg.sender) }}
                      title={`Chat with ${msg.sender}`} onClick={() => talk(privateChat(msg.sender))}>{msg.sender}</button>}
                    <div className="chat-bubble">
                      {/* A correction from the teacher shows what was wrong and what is right, in colour. */}
                      {msg.teacher && readCorrection(msg.text)
                        ? <span className="chat-text chat-correction"><b>✏️ Correction:</b> <Correction parts={readCorrection(msg.text)!} /></span>
                        : <span className="chat-text"><Marked text={msg.text} marks={msg.marks} className="slip" /></span>}
                      {!msg.teacher && msg.id && !msg.waiting && !msg.declined && <button type="button" className="chat-listen" disabled={sound.muted || sound.locked || status.state !== 'online'}
                        aria-label={sound.messageId === msg.id ? `Stop reading ${msg.sender}'s message` : `Listen to ${msg.sender}'s message`}
                        onClick={() => sound.messageId === msg.id ? audioRef.current?.stop() : audioRef.current?.replay(msg.id!)}>
                        {sound.messageId === msg.id ? '■' : '▶'}
                      </button>}
                      {mine && <Ticks message={msg} conversation={active} />}
                    </div>
                  </div>;
                })}
                {/* "Is writing", as dots in a bubble of their own */}
                {writing.length > 0 && <div className="chat-message theirs chat-typing" aria-label={`${writing.join(', ')} writing`}>
                  {group && <span className="chat-sender">{writing.join(', ')}</span>}
                  <div className="chat-bubble"><i /><i /><i /></div>
                </div>}
                <div ref={messagesEndRef} />
              </div>}
              {/* Hidden while a stopped message or a hint needs attention, so the conversation keeps its room. */}
              {spelling.length === 0 && !nudge && <div className="emote-bar">
                {emotesFor(levelOf(xp).level).map(emote => (
                  <button
                    key={emote}
                    className="emote-btn"
                    onClick={() => connection?.send({ t: 'emote', emote })}
                    title={`Send ${emote} emote`}
                  >
                    {emote}
                  </button>
                ))}
              </div>}

              {spelling.some(item => item.banned) ? <div className="spelling-help" role="alert">
                {/* A slur: said plainly, without repeating the word or offering another. */}
                <strong>✋ Not sent: that word is not allowed in the Plaza. Your teacher can see what was written.</strong>
              </div> : spelling.length > 0 && <div className="spelling-help" role="alert">
                <strong>✋ Not sent: {spelling.map(item => `“${item.word}”`).join(', ')} {spelling.length === 1 ? 'is' : 'are'} not English. Change it, then press Send.</strong>
                {blockedRun >= 3 && <span className="spelling-stuck">Stuck? Tap <b>Help</b> at the top right.</span>}
                {spelling.map(item => <div key={item.word} className="spelling-word">
                  <span className="spelling-bad">{item.word}</span>
                  {item.suggestions.length ? <>
                    <span>try:</span>
                    {item.suggestions.map(suggestion => <button key={suggestion} type="button" className="spelling-fix"
                      onClick={() => applySuggestion(item.word, suggestion)}>{suggestion}</button>)}
                  </> : <span>is not an English word. Try a different word.</span>}
                </div>)}
              </div>}
              {sendError && <div className="composer-error" role="alert">{sendError}</div>}
              {nudge && <div className="grammar-help" role="status">
                <div className="grammar-fix"><Marked text={nudge.corrected} marks={wordDiff(nudge.original, nudge.corrected).corrected} className="diff-new" /></div>
                <div className="grammar-actions">
                  <button type="button" className="btn btn-primary" onClick={useHint} title="Send the corrected sentence">OK</button>
                  <button type="button" className="spelling-fix" onClick={keepMine} title="Send my sentence as I wrote it">Ignore</button>
                </div>
              </div>}
              <form className="chat-input-wrapper" onSubmit={event => void handleSendMessage(event)}>
                <input
                  type="text"
                  ref={chatField}
                  className={`chat-input${spelling.length ? ' chat-input-blocked' : ''}`}
                  placeholder={active === TEACHER ? 'Ask your teacher in any language…' : active === ALL ? 'Message everyone…'
                    : active === NEAR ? (earshot.length ? 'Talk to people near you…' : 'Nobody near you…')
                    : partner ? `Message ${partner.name}…` : `${partnerName} is not in the Plaza now`}
                  maxLength={200}
                  value={chatInput}
                  readOnly={checking || sending}
                  onChange={(e) => {
                    setChatInput(e.target.value); setNudge(null); submissionAttemptId.current = null; setSendError('');
                    if (!e.target.value) setSpelling([]); else reportTyping();
                  }}
                  onCopy={handlePreventClipboard}
                  onPaste={handlePreventClipboard}
                  onCut={handlePreventClipboard}
                  autoComplete="off"
                  spellCheck="true"
                />
                {!nudge && <button type="submit" className="btn btn-primary chat-send-btn" disabled={checking || sending}>{checking || sending ? '…' : 'Send'}</button>}
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
