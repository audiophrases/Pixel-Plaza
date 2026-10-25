import { commonsTheme } from './commons.ts';
import type { Theme } from './theme.ts';

export const SCENERY_LAYOUT = 'simple-background-v1';
export const SCENERY_PRESETS = {
    snow: { name: 'Snowy plaza', ground: 'Snow-covered ground, soft blue shadows and broad clear routes. No exposed grass or summer paving.',
        objects: ['Snow-covered chalet', 'Cozy winter lodge', 'Winter market stall', 'Snowy pine tree', 'Snowy pine tree'],
        places: ['Chalet', 'Lodge', 'Winter market', 'Snow square', 'Winter garden'] },
    beach: { name: 'Summer beach', ground: 'Warm pale sand across the playable area, subtle footprints and turquoise water confined to the outer border. No grass, plaza paving or pond.',
        objects: ['Beach bungalow', 'Beach café hut', 'Surf rental hut', 'Palm tree', 'Palm tree'],
        places: ['Bungalow', 'Beach café', 'Surf shack', 'Open beach', 'Palm cove'] },
    deck: { name: 'Cruise-ship deck', ground: 'A spacious wooden cruise-ship deck with broad clear routes. Sea and railings only at the outer border. No grass, soil, village streets or pond.',
        objects: ['Passenger cabin', 'Ship lounge', 'Refreshment kiosk', 'Tall sun umbrella', 'Tall sun umbrella'],
        places: ['Cabins', 'Lounge', 'Kiosk', 'Main deck', 'Sun deck'] },
    custom: { name: 'Custom setting', ground: 'Describe the entire ground surface and atmosphere. Keep all playable ground clear and continuous.',
        objects: ['Simple solid feature A', 'Simple solid feature B', 'Simple solid feature C', 'Tall feature A', 'Tall feature B'],
        places: ['Place A', 'Place B', 'Place C', 'Meeting area', 'Second meeting area'] },
} as const;
export type SceneryPreset = keyof typeof SCENERY_PRESETS;

export function sceneryTheme(preset: SceneryPreset, id = `scene-${preset}`): Theme {
    const p = SCENERY_PRESETS[preset], base = commonsTheme(id, p.name);
    delete base.layers;
    return { ...base, layout: SCENERY_LAYOUT, image: `/assets/maps/${id}-background.png`,
        scenery: { format: 'background', setting: p.name, ground: p.ground, objects: [...p.objects] },
        zones: base.zones.map((zone, i) => ({ ...zone, name: p.places[i] })),
        blockedShapes: base.blockedShapes!.slice(0, 2),
        walkBehind: [
            { shape: 'ellipse', rect: [144, 588, 160, 166], sortY: 778 },
            { shape: 'ellipse', rect: [720, 588, 160, 166], sortY: 778 },
        ],
    };
}

export const isBackgroundBrief = (theme: Theme) => theme.scenery?.format === 'background';
export const artGrid = (theme: Theme) => theme.scenery && !isBackgroundBrief(theme) ? { columns: 3, rows: 2 } : { columns: 2, rows: 2 };
