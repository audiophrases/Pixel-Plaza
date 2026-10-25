import type { Theme } from './theme.ts';

// One layout, two treatments. Art changes never move the playable geometry.
export const COMMONS_LAYOUT = 'commons-v1';
export const COMMONS_ATLAS = '/assets/maps/commons-garden.png';
export function commonsTheme(id: string, name: string): Theme {
    const image = `/assets/maps/${id}.png`;
    return {
        id, name, image: `/assets/maps/${id}-ground.svg`, art: 1024, world: 2048,
        layout: COMMONS_LAYOUT, spawn: { x: 460, y: 480 },
        blocked: [[0, 0, 1024, 32], [0, 32, 32, 960], [992, 32, 32, 960], [0, 992, 1024, 32],
            [80, 64, 240, 256], [392, 64, 240, 256], [704, 64, 240, 256]],
        blockedShapes: [{ shape: 'ellipse', rect: [204, 750, 40, 28] }, { shape: 'ellipse', rect: [780, 750, 40, 28] }, { shape: 'ellipse', rect: [704, 844, 208, 92] }],
        walkBehind: [],
        layers: [
            { image, source: [0, 0, 0.5, 0.5], rect: [80, 64, 240, 256] },
            { image, source: [0.5, 0, 0.5, 0.5], rect: [392, 64, 240, 256] },
            { image, source: [0, 0.5, 0.5, 0.5], rect: [704, 64, 240, 256] },
            { image, source: [0.5, 0.5, 0.5, 0.5], rect: [144, 588, 160, 192], sortY: 778 },
            { image, source: [0.5, 0.5, 0.5, 0.5], rect: [720, 588, 160, 192], sortY: 778 },
        ],
        zones: [{ id: 'hotel', rect: [80, 320, 240, 112] }, { id: 'cafe', rect: [392, 320, 240, 112] },
            { id: 'shop', rect: [704, 320, 240, 112] }, { id: 'square', rect: [64, 464, 560, 480] },
            { id: 'park', rect: [656, 464, 304, 480] }],
    };
}

export const gardenCommons = commonsTheme('commons-garden', 'Garden Commons');
export const autumnCommons = commonsTheme('commons-autumn', 'Autumn Commons');

// Ground is deliberately flat. All solid/tall scenery comes from the four art slots.
export function commonsGround(autumn = false): string {
    const p = autumn
        ? { grass: '#a3ac68', dark: '#899454', stone: '#e3cba2', edge: '#c5ab83', tile: '#eedbb8', ink: '#8b775e', accent: '#b56b46' }
        : { grass: '#91b985', dark: '#76a271', stone: '#e6dcc4', edge: '#c7bda8', tile: '#f1e9d6', ink: '#8d9380', accent: '#8aaba2' };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><pattern id="grass" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="${p.grass}"/><path d="M5 9h3m12 15h3m1-20h2" stroke="${p.dark}" stroke-width="2" opacity=".35"/></pattern>
<pattern id="paving" width="32" height="24" patternUnits="userSpaceOnUse"><rect width="32" height="24" fill="${p.stone}"/><path d="M0 0h32M0 12h32M16 0v12M0 12v12M32 12v12" stroke="${p.edge}" opacity=".42"/></pattern></defs>
<rect width="1024" height="1024" fill="url(#grass)"/>
<rect x="32" y="32" width="960" height="960" rx="48" fill="url(#paving)" stroke="${p.dark}" stroke-width="8"/>
<rect x="64" y="464" width="560" height="480" rx="52" fill="${p.tile}" stroke="${p.edge}" stroke-width="4"/>
<rect x="656" y="464" width="304" height="480" rx="52" fill="url(#grass)" stroke="${p.edge}" stroke-width="4"/>
<path d="M656 860h304M800 464v128" fill="none" stroke="${p.stone}" stroke-width="64"/>
<ellipse cx="808" cy="890" rx="104" ry="46" fill="${p.edge}"/><ellipse cx="808" cy="888" rx="96" ry="38" fill="#78b6ba"/><path d="M752 876h30m40 20h42m-78 13h20" stroke="#b9dbd1" stroke-width="3" opacity=".7"/>
<path d="M344 516v376M116 704h456" stroke="${p.edge}" stroke-width="2" opacity=".55"/>
<path d="m344 624 80 80-80 80-80-80z" fill="none" stroke="${p.accent}" stroke-width="5" opacity=".6"/>
${[80, 392, 704].map(x => `<rect x="${x}" y="64" width="240" height="256" rx="12" fill="${p.dark}"/><rect x="${x}" y="320" width="240" height="92" rx="12" fill="${p.tile}" stroke="${p.edge}" stroke-width="3"/>`).join('')}
<g fill="${p.ink}" font-family="sans-serif" font-size="15" font-weight="bold" text-anchor="middle" opacity=".85"><text x="200" y="400">HOTEL</text><text x="512" y="400">CAFÉ</text><text x="824" y="400">SHOP</text></g>
<g fill="none" stroke="${p.edge}" stroke-width="3" opacity=".7"><rect x="92" y="492" width="504" height="424" rx="32"/><rect x="680" y="488" width="256" height="432" rx="32"/></g>
</svg>`;
}
