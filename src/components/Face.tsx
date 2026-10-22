import { renderFaceSvg, type AvatarConfig } from '../utils/AvatarRenderer';
import { shade } from '../utils/shade';

// A classmate is shown by their avatar's face, so a student finds a conversation by who it is with.
const faces = new Map<string, string>();
function faceUrl(look: Partial<AvatarConfig>): string {
  const key = JSON.stringify([look.head, look.skin, look.hairColor, look.hair, look.eyes, look.mouth, look.glasses, look.shirt, look.hat]);
  const known = faces.get(key);
  if (known) return known;
  const svg = renderFaceSvg(look);
  if (!svg) return ''; // the artwork has not loaded yet
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  faces.set(key, url);
  return url;
}

export default function Face({ player, name, icon }: { player?: Partial<AvatarConfig> | null; name?: string; icon?: string }) {
  const url = player ? faceUrl(player) : '';
  return <span className="chat-face" style={!icon && !url && name ? { background: shade(name) } : undefined} aria-hidden="true">
    {icon ?? (url ? <img src={url} alt="" /> : (name || '?').slice(0, 1).toUpperCase())}
  </span>;
}
