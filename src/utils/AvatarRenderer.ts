// Represents the user's selected parts
export interface AvatarConfig {
  head?: number;
  skin: number;
  hairColor: number;
  hair: number;
  eyes: number;
  mouth: number;
  glasses: number;
  shirt: number;
  hat: number;
  voice?: string;
}

declare global {
  interface Window {
    CUP_AVATAR: any;
  }
}

export function renderAvatarSvg(avatar: Partial<AvatarConfig> = {}): string {
  const data = window.CUP_AVATAR;
  if (!data) return ''; // Loading fallback

  const part = (key: string) => {
    if (!data.parts[key]) return { svg: '', back: '', front: '' };
    return data.parts[key][(avatar as any)[key] || 0] || data.parts[key][0];
  };
  
  const skinColor = data.skins[avatar.skin || 0] || data.skins[0];
  const hairColorHex = data.hairColors[avatar.hairColor || 0] || data.hairColors[0];

  const base = part('head');
  const hair = part('hair');
  
  const bodyParts = [
    part('shirt').svg || '', 
    base.neck, 
    hair.back || '', 
    base.ears, 
    base.head, 
    base.cheeks,
    part('eyes').svg || '', 
    part('mouth').svg || '', 
    hair.front || '', 
    part('glasses').svg || '', 
    part('hat').svg || ''
  ].join('');

  const coloredBody = bodyParts
    .replace(/#00FFFF/gi, skinColor)
    .replace(/#FF00FF/gi, hairColorHex);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${data.viewBox}" width="100" height="104">${coloredBody}</svg>`;
}

// ---------- The full figure for the map ----------
//
// The portrait above is a bust. On the map each avatar is a paper doll: a head
// that looks the way the student walks, a torso made from the chosen shirt,
// two arms and two legs. Everything is derived from the same eight parts, so
// the saved avatar (and PinPlay's part counts) do not change.
//
// All artwork shares the portrait's units (the head is a circle around 50,45).
// FIGURE_SCALE turns a unit into a screen pixel; each piece is rasterised at
// that size, so the sprites are shown 1:1.

export const FIGURE_SCALE = 0.72;

export type FigurePartName =
  | 'headDown' | 'headUp' | 'headLeft' | 'headRight' // which way the face points
  | 'torsoFront' | 'torsoBack' | 'arm' | 'leg';

// ox, oy: where the sprite pivots, as a fraction of its size.
export type FigurePart = { svg: string; ox: number; oy: number };

const PANTS = ['#3D5A80', '#3A3F4B', '#B08D57', '#25304F', '#5B6B45', '#6B3A3A'];
const SHOE = '#25283F';

export function renderFigureParts(avatar: Partial<AvatarConfig> = {}): Record<FigurePartName, FigurePart> | null {
  const data = window.CUP_AVATAR;
  if (!data) return null;

  const part = (key: string) => {
    if (!data.parts[key]) return { svg: '', back: '', front: '' };
    return data.parts[key][(avatar as any)[key] || 0] || data.parts[key][0];
  };
  const skin: string = data.skins[avatar.skin || 0] || data.skins[0];
  const hairColor: string = data.hairColors[avatar.hairColor || 0] || data.hairColors[0];
  const paint = (svg: string) => svg.replace(/#00FFFF/gi, skin).replace(/#FF00FF/gi, hairColor);

  const base = part('head');
  const hair = part('hair');
  const shirt = part('shirt');
  const shirtColor: string = (shirt.svg || '').match(/fill="(#[0-9a-fA-F]{3,8})"/)?.[1] || '#638ECD';
  const pants = PANTS[(avatar.shirt || 0) % PANTS.length];

  // A rasterised piece covering this box of the shared units.
  const piece = (x: number, y: number, w: number, h: number, anchorX: number, anchorY: number, inner: string): FigurePart => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w * FIGURE_SCALE}" height="${h * FIGURE_SCALE}">${paint(inner)}</svg>`,
    ox: (anchorX - x) / w,
    oy: (anchorY - y) / h
  });

  // Turned heads slide the face toward the walking direction and narrow it.
  const head = (turn: number) => {
    const face = [base.cheeks, part('eyes').svg || '', part('mouth').svg || '', part('glasses').svg || ''].join('');
    return [
      hair.back || '', base.ears, base.head,
      turn ? `<g transform="translate(${50 + turn} 0) scale(.82 1) translate(-50 0)">${face}</g>` : face,
      hair.front || '', part('hat').svg || ''
    ].join('');
  };
  // From behind: hair covers the head (a bald or wigged head shows skin instead).
  const headBack = [
    hair.back || '', base.ears,
    hair.front?.includes('#FF00FF') ? '<circle cx="50" cy="45" r="24" fill="#FF00FF"/>' : base.head,
    hair.front || '', part('hat').svg || ''
  ].join('');

  // Shirt, narrowed to a torso, with the same colour carried down to the hips.
  const extension = `<rect x="24.2" y="95" width="51.6" height="19" rx="5" fill="${shirtColor}"/>
    <rect x="24.2" y="109" width="51.6" height="5" rx="2.5" fill="#25283F" opacity=".15"/>`;
  const shirtFront = `<g transform="translate(50 70) scale(.76 .9) translate(-50 -70)">${shirt.svg || ''}</g>`;
  const shirtBack = `<path d="M16 100 C16 78 32 70 50 70 C68 70 84 78 84 100 Z" fill="${shirtColor}" transform="translate(50 70) scale(.76 .9) translate(-50 -70)"/>`;

  return {
    headDown: piece(0, -4, 100, 104, 50, 69, head(0)),
    headUp: piece(0, -4, 100, 104, 50, 69, headBack),
    headLeft: piece(0, -4, 100, 104, 50, 69, head(-8)),
    headRight: piece(0, -4, 100, 104, 50, 69, head(8)),
    torsoFront: piece(0, 56, 100, 62, 50, 70, extension + shirtFront + base.neck),
    torsoBack: piece(0, 56, 100, 62, 50, 70, extension + shirtBack + base.neck),
    // Sleeve over a bare forearm, pivoting at the shoulder.
    arm: piece(0, 0, 14, 34, 7, 5,
      `<rect x="2" y="13" width="10" height="20" rx="5" fill="#00FFFF"/><rect x="1" y="0" width="12" height="18" rx="5" fill="${shirtColor}"/>`),
    // Trousers over a shoe, pivoting at the hip.
    leg: piece(0, 0, 18, 34, 9, 2,
      `<rect x="1" y="0" width="16" height="25" rx="4" fill="${pants}"/><rect x="0" y="23" width="18" height="11" rx="5" fill="${SHOE}"/><rect x="1" y="30" width="16" height="3" rx="1.5" fill="#FFFFFF" opacity=".5"/>`)
  };
}
