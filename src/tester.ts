import { saveStudentSession } from './studentAuth';
import type { AvatarConfig } from './utils/AvatarRenderer';

// tester.bat opens http://localhost:8788/?tester=Ana&pin=123456 in each tab. That
// signs the tab in as a made-up student (the tester server accepts it, nobody
// else does) and Login walks straight into the class.
const pinKey = 'pixelplaza.tester.pin';

export function receiveTester(): void {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('tester')?.trim();
  if (!name) return;
  try {
    saveStudentSession({
      studentToken: `tester:${name}`, expiresAt: Date.now() + 12 * 3600 * 1000,
      student: { studentKey: `tester-${name.toLowerCase()}`, displayName: name, className: 'Tester' }
    });
    const pin = params.get('pin');
    if (pin) sessionStorage.setItem(pinKey, pin);
  } catch { /* storage disabled */ }
  history.replaceState(null, '', window.location.pathname);
}

export const testerPin = (): string | null => {
  try { return sessionStorage.getItem(pinKey); } catch { return null; }
};

// A different look for each tester, the same every visit.
export function testerAvatar(name: string): AvatarConfig {
  let seed = 0;
  for (const character of name) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  const pick = (count: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % count; };
  return { skin: pick(20), hairColor: pick(25), hair: pick(29), eyes: pick(37), mouth: pick(41), glasses: pick(17), shirt: pick(28), hat: pick(29) };
}
