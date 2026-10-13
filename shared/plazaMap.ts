// The map the plaza is played on: the theme in shared/themes/plaza.json, ready for the game and the server to use.
// To change the map, edit that file with the theme studio (/studio). Press F2 in the game to see the walls, the
// walk-behind areas and the zones drawn over the art.
import plazaTheme from './themes/plaza.json' with { type: 'json' };
import { MAX_SPEED, makeWorld, type Theme } from './theme.ts';

export type { Point, Rect, Theme, WalkBehind, Zone } from './theme.ts';
export { MAX_SPEED };

// The themes there are, by id. A new one is a new file in shared/themes/ and a line here.
export const themes: Record<string, Theme> = { plaza: plazaTheme as unknown as Theme };

export const plazaMap: Theme = themes.plaza;
const world = makeWorld(plazaMap);

export const ART = plazaMap.art; // width and height of the picture
export const MAP_SIZE = plazaMap.world;
export const SCALE = world.scale;

// The same data in world pixels, and the checks the server and the page make
export const { worldRects, worldZones, SPAWN, zoneAt, isBlocked, legalMove } = world;
