// Each name keeps one colour, readable on white, for its sender line and its initial.
const SHADES = ['#c2185b', '#7b1fa2', '#3949ab', '#0277bd', '#00796b', '#558b2f', '#e65100', '#6d4c41'];
export const shade = (name: string) => SHADES[[...name].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7) % SHADES.length];
