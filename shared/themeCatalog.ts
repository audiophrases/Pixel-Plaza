import plaza from './themes/plaza.json' with { type: 'json' };
import { autumnCommons, gardenCommons } from './commons.ts';
import { makeWorld, type Theme } from './theme.ts';
import { installedThemes } from './themes/installed.ts';
import { beachScene } from './scenery.ts';

export const themes: Record<string, Theme> = { plaza: plaza as unknown as Theme, [gardenCommons.id]: gardenCommons, [autumnCommons.id]: autumnCommons, [beachScene.id]: beachScene, ...installedThemes };
export const DEFAULT_THEME = 'plaza'; // Old games and clients always keep the original map.
export function getTheme(id?: string | null): Theme { return typeof id === 'string' && Object.hasOwn(themes, id) ? themes[id] : themes[DEFAULT_THEME]; }
export function hasTheme(id: unknown): id is string { return typeof id === 'string' && Object.hasOwn(themes, id); }
const worlds = Object.fromEntries(Object.values(themes).map(theme => [theme.id, makeWorld(theme)]));
export function getWorld(id?: string | null): ReturnType<typeof makeWorld> { return worlds[getTheme(id).id]; }
