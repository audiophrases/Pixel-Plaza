import type { LiveEntry } from './LiveClass';

// How the teacher's live views write a time, who a message was for and what became of it, the same everywhere.

// "now", "3m", "1h": how long something has waited, at a glance.
export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  return seconds < 45 ? 'now' : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
}

// Who a message was for, as the students' chat shows it.
export const scope = (entry: LiveEntry) => entry.target ? `🔒 ${entry.target}` : entry.everyone ? '📢 everyone' : '👥 nearby';
export const outcome: Record<string, [string, string]> = {
  approved: ['✓', 'Posted'], rejected: ['✕', 'Not posted'], removed: ['🗑', 'Removed'], blocked: ['⛔', 'Blocked'], pending: ['🕓', 'Waiting for you'],
};
