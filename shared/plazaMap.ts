// The map the plaza is played on: the theme in shared/themes/plaza.json, ready for the game and the server to use.
// To change the map, edit that file with the theme studio (/studio). Press F2 in the game to see the walls, the
// walk-behind areas and the zones drawn over the art.
import { MAX_SPEED, makeWorld, type Theme } from './theme.ts';
import { themes } from './themeCatalog.ts';

export type { Point, Rect, Theme, WalkBehind, Zone } from './theme.ts';
export { MAX_SPEED };

// The original map's compatibility exports, used by existing missions and tests.
// New maps are installed and registered by npm run theme; games select from themeCatalog.
export { themes };

export const plazaMap: Theme = themes.plaza;
const world = makeWorld(plazaMap);

export const ART = plazaMap.art; // width and height of the picture
export const MAP_SIZE = plazaMap.world;
export const SCALE = world.scale;

// The same data in world pixels, and the checks the server and the page make
export const { worldRects, worldZones, SPAWN, zoneAt, isBlocked, legalMove } = world;
