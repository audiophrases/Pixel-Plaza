import { commonsTheme } from './commons.ts';
import type { Theme } from './theme.ts';

export const SCENERY_LAYOUT = 'commons-scene-v1';
export const SCENERY_PRESETS = {
    snow: { name: 'Snowy plaza', ground: 'Snow-covered ground, soft blue shadows and broad clear routes. No exposed grass or summer paving.',
        objects: ['Snow-covered chalet', 'Cozy winter lodge', 'Winter market stall', 'Snowy pine tree', 'Snowy pine tree', 'Rounded snow-covered rock'],
        places: ['Chalet', 'Lodge', 'Winter market', 'Snow square', 'Winter garden'] },
    beach: { name: 'Summer beach', ground: 'Warm pale sand across the playable area, subtle footprints and turquoise water confined to the outer border. No grass, plaza paving or pond.',
        objects: ['Beach bungalow', 'Beach café hut', 'Surf rental hut', 'Palm tree', 'Palm tree', 'Rounded beach rock'],
        places: ['Bungalow', 'Beach café', 'Surf shack', 'Open beach', 'Palm cove'] },
    deck: { name: 'Cruise-ship deck', ground: 'A spacious wooden cruise-ship deck with broad clear routes. Sea and railings only at the outer border. No grass, soil, village streets or pond.',
        objects: ['Passenger cabin', 'Ship lounge', 'Refreshment kiosk', 'Tall sun umbrella', 'Tall sun umbrella', 'Circular hot tub'],
        places: ['Cabins', 'Lounge', 'Kiosk', 'Main deck', 'Sun deck'] },
    custom: { name: 'Custom setting', ground: 'Describe the entire ground surface and atmosphere. Keep all playable ground clear and continuous.',
        objects: ['Large obstacle A', 'Large obstacle B', 'Large obstacle C', 'Tall foreground object A', 'Tall foreground object B', 'Low rounded obstacle'],
        places: ['Place A', 'Place B', 'Place C', 'Meeting area', 'Second meeting area'] },
} as const;
export type SceneryPreset = keyof typeof SCENERY_PRESETS;

export function sceneryTheme(preset: SceneryPreset, id = `scene-${preset}`): Theme {
    const p = SCENERY_PRESETS[preset], base = commonsTheme(id, p.name);
    const image = `/assets/maps/${id}.png`;
    const frame = (n: number): [number, number, number, number] => [n % 3 / 3, Math.floor(n / 3) / 2, 1 / 3, 1 / 2];
    return { ...base, layout: SCENERY_LAYOUT, image: `/assets/maps/${id}-ground.png`,
        scenery: { setting: p.name, ground: p.ground, objects: [...p.objects] },
        zones: base.zones.map((zone, i) => ({ ...zone, name: p.places[i] })),
        layers: [
            ...base.layers!.slice(0, 3).map((layer, n) => ({ ...layer, image, source: frame(n) })),
            ...base.layers!.slice(3).map((layer, n) => ({ ...layer, image, source: frame(n + 3) })),
            { image, source: frame(5), rect: [704, 844, 208, 92] },
        ],
    };
}

export const beachScene = sceneryTheme('beach');
export const artGrid = (theme: Theme) => theme.scenery ? { columns: 3, rows: 2 } : { columns: 2, rows: 2 };
