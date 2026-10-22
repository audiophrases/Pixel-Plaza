// Chat conversations, shared by the server (which decides who a message reaches) and the page
// (which shows a student who will hear them, and sorts what they hear into conversations).

// Nearby chat reaches students within this many map pixels of where the sender stood.
export const HEARING_RANGE = 350;

// "Someone is writing" carries no words, only who. A page reports it at most this often while its
// student writes, and a classmate's page shows it a little longer, so it stays on between reports.
export const TYPING_EVERY_MS = 2000;
export const TYPING_SHOWN_MS = 4500;

// A student's conversations: everyone close by (where the chat starts), everyone in the plaza, the
// teacher, and a private chat with each classmate, under the name the plaza shows for them.
export const NEAR = 'near';
export const ALL = 'all';
export const TEACHER = 'teacher';
export const privateChat = (name: string): string => `p:${name}`;
export const partnerOf = (key: string): string | null => (key.startsWith('p:') ? key.slice(2) : null);

// What a message's conversation is decided from. `conv` pins a notice to the conversation it answers.
export type ChatLine = { sender: string; to?: string; whisper?: boolean; all?: boolean; teacher?: boolean; conv?: string };

export function conversationOf(line: ChatLine, me: string): string {
    if (line.conv) return line.conv;
    if (line.teacher || (line.whisper && line.to === 'Teacher')) return TEACHER;
    if (line.whisper) return privateChat(line.sender === me ? line.to ?? '' : line.sender);
    // Arrivals and departures concern the whole plaza.
    return line.all || line.sender === 'System' ? ALL : NEAR;
}

// Classmates close enough to hear what this student says nearby, nearest first.
export function inEarshot<T extends { id: string; x: number; y: number }>(me: { id: string; x: number; y: number }, players: Iterable<T>): T[] {
    return [...players].filter(player => player.id !== me.id)
        .map(player => ({ player, distance: Math.hypot(player.x - me.x, player.y - me.y) }))
        .filter(({ distance }) => distance <= HEARING_RANGE)
        .sort((a, b) => a.distance - b.distance).map(({ player }) => player);
}

// A namesake arrived and someone's shown name changed: their messages, and the private chat with them, follow.
export function renamed<T extends ChatLine>(lines: T[], from: string, to: string): T[] {
    if (!from || from === to) return lines;
    return lines.map(line => {
        if (line.sender !== from && line.to !== from && line.conv !== privateChat(from)) return line;
        const next = { ...line };
        if (line.sender === from) next.sender = to;
        if (line.to === from) next.to = to;
        if (line.conv === privateChat(from)) next.conv = privateChat(to);
        return next;
    });
}

// A private message opens by itself for a student who is not writing anything, unless the conversation
// they have open is still going: then it waits for them, announced, so nobody is pulled out mid-chat.
export const STILL_TALKING_MS = 20_000;
export function opensItself({ from, open, writing, lastInOpen, now }: { from: string; open: string; writing: boolean; lastInOpen: number; now: number }): boolean {
    return from !== open && !writing && now - lastInOpen >= STILL_TALKING_MS;
}
