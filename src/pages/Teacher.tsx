import type { Incident } from '../../shared/safety';
import type { BlockedStatus } from '../../shared/blockedWords';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { joinLink } from '../studentAuth';
import { WARMUP_KINDS } from '../../shared/warmupKinds';
import type { WarmupKind } from '../../shared/warmupKinds';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import './Teacher.css';
import type { Theme } from '../../shared/theme';
import ThemePicture from '../components/ThemePicture';
import TeacherMissionGuide from '../components/TeacherMissionGuide';
import type { InterviewView } from '../../shared/campaign';
import type { ReportCheck } from '../../shared/reportFeedback';
import type { PlayStats } from '../../shared/activityHistory';
import { playLabel } from '../../shared/activityHistory';
import { PlayBadge } from '../components/ActivityHistory';
import type { TeacherSupport as Support } from '../../shared/support';
import type { CampaignChoice } from '../../shared/missionTypes';
import { XP } from '../../shared/levels';
import TeacherSupport from '../components/TeacherSupport';
import ClassReport from '../components/ClassReport';
import LiveClass, { type LiveSound } from '../components/LiveClass';
import ChatLog, { type ChatFilter } from '../components/ChatLog';
import BlockedWords from '../components/BlockedWords';
import StudentDrawer from '../components/StudentDrawer';
import CommandPalette, { type Command, type PaletteStudent } from '../components/CommandPalette';
import Face from '../components/Face';
import type { AvatarConfig } from '../utils/AvatarRenderer';

type Entry = { id: string; studentKey: string; sender: string; target: string | null; everyone?: boolean; flag: string | null; note: string | null; text: string; timestamp: number; status: string; starred?: boolean };
// Where students stand with the open game's side quests, and what they wrote for them.
type SideQuestPanel = { free: { studentKey: string; name: string }[]; doing: { studentKey: string; name: string; quest: string }[]; busy: number; quests: number;
  groups: { id: string; quest: string; members: string[]; size: number; state: 'open' | 'playing' }[]; open: { id: string; title: string }[];
  reports: { studentKey: string; objective: string; quest: string; text: string; partner?: string; starred: boolean; version: number; check?: ReportCheck }[] };
type CampaignInfo = {
  guideVersion?: string;
  id: string; title: string; status: 'active' | 'chapter_complete' | 'campaign_complete'; chapter: number; chapters: number; chapterTitle: string; chapterTitles?: string[]; zones?: string[];
  reveals: { shown: number; total: number; next: string | null };
  reports: { studentKey: string; objective: string; text: string; partner?: string; starred?: boolean; version: number; check?: ReportCheck }[];
  interviews?: (InterviewView & { studentKey: string; witnessKey: string; questionId: string; answerId: string | null })[];
  board?: { id: string; text: string; teacherReleased: boolean; released: boolean; accepted: number; completed: number }[];
  players: { studentKey: string; name: string; role: string; clues: number; done: string[]; thief: boolean }[];
};
type Game = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean; themeId?: string };
type LiveStudent = { studentKey: string; name: string; x: number; y: number; zone: string | null; level?: number; look?: Partial<AvatarConfig> };
// laptop is set when this runs on the teacher's laptop (npm run classroom).
type Status = {
  warmupPlays?: Partial<Record<WarmupKind, PlayStats>>;
  campaign: CampaignInfo | null; campaigns: CampaignChoice[];
  sideQuests?: SideQuestPanel | null; // the open game's side quests, with or without a campaign
  warmup: { active: boolean; kind: 'facts' | 'identity' | 'pairs'; players: { studentKey: string; name: string; fact: string; found: number; of: number }[]; team: { done: number; total: number } } | null;
  incidents?: Incident[];
  blocked?: BlockedStatus;
  open: boolean; game: { id: string; name: string; randomNames: boolean; vision: number; themeId?: string } | null; realNames: Record<string, string>; themesVersion?: string; games: Game[]; pin: string | null; entries: Entry[]; moderation: boolean; muted: string[]; sound?: LiveSound; online: LiveStudent[];
  laptop?: { url: string; signInUrl: string } | null; notice?: string;
  support: Support;
};

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/teacher/${path}`, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result as T;
}

// How far a student sees, in map pixels: a few steps, from the whole map to a small circle
const VISION_CHOICES: [number, string][] = [[0, 'Everyone'], [650, 'Wide'], [450, 'Medium'], [300, 'Small']];
// The other teacher pages, in the ⋯ menu and in Ctrl+K.
const PAGES: [string, string][] = [['/quest-library', 'Side quest library'], ['/warmup-studio', 'Warm-up editor'], ['/mission-studio', 'Mission Studio'], ['/studio', 'Theme studio'], ['/', 'Student entrance']];
// The chat log's views, as Ctrl+K offers them: what the class is saying, at a glance.
const CHAT_VIEWS: [ChatFilter, string, string][] = [['everyone', '📢', 'Everyone chat'], ['nearby', '👥', 'Nearby chat'], ['private', '🔒', 'Private messages'], ['blocked', '⛔', 'Blocked messages'], ['all', '💬', 'All chat']];

export default function Teacher() {
  const [unplayedWarmups, setUnplayedWarmups] = useState(false);
  const navigate = useNavigate();
  const [movingStudent, setMovingStudent] = useState(false);
  const [password, setPassword] = useState('');
  // The student open in the drawer beside the class, and the one the map's spells work on.
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  // The password is checked once; the session token carries the rest.
  const [token, setToken] = useState(readTeacherSession);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  // A problem sending students to this laptop, from sign-in or opening the class.
  const [notice, setNotice] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newThemeId, setNewThemeId] = useState(''); // '' until the teacher chooses: the map new games start on
  // The maps are data on the server: fetched once, and again whenever one is added, changed or deleted.
  const [themes, setThemes] = useState<Theme[]>([]);
  const [retired, setRetired] = useState<Theme[]>([]); // maps in Trash, for the games still on them
  const [defaultMap, setDefaultMap] = useState(''); // chosen in the theme studio
  const themesVersion = status?.themesVersion;
  useEffect(() => {
    if (themesVersion === undefined) return;
    let active = true;
    fetch('/api/themes').then(response => response.json()).then(body => { if (active && Array.isArray(body.themes)) { setThemes(body.themes); setRetired(Array.isArray(body.trash) ? body.trash : []); setDefaultMap(typeof body.default === 'string' ? body.default : ''); } }).catch(() => { /* the next status tries again */ });
    return () => { active = false; };
  }, [themesVersion]);
  const themeOf = (id?: string | null): Theme | undefined => themes.find(theme => theme.id === id) ?? retired.find(theme => theme.id === id) ?? themes[0];
  const plazaMap = themeOf(status?.game?.themeId);
  const placeName = (id: string | null) => plazaMap?.zones.find(z => z.id === id)?.name ?? id ?? plazaMap?.name ?? '';
  const MAP_SIZE = plazaMap?.world ?? 2048;
  const newTheme = themeOf(newThemeId || defaultMap);
  // Map clues in places the open game's map does not have: students could not find them there.
  const notOnMap = (zones?: string[]) => plazaMap && zones ? zones.filter(zone => !plazaMap.zones.some(item => item.id === zone)) : [];
  const mapWarning = (zones?: string[]) => { const missing = notOnMap(zones); return missing.length > 0 && <p className="teacher-flag">⚠ Not on {plazaMap!.name}: {missing.join(', ')}. Students cannot find the map clues there; choose a map with these places for this game.</p>; };
  const [warmupKind, setWarmupKind] = useState<WarmupKind>('facts');
  const [copyNote, setCopyNote] = useState(''); // shown when the browser would not copy
  const [copied, setCopied] = useState(''); // the PIN whose link was just copied
  const [vision, setVision] = useState(450); // how far students see in a new game, in map pixels
  const [randomNames, setRandomNames] = useState(true); // students get made-up names, and the teacher sees who they are
  const [changingNames, setChangingNames] = useState(false);
  // Everything beyond the class now is a tab, one open at a time or none; the last one is remembered on this computer.
  const [tab, setTab] = useState<TabId | null>(readTab);
  useEffect(() => { try { if (tab) localStorage.setItem(TAB_KEY, tab); else localStorage.removeItem(TAB_KEY); } catch { /* remembered for this visit only */ } }, [tab]);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const request = useCallback((path: string, body?: object) => call<Status>(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-teacher-session': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), [token]);

  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Connection failed.');
    if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); setStatus(null); } // the session expired
  }, []);

  const refresh = useCallback(async () => {
    try { setStatus(await request('status')); setError(''); }
    catch (cause) { failed(cause); }
  }, [request, failed]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [token, refresh]);

  const signIn = async (typed = password) => {
    try {
      const { token: session, notice: linked } = await call<{ token: string; notice?: string }>('login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: typed })
      });
      setStatus(await call<Status>('status', { headers: { 'x-teacher-session': session } }));
      setPassword('');
      setError('');
      setNotice(linked || '');
      setToken(session);
      storeTeacherSession(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
  };
  const signOut = () => { storeTeacherSession(''); setStatus(null); setToken(''); setMenuOpen(false); setPaletteOpen(false); setSelectedStudent(null); };

  // tester.bat opens /teacher?autologin=tester; its throwaway server's password is "tester".
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('autologin') === 'tester') void signIn('tester');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The link for a game: students open it, sign in, and arrive with the PIN already filled in. It is the online
  // site that signs them in, so on the laptop it points there; the PIN stays the same for every lesson.
  const linkFor = (pin: string) => joinLink(status?.laptop?.signInUrl ?? window.location.origin, pin);
  // The clipboard is only offered on https pages and on exactly "localhost", not on the laptop's network address, so
  // there is an older way to try next, and a message when neither works.
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* try the other way */ }
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(box);
      box.select();
      const done = document.execCommand('copy');
      box.remove();
      return done;
    } catch { return false; }
  };
  const copyLink = async (pin: string) => {
    if (await copyText(linkFor(pin))) {
      setCopied(pin);
      setCopyNote('');
      window.setTimeout(() => setCopied(''), 2500);
    } else {
      setCopyNote('Your browser would not copy it. Select the link above and press Ctrl+C.');
      setTab('games'); // where the link is, to copy by hand
    }
  };

  // The plaza may show made-up names; the teacher always sees the real one beside them.
  const who = (studentKey: string, shown: string) => {
    const real = status?.realNames?.[studentKey];
    return real && real !== shown ? `${shown} (${real})` : shown;
  };

  const helpBefore = useRef<Set<string>>(new Set());
  const openHelp = status?.support?.alerts.filter(alert => alert.status === 'open') ?? [];
  const helpSignature = openHelp.map(alert => alert.id).join(',');
  // An incident, or another attempt in one, beeps higher and twice: it is not like a message waiting.
  const incidentSignature = (status?.incidents ?? []).map(incident => `${incident.id}:${incident.count}`).join(',');
  const incidentsBefore = useRef('');
  useEffect(() => {
    const before = new Map(incidentsBefore.current.split(',').filter(Boolean).map(item => item.split(':') as [string, string]));
    const now = incidentSignature.split(',').filter(Boolean).map(item => item.split(':') as [string, string]);
    if (now.some(([id, count]) => Number(count) > Number(before.get(id) ?? 0))) {
      try {
        const audio = new AudioContext();
        for (const at of [0, 0.18]) {
          const tone = audio.createOscillator();
          const volume = audio.createGain();
          tone.frequency.value = 990;
          volume.gain.value = 0.06;
          tone.connect(volume).connect(audio.destination);
          tone.start(audio.currentTime + at);
          tone.stop(audio.currentTime + at + 0.12);
        }
        window.setTimeout(() => void audio.close(), 600);
      } catch { /* sound is optional */ }
    }
    incidentsBefore.current = incidentSignature;
  }, [incidentSignature]);

  // A soft beep and the tab title tell the teacher something needs them, even from another window.
  const repeatCount = status?.blocked?.repeats.length ?? 0;
  useEffect(() => {
    const helpIds = helpSignature ? helpSignature.split(',') : [];
    const incidentCount = incidentSignature ? incidentSignature.split(',').length : 0;
    const count = helpIds.length + incidentCount + repeatCount;
    document.title = count ? `(${count}) ${incidentCount ? '🚨 ' : ''}Teacher controls${helpIds.length ? ' · help needed' : ''}` : 'Teacher controls';
    if (helpIds.some(id => !helpBefore.current.has(id))) {
      try {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        tone.frequency.value = 660;
        volume.gain.value = 0.05;
        tone.connect(volume).connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.12);
        tone.onended = () => { void audio.close(); };
      } catch { /* sound is optional */ }
    }
    helpBefore.current = new Set(helpIds);
  }, [helpSignature, incidentSignature, repeatCount]);

  const action = async (path: string, body: object, onError?: (cause: unknown) => void) => {
    try {
      const result = await request(path, body);
      setStatus(result);
      setError('');
      if (result.notice !== undefined) setNotice(result.notice);
      return true;
    } catch (cause) { onError?.(cause); failed(cause); return false; }
  };

  // Saved classmates remain available for private help even when they are offline or have no alert.
  const supportStudents = new Map<string, { studentKey: string; name: string }>();
  if (status) {
    for (const student of status.support?.students ?? []) supportStudents.set(student.studentKey, student);
    for (const student of status.online) supportStudents.set(student.studentKey, student);
    for (const player of status.campaign?.players ?? []) if (!supportStudents.has(player.studentKey)) supportStudents.set(player.studentKey, player);
    for (const player of status.warmup?.players ?? []) if (!supportStudents.has(player.studentKey)) supportStudents.set(player.studentKey, player);
    for (const alert of status.support?.alerts ?? []) if (!supportStudents.has(alert.studentKey)) supportStudents.set(alert.studentKey, alert);
    for (const entry of status.entries) if (!supportStudents.has(entry.studentKey)) supportStudents.set(entry.studentKey, { studentKey: entry.studentKey, name: entry.sender });
  }
  const isOnline = (studentKey: string) => !!status?.online.some(student => student.studentKey === studentKey);


  // Ctrl+K (or / when nothing is being typed) opens the search box; Ctrl+K again closes it.
  useEffect(() => {
    if (!token) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(open => !open);
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target as HTMLElement | null)?.closest('input, textarea, select')) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [token]);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeDrawer = useCallback(() => setSelectedStudent(null), []);

  // The ⋯ menu closes with a click anywhere else, or Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  // One row of tabs for everything that is not the class now. A word or number beside a title says how it stands.
  const campaign = status?.campaign ?? null;
  const side = status?.sideQuests ?? null;
  const tabs: TabInfo[] = !status ? [] : [
    ...(status.game ? [
      { id: 'chat' as const, icon: '💬', title: 'Chat log' },
      { id: 'blocked' as const, icon: '🚫', title: 'Blocked words', label: status.blocked?.words.length ? `${status.blocked.words.length}` : undefined },
      { id: 'map' as const, icon: '🗺', title: 'Map & spells', label: `${status.online.length} online` },
      { id: 'warmup' as const, icon: '🧩', title: 'Warm-up', label: status.warmup?.active ? 'running' : undefined },
      { id: 'campaign' as const, icon: '📖', title: 'Campaign', label: campaign ? `chapter ${campaign.chapter + 1} of ${campaign.chapters}` : undefined },
      { id: 'side' as const, icon: '✦', title: 'Side quests', label: side?.quests ? `${side.doing.length} doing` : undefined },
      { id: 'history' as const, icon: '🗂', title: 'Message history' },
    ] : []),
    { id: 'games', icon: '🎮', title: 'Games', label: `${status.games.length}` },
    ...(status.game ? [{ id: 'vision' as const, icon: '👁', title: 'Vision', label: VISION_CHOICES.find(([radius]) => radius === status.game?.vision)?.[1] }] : []),
    ...(status.laptop ? [{ id: 'laptop' as const, icon: '💻', title: 'This laptop' }] : []),
    ...(status.game ? [{ id: 'report' as const, icon: '📝', title: 'Class report' }] : []),
  ];
  // With no game yet, making one is the only thing to do.
  const shown: TabId | null = tabs.some(info => info.id === tab) ? tab : status && !status.game ? 'games' : null;
  const openTab = (id: TabId, target = '.teacher-tabs') => {
    setTab(id);
    window.requestAnimationFrame(() => document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const showGuide = () => openTab('campaign', '#teacher-panel .mission-guide');
  const selectedOnline = selectedStudent !== null && isOnline(selectedStudent);
  const allSoundOff = status?.sound?.allOff === true;

  // Ctrl+K: everything the page can do, in the order it is offered with nothing typed (after the recent ones).
  const commands: Command[] = !status ? [] : [
    ...(status.game ? CHAT_VIEWS.map(([filter, icon, label]) => ({ id: `chat:${filter}`, icon, label, hint: 'Chat log', keywords: 'chat log messages see read group what they say',
      run: () => { setChatFilter(filter); openTab('chat'); } })) : []),
    ...(status.blocked?.repeats ?? []).map(repeat => ({ id: `block:${repeat.key}`, icon: '🚫', label: `Block “${repeat.words}” for this lesson`,
      hint: `${repeat.students.length} students`, keywords: 'block ban stop word phrase repeat everyone', run: () => action('block', { words: [repeat.words] }) })),
    ...(status.game ? [{ id: 'class', icon: status.open ? '🔒' : '🔓', label: status.open ? 'Close the class' : 'Open the class', keywords: 'class lesson open close start stop',
      run: () => action('class', { open: !status.open }) }] : []),
    ...(status.pin ? [{ id: 'link', icon: '🔗', label: 'Copy the join link', hint: `PIN ${status.pin}`, keywords: 'pin join link copy', run: () => copyLink(status.pin!) }] : []),
    ...(status.warmup?.active ? [{ id: 'warmup:end', icon: '🧩', label: 'End the warm-up', keywords: 'warm-up warmup stop finish', run: () => action('warmup', { op: 'end' }) }] : []),
    ...(campaign && campaign.status !== 'campaign_complete' ? [
      ...(campaign.reveals.next ? [{ id: 'news', icon: '📰', label: `Next news: ${campaign.reveals.next}`, keywords: 'campaign reveal story', run: () => action('campaign', { op: 'reveal' }) }] : []),
      { id: 'chapter', icon: campaign.chapter + 1 < campaign.chapters ? '▶' : '🏁', label: nextStep(campaign), keywords: 'campaign chapter next end',
        run: () => { if (window.confirm(`${nextStep(campaign)}?`)) void action('campaign', { op: 'next' }); } },
      { id: 'guide', icon: '📖', label: 'Teacher guide: goals, steps and answers', keywords: 'campaign guide answers solutions', run: showGuide },
    ] : []),
    { id: 'sound', icon: allSoundOff ? '🔊' : '🔇', label: allSoundOff ? 'Restore sound on every device' : 'Mute all sound on every device', keywords: 'sound mute quiet audio voice read aloud',
      run: () => action('sound-all', { off: !allSoundOff }) },
    ...(status.game && status.open ? WARMUP_KINDS.map(kind => ({ id: `warmup:${kind.id}`, icon: '🧩', label: `Start the warm-up: ${kind.label}`, keywords: 'warm-up warmup begin activity',
      run: () => action('warmup', { op: 'start', type: kind.id }) })) : []),
    ...(status.game ? [
      { id: 'rain', icon: '🌧', label: 'Make it rain (15s)', keywords: 'magic spell weather', run: () => action('magic', { power: 'rain' }) },
      ...VISION_CHOICES.filter(([radius]) => radius !== status.game?.vision).map(([radius, label]) => ({ id: `vision:${radius}`, icon: '👁', label: `Vision: ${label}`,
        keywords: 'see far fog radius', run: () => action('vision', { radius }) })),
    ] : []),
    ...tabs.map(info => ({ id: `tab:${info.id}`, icon: info.icon, label: info.title, hint: 'tab', keywords: 'open show go section', run: () => openTab(info.id) })),
    ...PAGES.map(([to, label]) => ({ id: `page:${to}`, icon: '↗', label, hint: 'page', keywords: 'open go editor studio', run: () => navigate(to) })),
    { id: 'sign-out', icon: '🚪', label: 'Sign out', keywords: 'log out exit', run: signOut },
  ];
  // Everyone the teacher can find by name, shown or real; who is here first.
  const paletteStudents: PaletteStudent[] = [...supportStudents.values()]
    .map(student => ({ studentKey: student.studentKey, name: student.name, real: status?.realNames?.[student.studentKey], online: isOnline(student.studentKey) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  // What can be done with one student: their drawer, a message, chat and sound, and spells while they are here.
  const forStudent = (student: PaletteStudent, fill: (text: string) => void): Command[] => {
    const key = student.studentKey;
    const name = who(key, student.name);
    const mutedNow = !!status?.muted.includes(key);
    const soundOff = !!status?.sound?.off.includes(key);
    return [
      { id: `open:${key}`, icon: '👤', label: `${name}: messages and actions`, keywords: 'open chat history conversations see', run: () => setSelectedStudent(key) },
      { id: `write:${key}`, icon: '✉️', label: `Message ${name}…`, keywords: 'write send private help', stay: true, run: () => fill(`${student.name}: `) },
      { id: `mute:${key}`, icon: mutedNow ? '💬' : '🤐', label: mutedNow ? `Let ${name} chat again` : `Mute ${name}’s chat`, keywords: 'mute unmute silence chat',
        run: () => action('mute', { studentKey: key, muted: !mutedNow }) },
      ...(allSoundOff ? [] : [{ id: `sound:${key}`, icon: soundOff ? '🔊' : '🔇', label: soundOff ? `Sound back on for ${name}` : `Sound off for ${name}`, keywords: 'sound audio voice read aloud',
        run: () => action('sound', { studentKey: key, off: !soundOff }) }]),
      ...(student.online ? [
        { id: `find:${key}`, icon: '📍', label: `Find ${name} on the map`, keywords: 'map where', run: () => { setSelectedStudent(key); openTab('map'); } },
        { id: `freeze:${key}`, icon: '❄', label: `Freeze ${name} (15s)`, keywords: 'spell magic stop', run: () => action('magic', { power: 'freeze', studentKey: key }) },
        { id: `thaw:${key}`, icon: '🔥', label: `Thaw ${name}`, keywords: 'spell magic', run: () => action('magic', { power: 'thaw', studentKey: key }) },
        { id: `lightning:${key}`, icon: '⚡', label: `Lightning on ${name}`, keywords: 'spell magic tumble', run: () => action('magic', { power: 'lightning', studentKey: key }) },
      ] : []),
    ];
  };

  // The student in the drawer: here now, or known in this game.
  const drawerStudent = (() => {
    if (!status || !selectedStudent) return null;
    const live = status.online.find(student => student.studentKey === selectedStudent);
    const known = live ?? supportStudents.get(selectedStudent);
    return known ? { studentKey: selectedStudent, name: known.name, zone: live ? placeName(live.zone) : null, level: live?.level, look: live?.look } : null;
  })();

  return <main className={`teacher-page${drawerStudent ? ' teacher-with-drawer' : ''}`}>
    {!token || !status ? <>
      <header className="teacher-header">
        <h1>Teacher controls</h1>
        <span>{PAGES.map(([to, label], index) => <span key={to}>{index > 0 && ' · '}<Link to={to}>{label}</Link></span>)}</span>
      </header>
      <form className="teacher-signin" onSubmit={event => { event.preventDefault(); void signIn(); }}>
        <label htmlFor="teacher-password">Teacher password (the same as PinPlay)</label>
        <input id="teacher-password" type="password" autoComplete="current-password" value={password}
          onChange={event => setPassword(event.target.value)} required />
        <button className="btn btn-primary">Open controls</button>
      </form>
    </> : <>
      {/* Always in reach: the class, its PIN, open or closed, how chat is checked, the search box and the other pages. */}
      <header className="teacher-bar">
        <h1 className="teacher-class"><span className={`teacher-dot${status.open ? ' teacher-dot-open' : ''}`} aria-hidden="true" />
          {status.game ? <>{status.game.name} <small>{status.open ? 'open' : 'closed'}</small></> : 'No game yet'}</h1>
        {status.pin && <button type="button" className="teacher-pin" onClick={() => void copyLink(status.pin!)} title={`Copy the join link: ${linkFor(status.pin)}`}>
          PIN <strong>{status.pin}</strong> <span>{copied === status.pin ? 'Link copied ✓' : 'Copy link'}</span></button>}
        {status.game && <button className="btn btn-primary btn-sm" onClick={() => void action('class', { open: !status.open })}>
          {status.open ? 'Close class' : 'Open class'}</button>}
        {status.game && <div className="teacher-live-names" aria-label="Student names">
          <span>{status.game.randomNames ? 'Random names' : 'Real first names'}</span>
          {status.open && status.game.randomNames && <button type="button" className="btn btn-secondary btn-sm" disabled={changingNames}
            title="Switch everyone to real first names now. Students stay in the game and keep their progress."
            onClick={async () => { setChangingNames(true); await action('real-names', { gameId: status.game!.id }); setChangingNames(false); }}>
            {changingNames ? 'Changing names…' : 'Use real names'}</button>}
        </div>}
        {status.game && <span className="teacher-review" title={status.moderation
          ? 'Every message posts once the checks pass: blocked words, the harm check and OpenAI. Take any down in the chat log.'
          : 'No OPENAI_API_KEY (see the README): messages post after the blocked words and the harm check only. Take any down in the chat log.'}>
          {status.moderation ? '🛡 Chat checked by OpenAI' : '⚠ Chat not checked by OpenAI'}</span>}
        <button type="button" className="teacher-search" onClick={() => setPaletteOpen(true)} title="Find a student or an action, or write “name: message”">
          <span>🔍 Search or do…</span><kbd>Ctrl K</kbd></button>
        <div className="teacher-more" ref={menu}>
          <button type="button" aria-haspopup="true" aria-expanded={menuOpen} aria-label="More" title="Other pages and sign out" onClick={() => setMenuOpen(open => !open)}>⋯</button>
          {menuOpen && <ul className="teacher-menu">
            {PAGES.map(([to, label]) => <li key={to}><Link to={to} onClick={() => setMenuOpen(false)}>{label}</Link></li>)}
            <li><button type="button" onClick={signOut}>Sign out</button></li>
          </ul>}
        </div>
      </header>
      {/* What is running, with its next step, so nobody has to scroll for it. */}
      {status.game && (status.warmup?.active || (campaign && campaign.status !== 'campaign_complete')) && <section className="teacher-now">
        {status.warmup?.active && <span className="teacher-now-item">🧩 Warm-up · {status.warmup.team.done} of {status.warmup.team.total} found
          <button className="btn btn-secondary btn-sm" onClick={() => void action('warmup', { op: 'end' })}>End</button></span>}
        {campaign && campaign.status !== 'campaign_complete' && <span className="teacher-now-item">📖 {campaign.title} · chapter {campaign.chapter + 1} of {campaign.chapters}
          <button className="btn btn-secondary btn-sm" onClick={showGuide}>Teacher guide</button>
          {campaign.reveals.next && <button className="btn btn-secondary btn-sm" title={campaign.reveals.next} onClick={() => void action('campaign', { op: 'reveal' })}>📰 Next news</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => { if (window.confirm(`${nextStep(campaign)}?`)) void action('campaign', { op: 'next' }); }}>
            {campaign.chapter + 1 < campaign.chapters ? '▶ Next chapter' : '🏁 End campaign'}</button></span>}
      </section>}
      {status.game && <LiveClass gameId={status.game.id} alerts={status.support?.alerts ?? []} incidents={status.incidents ?? []}
        repeats={status.blocked?.repeats ?? []} online={status.online.map(s => ({ ...s, zone: placeName(s.zone) }))}
        known={[...supportStudents.values()]} muted={status.muted} sound={status.sound ?? { off: [], now: Date.now(), plays: [] }} open={status.open}
        who={who} action={action} selected={selectedStudent} onSelect={setSelectedStudent} />}

      <nav className="teacher-tabs" role="tablist" aria-label="More for this class">
        {tabs.map(info => <button key={info.id} id={`tab-${info.id}`} type="button" role="tab" aria-selected={shown === info.id} aria-controls="teacher-panel"
          onClick={() => setTab(shown === info.id ? null : info.id)}>
          <span aria-hidden="true">{info.icon}</span>{info.title}{info.label && <span className="teacher-badge">{info.label}</span>}
        </button>)}
      </nav>
      {shown && <section id="teacher-panel" className="teacher-panel" role="tabpanel" aria-labelledby={`tab-${shown}`}>
        {shown === 'chat' && <ChatLog entries={status.entries} filter={chatFilter} onFilter={setChatFilter} who={who} action={action} onSelect={setSelectedStudent} />}

        {shown === 'blocked' && status.blocked && <BlockedWords blocked={status.blocked} open={status.open} who={who} action={action} onSelect={setSelectedStudent} />}

        {shown === 'map' && status.game && <>
          <div className="teacher-actions">
            <button className="btn btn-sm" onClick={() => void action('magic', { power: 'rain' })}>🌧 Make it rain (15s)</button>
            <button className="btn btn-sm" disabled={!selectedOnline} onClick={() => setMovingStudent(!movingStudent)} aria-pressed={movingStudent}>{movingStudent ? 'Cancel move' : 'Move selected student'}</button>
            {(['freeze', 'thaw', 'lightning'] as const).map(power => <button key={power} className="btn btn-sm" disabled={!selectedOnline} onClick={() => void action('magic', { power, studentKey: selectedStudent })}>{power === 'freeze' ? 'Freeze (15s)' : power === 'thaw' ? 'Thaw' : 'Lightning (revive in 4s)'}</button>)}
          </div>
          <p role="status" className="teacher-muted">{movingStudent ? 'Click an open path on the map to teleport the selected student.'
            : selectedOnline ? `Spells work on ${who(selectedStudent!, drawerStudent?.name ?? '')}. Lightning is a playful tumble: they get up after 4 seconds.`
            : status.online.length ? 'Click a student on the map, or a face above, to cast a spell on them.' : 'No students in the plaza right now.'}</p>
          <div className="teacher-map" style={{ cursor: movingStudent ? 'crosshair' : undefined }} aria-label="Live student locations in the plaza" onClick={event => {
            if (!movingStudent || !selectedStudent) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            void action('magic', { power: 'teleport', studentKey: selectedStudent, x: (event.clientX - bounds.left) / bounds.width * MAP_SIZE, y: (event.clientY - bounds.top) / bounds.height * MAP_SIZE });
            setMovingStudent(false);
          }}>
            {plazaMap && <ThemePicture theme={plazaMap} />}
            {status.online.map(student => <button key={student.studentKey} type="button"
              className={`teacher-map-marker${selectedStudent === student.studentKey ? ' selected' : ''}`}
              style={{ left: `${student.x / MAP_SIZE * 100}%`, top: `${student.y / MAP_SIZE * 100}%` }}
              onClick={event => { event.stopPropagation(); setSelectedStudent(student.studentKey); }}
              aria-pressed={selectedStudent === student.studentKey}
              aria-label={`${who(student.studentKey, student.name)}: ${placeName(student.zone)}`}
              title={`${who(student.studentKey, student.name)} · ${placeName(student.zone)}`}>
              <Face player={student.look} name={student.name} />
              {selectedStudent === student.studentKey && <span className="teacher-map-label">{who(student.studentKey, student.name)}</span>}
            </button>)}
          </div>
        </>}

        {shown === 'warmup' && <>
          <p>{WARMUP_KINDS.find(kind => kind.id === warmupKind)?.blurb} Good for the first few minutes.</p>
          <label><input type="checkbox" checked={unplayedWarmups} disabled={!status.warmupPlays} onChange={event => setUnplayedWarmups(event.target.checked)} /> Never played before in {status.game?.name ?? 'this game'}</label>
          <div className="teacher-newgame">
            <select value={unplayedWarmups && status.warmupPlays?.[warmupKind]?.plays ? '' : warmupKind} onChange={event => setWarmupKind(event.target.value as WarmupKind)} aria-label="Which warm-up">
              {unplayedWarmups && <option value="" disabled>Choose a warm-up not played before</option>}
              {WARMUP_KINDS.filter(kind => !unplayedWarmups || !status.warmupPlays?.[kind.id]?.plays).map(kind => <option key={kind.id} value={kind.id}>{kind.label}{status.warmupPlays ? ` · ${playLabel(status.warmupPlays[kind.id])}` : ''}</option>)}
            </select>
            {status.warmupPlays && <PlayBadge stats={status.warmupPlays[warmupKind]} label="Selected warm-up" />}
            <button className="btn btn-primary" disabled={!status.open || (unplayedWarmups && !!status.warmupPlays?.[warmupKind]?.plays)} onClick={() => void action('warmup', { op: 'start', type: warmupKind })}>
              {status.warmup?.active ? 'Start again' : 'Start the warm-up'}</button>
            {status.warmup?.active && <button className="btn btn-secondary" onClick={() => void action('warmup', { op: 'end' })}>End the warm-up</button>}
            <Link to={`/warmup-studio?kind=${warmupKind}`}>Edit warm-up</Link>
          </div>
          {status.warmup && <>
            {status.warmup.active && status.warmup.kind === 'identity' && <p className="teacher-muted">Helpers’ secret names are blocked in student chat. Guesses and yes/no replies are allowed. Private messages to you remain available.</p>}
            <p>{status.warmup.active ? 'In progress' : 'Finished'}: {status.warmup.team.done} of {status.warmup.team.total} found.</p>
            <ul>{status.warmup.players.map(player => <li key={player.studentKey}>
              <span><strong>{who(player.studentKey, player.name)}</strong> · {player.fact} · found {player.found} of {player.of}</span>
            </li>)}</ul>
          </>}
        </>}

        {shown === 'campaign' && status.game && (!campaign ? <>
          <p>Start a story for <strong>{status.game.name}</strong>. Each student gets a role at random and keeps it for the whole campaign. Closing the game saves it, and reopening picks the story up again.</p>
          <ul className="teacher-campaign-choices">{status.campaigns.map(choice => <li key={choice.id}>
            <div>
              <strong>{choice.title}</strong>
              <small>{choice.chapters.length} {choice.chapters.length === 1 ? 'chapter' : 'chapters'} · {features(choice)}</small>
              <ol className="teacher-chapter-line">{chapterPreview(choice.chapters).map(([number, title]) => <li key={title}>{number > 0 && <span>{number}.</span>}{title}</li>)}</ol>
              {mapWarning(choice.zones)}
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void action('campaign', { op: 'start', campaign: choice.id })}>Start</button>
            <TeacherMissionGuide token={token} campaignId={choice.id} refreshKey={choice.revision} />
          </li>)}</ul>
          <p className="teacher-muted">Change these chapters or write your own campaign in <Link to="/mission-studio">Mission Studio</Link>.</p>
        </> : <>
          <p><strong>{campaign.title}</strong> · {{ active: 'in progress', chapter_complete: 'ready for the next chapter: students can keep working', campaign_complete: 'finished' }[campaign.status]}</p>
          {mapWarning(campaign.zones)}
          <ol className="teacher-chapter-steps">{(campaign.chapterTitles ?? []).map((title, index) => {
            const state = campaign.status === 'campaign_complete' || index < campaign.chapter ? 'done' : index === campaign.chapter ? 'now' : 'next';
            return <li key={index} className={`teacher-step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="teacher-step-number">{state === 'done' ? '✓' : index + 1}</span>
              <span>{title}</span>
              {state === 'now' && <small>now</small>}
            </li>;
          })}</ol>
          <TeacherMissionGuide key={`${status.game.id}:${campaign.id}`} token={token} gameId={status.game.id}
            currentChapter={campaign.chapter} refreshKey={campaign.guideVersion} />
          {campaign.status !== 'campaign_complete' && <div className="teacher-newgame">
            {campaign.reveals.next && <button className="btn btn-secondary" title={campaign.reveals.next}
              onClick={() => void action('campaign', { op: 'reveal' })}>Reveal the next news ({campaign.reveals.shown} of {campaign.reveals.total} shown)</button>}
            <button className="btn btn-primary" onClick={() => void action('campaign', { op: 'next' })}>{nextStep(campaign)}</button>
          </div>}
          {campaign.status !== 'campaign_complete' && campaign.reveals.next && <p>Next news: <em>{campaign.reveals.next}</em></p>}
          {campaign.players.length > 0 && <><h3>Students</h3><ul>
            {campaign.players.map(player => <li key={player.studentKey}>
              <span><strong>{who(player.studentKey, player.name)}</strong> · {player.role}{player.thief ? ' · THIEF' : ''} · {player.clues} place clue{player.clues === 1 ? '' : 's'} · {player.done.length ? `answered ${player.done.length}` : 'not answered yet'}</span>
            </li>)}
          </ul></>}
          {!!campaign.board?.length && <><h3>Quest board</h3><p>Release prepared quests when the class needs another mystery.</p><ul>{campaign.board.map(quest => <li key={quest.id}><span>{quest.text} · {quest.accepted} accepted · {quest.completed} completed</span>
            {quest.teacherReleased && !quest.released && campaign.status !== 'campaign_complete' && <button className="btn btn-secondary btn-sm" onClick={() => void action('quest-release', { objective: quest.id })}>Release quest</button>}
            {quest.teacherReleased && quest.released && <small>Released</small>}</li>)}</ul></>}
          {campaign.reports.length > 0 && <>
            <h3>What students wrote</h3>
            <ul>{campaign.reports.map(report => <li key={report.studentKey + report.objective}>
              <span><strong>{who(report.studentKey, campaign.players.find(player => player.studentKey === report.studentKey)?.name ?? 'Student')}</strong>{report.partner ? ` · partner: ${report.partner}` : ''}: {report.text}</span>
              {report.check && <small>{report.check.feedback}</small>}
              {report.check && ['uncertain', 'unavailable'].includes(report.check.status) && <button className="btn btn-secondary btn-sm" onClick={() => void action('report-accept', { gameId: status.game!.id, studentKey: report.studentKey, objective: report.objective, version: report.version })}>Accept report</button>}
              <StarButton starred={report.starred} onStar={() => void action('xp', { report: { studentKey: report.studentKey, objective: report.objective } })} />
            </li>)}</ul>
          </>}
          {!!campaign.interviews?.length && <details className="teacher-interviews"><summary>Witness exchanges ({campaign.interviews.length})</summary>
            <p>Questions and replies post as soon as they pass the checks; remove one here and it stops counting. These records show participation; you assess the language and reasoning.</p>
            {campaign.interviews.map(interview => <article key={interview.id} className="teacher-entry">
              <strong>{who(interview.studentKey, campaign.players.find(p => p.studentKey === interview.studentKey)?.name ?? 'Student')} → {who(interview.witnessKey, interview.name)}</strong>
              <p>{interview.task}</p>
              <p>Question ({interview.questionStatus}): {interview.question}</p>
              {interview.shared && <p>Investigator evidence: {interview.shared}</p>}
              {interview.answer && <p>Reply ({interview.answerStatus}): {interview.answer}</p>}
              {interview.evidence && <p>Witness evidence: {interview.evidence}</p>}
              <div className="teacher-actions">
                {interview.questionStatus === 'approved' && <button className="btn btn-sm" onClick={() => void action('remove', { id: interview.questionId })}>Remove question</button>}
                {interview.answerStatus === 'approved' && <button className="btn btn-sm" onClick={() => void action('remove', { id: interview.answerId })}>Remove reply</button>}
              </div>
            </article>)}
          </details>}
          <p className="teacher-muted">Side quests for early finishers have their own tab, with or without a campaign. Change chapters in <Link to="/mission-studio">Mission Studio</Link>.</p>
          <button className="btn btn-secondary btn-sm teacher-danger" onClick={() => {
            if (window.confirm('Erase the campaign for this game, including every role and clue?')) void action('campaign', { op: 'reset', confirm: true });
          }}>Erase campaign</button>
        </>)}

        {shown === 'side' && status.game && side && <>
          <p>{side.free.length} free to choose · {side.doing.length} doing one · {side.busy} on the warm-up or campaign · {side.quests} side quest{side.quests === 1 ? '' : 's'} on the board</p>
          {side.quests === 0 && (side.free.length > 0
            ? <p className="teacher-error">{side.free.length === 1 ? '1 student has' : `${side.free.length} students have`} nothing else to do and no side quests to choose. <Link to="/quest-library">Add some from the library</Link>.</p>
            : <p className="teacher-muted">No side quests in this game yet. <Link to="/quest-library">Add some from the library</Link>: students can take them straight away, with or without a campaign.</p>)}
          {side.free.length > 0 && <ul>{side.free.map(item => <li key={item.studentKey}><span><strong>{who(item.studentKey, item.name)}</strong> · free</span>
            {side.open.length > 0 && <select aria-label={`Place ${item.name} in a side quest`} value="" onChange={event => { if (event.target.value) void action('quest-place', { studentKey: item.studentKey, objective: event.target.value }); }}>
              <option value="">Place in a side quest…</option>{side.open.map(quest => <option key={quest.id} value={quest.id}>{quest.title}</option>)}</select>}</li>)}</ul>}
          {side.groups.length > 0 && <ul>{side.groups.map(group => <li key={group.id}><span>{group.size === 2 ? 'Pair' : 'Group'} · <strong>{group.quest}</strong>: {group.members.join(', ')}
            {group.state === 'open' ? ` · waiting for ${group.size - group.members.length} more` : ' · playing'}</span></li>)}</ul>}
          {side.doing.length > 0 && <ul>{side.doing.map(item => <li key={item.studentKey}><span><strong>{who(item.studentKey, item.name)}</strong> · {item.quest}</span></li>)}</ul>}
          {side.reports.length > 0 && <>
            <h3>What students wrote</h3>
            <ul>{side.reports.map(report => <li key={report.studentKey + report.objective}>
              <span><strong>{who(report.studentKey, status.realNames[report.studentKey] ?? 'Student')}</strong> · {report.quest}{report.partner ? ` · with ${report.partner}` : ''}: {report.text}</span>
              {report.check && <small>{report.check.feedback}</small>}
              {report.check && ['uncertain', 'unavailable'].includes(report.check.status) && <button className="btn btn-secondary btn-sm" onClick={() => void action('report-accept', { gameId: status.game!.id, studentKey: report.studentKey, objective: report.objective, version: report.version })}>Accept report</button>}
              <StarButton starred={report.starred} onStar={() => void action('xp', { report: { studentKey: report.studentKey, objective: report.objective } })} />
            </li>)}</ul>
          </>}
          <p className="teacher-muted"><Link to="/quest-library">Add side quests from the library</Link>, and close or withdraw them there. Students choose one at a time; with nothing else to do, the game asks them to choose.</p>
        </>}

        {shown === 'history' && status.game && <TeacherSupport key={status.game.id} gameId={status.game.id} token={token}
          support={status.support ?? { alerts: [], students: [] }}
          students={[...supportStudents.values()].sort((a, b) => who(a.studentKey, a.name).localeCompare(who(b.studentKey, b.name)))}
          who={who} failed={failed} onStudent={setSelectedStudent} />}

        {shown === 'games' && <>
          {status.pin && <label className="teacher-linkbox">The join link for {status.game?.name ?? 'the open game'}
            <input readOnly value={linkFor(status.pin)} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
          </label>}
          {copyNote && <p className="teacher-flag">{copyNote}</p>}
          <p>Each game keeps its own PIN, chat and where everyone stood. Close one and reopen it any later lesson; one game is open at a time.</p>
          <form className="teacher-newgame" onSubmit={event => {
            event.preventDefault();
            if (!newGameName.trim()) return;
            void action('game', { name: newGameName, randomNames, vision, ...(newTheme ? { themeId: newTheme.id } : {}) });
            setNewGameName('');
          }}>
            <input aria-label="Name for a new game" placeholder="New game, e.g. 3A Castanyada" maxLength={40}
              value={newGameName} onChange={event => setNewGameName(event.target.value)} />
            <button className="btn btn-primary" disabled={!newGameName.trim()}>New game</button>
            <div className="teacher-map-choice">
              <label>Map for this game <select aria-label="Map for a new game" value={newTheme?.id ?? ''} onChange={event => setNewThemeId(event.target.value)}>
                {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}{theme.id === 'plaza' ? ' · Season 1' : ''}</option>)}
              </select></label>
              {newTheme && <ThemePicture theme={newTheme} />}
              <small>The map stays with this saved game. {newTheme && <Link to={`/studio?theme=${newTheme.id}`}>Try it in Studio</Link>}</small>
            </div>
            <label className="teacher-toggle">
              Vision:
              <select value={vision} onChange={event => setVision(Number(event.target.value))} aria-label="How far students see">
                {VISION_CHOICES.map(([radius, label]) => <option key={radius} value={radius}>{label}</option>)}
              </select>
              Students see only the area around them, and classmates farther away are hidden. You can change it any time.
            </label>
            <label className="teacher-toggle">
              <input type="checkbox" checked={randomNames} onChange={event => setRandomNames(event.target.checked)} />
              Random names: students pick a made-up name and you see who is who. Off: first names, with a surname letter when two match.
            </label>
          </form>
          {status.games.length > 0 && <ul>
            {status.games.map(game => <li key={game.id}>
              <span><strong>{game.name}</strong> · PIN {game.pin} · {[...themes, ...retired].find(theme => theme.id === game.themeId)?.name ?? game.themeId} · {game.randomNames ? 'random names' : 'real first names'} · {game.open ? 'open now' : `last played ${new Date(game.lastOpened).toLocaleDateString()}`}</span>
              <span className="teacher-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => void copyLink(game.pin)} title={linkFor(game.pin)}>{copied === game.pin ? 'Link copied' : 'Copy join link'}</button>
                {!game.open && <button className="btn btn-secondary btn-sm" onClick={() => void action('class', { open: true, game: game.id })}>
                  {status.open ? 'Switch to this game' : 'Open'}
                </button>}
                <button className="btn btn-secondary btn-sm teacher-danger" onClick={() => {
                  if (window.confirm(`Delete "${game.name}"?\n\nThis erases its chat, full submission history, help requests, where everyone stood, their made-up names and its story. The join link stops working. This cannot be undone.`)) {
                    void action('game/delete', { game: game.id, confirm: true });
                  }
                }}>Delete</button>
              </span>
            </li>)}
          </ul>}
        </>}

        {shown === 'vision' && status.game && <>
          <p>How far students see around themselves in <strong>{status.game.name}</strong>. Applies at once.</p>
          <div className="teacher-newgame">
            {VISION_CHOICES.map(([radius, label]) => <button key={radius} className={`btn ${status.game?.vision === radius ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => void action('vision', { radius })}>{label}</button>)}
          </div>
        </>}

        {shown === 'laptop' && status.laptop && <p>Students go to <strong>{status.laptop.signInUrl}</strong> and sign in with Google. They are then sent
          here, to <strong>{status.laptop.url}</strong>, while the class is open.</p>}

        {shown === 'report' && <ClassReport token={token} copy={copyText} />}
      </section>}

      {notice && <p role="alert" className="teacher-error">{notice}</p>}

      {status.game && drawerStudent && <StudentDrawer key={`${status.game.id}:${drawerStudent.studentKey}`} token={token} gameId={status.game.id} student={drawerStudent}
        online={isOnline(drawerStudent.studentKey)} muted={status.muted.includes(drawerStudent.studentKey)}
        soundOff={allSoundOff || !!status.sound?.off.includes(drawerStudent.studentKey)} allSoundOff={allSoundOff}
        who={who} action={action} failed={failed} onClose={closeDrawer} onOpen={setSelectedStudent} />}
      <CommandPalette open={paletteOpen} onClose={closePalette} commands={commands} students={paletteStudents} forStudent={forStudent}
        send={(student, text) => action('help-message', { studentKey: student.studentKey, text, gameId: status.game?.id })} />
    </>}
    {error && <p role="alert" className="teacher-error">{error}</p>}
  </main>;
}

type TabId = 'chat' | 'blocked' | 'map' | 'warmup' | 'campaign' | 'side' | 'history' | 'games' | 'vision' | 'laptop' | 'report';
// label: a word or number of how it stands, beside the title.
type TabInfo = { id: TabId; icon: string; title: string; label?: string };
const TAB_KEY = 'pixelplaza.teacher.tab.v1';

function readTab(): TabId | null {
  try { return localStorage.getItem(TAB_KEY) as TabId | null; } catch { return null; }
}

// The campaign's next step: a chapter to start, or the end.
function nextStep(campaign: CampaignInfo): string {
  return campaign.chapter + 1 < campaign.chapters ? `Start chapter ${campaign.chapter + 2}: ${campaign.chapterTitles?.[campaign.chapter + 1] ?? ''}` : 'End the campaign';
}

// The teacher's star: experience for a good message or report, once each.
function StarButton({ starred, onStar }: { starred?: boolean; onStar: () => void }) {
  return starred ? <span className="teacher-starred">⭐ Starred</span>
    : <button className="btn btn-sm" title={`Give ${XP.teacher} XP for good English`} onClick={onStar}>⭐ +{XP.teacher} XP</button>;
}

// What is special about a campaign, from what it contains.
function features(choice: CampaignChoice): string {
  return [
    choice.mystery ? 'a mystery: find the thief' : 'no mystery',
    choice.witnesses && 'witness exchanges for marked questions',
    choice.partnerQuests && 'partner quests on a quest board',
  ].filter(Boolean).join(' · ');
}

// The chapters in order, numbered; a long run of sessions is shortened, and the gap has no number.
function chapterPreview(chapters: string[]): [number, string][] {
  const numbered = chapters.map((title, index): [number, string] => [index + 1, title]);
  return chapters.length > 6 ? [...numbered.slice(0, 2), [0, `… ${chapters.length - 3} more …`], numbered[numbered.length - 1]] : numbered;
}
