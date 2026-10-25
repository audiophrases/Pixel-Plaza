import { COMMONS_LAYOUT } from './commons.ts';
import { formatTheme, type Theme } from './theme.ts';
import { sceneryPrompts } from './sceneryPrompts.ts';
import { isBackgroundBrief } from './scenery.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function layoutGuide(theme: Theme): string {
    const shape = (piece: NonNullable<Theme['blockedShapes']>[number], colour: string) => piece.shape === 'ellipse'
        ? `<ellipse cx="${piece.rect[0] + piece.rect[2] / 2}" cy="${piece.rect[1] + piece.rect[3] / 2}" rx="${piece.rect[2] / 2}" ry="${piece.rect[3] / 2}" fill="${colour}"/>`
        : `<polygon points="${piece.points.map(p => p.join(',')).join(' ')}" fill="${colour}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${theme.art}" height="${theme.art}" viewBox="0 0 ${theme.art} ${theme.art}">
<rect width="100%" height="100%" fill="#edf6e9"/>
${theme.blocked.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d9a5a1"/>`).join('')}
${(theme.blockedShapes ?? []).map(p => shape(p, '#b96358')).join('')}
${theme.walkBehind.map(p => shape(p, '#7b9cd488')).join('')}
${theme.walkBehind.map(p => {
        const xs = p.shape === 'ellipse' ? [p.rect[0], p.rect[0] + p.rect[2]] : p.points.map(point => point[0]);
        return `<path d="M${Math.min(...xs)} ${p.sortY}H${Math.max(...xs)}" stroke="#28598d" stroke-width="3"/>`;
    }).join('')}
${(theme.layers ?? []).filter(p => p.sortY !== undefined).map(p => `<rect x="${p.rect[0]}" y="${p.rect[1]}" width="${p.rect[2]}" height="${p.rect[3]}" fill="#80a9db66"/><path d="M${p.rect[0]} ${p.sortY}h${p.rect[2]}" stroke="#28598d" stroke-width="3"/>`).join('')}
${theme.zones.map(z => `<rect x="${z.rect[0]}" y="${z.rect[1]}" width="${z.rect[2]}" height="${z.rect[3]}" fill="none" stroke="#478559" stroke-width="2" stroke-dasharray="8 5"/><text x="${z.rect[0] + 10}" y="${z.rect[1] + 26}" font-family="sans-serif" font-size="20" fill="#224c31">${esc(z.name ?? z.id)}</text>`).join('')}
<g transform="translate(${theme.spawn.x} ${theme.spawn.y}) scale(${theme.art / theme.world})" fill="#325b8b"><circle cy="-82" r="13"/><rect x="-12" y="-65" width="24" height="65" rx="4"/><text x="40" y="0" font-family="sans-serif" font-size="30">start · avatar scale</text></g>
<rect x="${theme.art * .3}" y="${theme.art - 30}" width="${theme.art * .4}" height="24" rx="6" fill="white"/><text x="50%" y="${theme.art - 12}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#334155">RED: solid · BLUE: walk behind · GREEN: open ground</text></svg>`;
}

export function sheetGuide(theme?: Theme): string {
    const labels = theme?.scenery?.objects ?? ['HOTEL', 'CAFÉ', 'SHOP', 'TREE'];
    const columns = theme?.scenery ? 3 : 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 512}" height="1024" viewBox="0 0 ${columns * 512} 1024"><rect width="100%" height="100%" fill="#f3f0e8"/>
${labels.map((label, i) => {
        const name = esc(label.slice(0, 30));
        const x = i % columns * 512, y = Math.floor(i / columns) * 512;
        return `<g transform="translate(${x} ${y})"><rect x="16" y="16" width="480" height="480" rx="12" fill="white" stroke="#708b83" stroke-width="3" stroke-dasharray="12 8"/><text x="256" y="74" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#31594d">${name}</text><path d="M256 108v360M64 496h384" stroke="#a5b3ac" stroke-width="2" stroke-dasharray="6 6"/><circle cx="256" cy="496" r="8" fill="#31594d"/><text x="256" y="320" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#637b72">One isolated transparent sprite</text><text x="256" y="350" text-anchor="middle" font-size="16" font-family="sans-serif" fill="#637b72">Keep inside this 512 × 512 cell</text></g>`;
    }).join('')}</svg>`;
}

export function artInstructions(theme: Theme, direction: string): string {
    if (theme.scenery) return sceneryPrompts(theme, direction).instructions;
    return `# Pixel Plaza art brief — ${theme.name}\n\nCreative direction: ${direction.trim() || 'A welcoming seasonal village, consistent with the reference.'}\n\n${theme.layout === COMMONS_LAYOUT ? `Create a square PNG or WebP with TRUE TRANSPARENCY, in a precise 2 × 2 grid of equal cells. 1024 × 1024 or 2048 × 2048 both work. This is an art sheet, not a finished map.\n\nAt 1024 pixels:\n- Top left [0,0,512,512]: hotel facade.\n- Top right [512,0,512,512]: café facade.\n- Bottom left [0,512,512,512]: shop facade.\n- Bottom right [512,512,512,512]: one tree.\n\nFront-facing, slightly elevated orthographic view. Match the reference's camera and avatar scale. Use one consistent pixel-art style. Keep each object entirely in its own cell with 16 pixels of transparent padding. Buildings have a wide foundation and central entrance, ending at cell y=500; fill most of the cell. Tree: broad rounded crown, short trunk centered at cell x=256, trunk base at y=500. The app fits pieces into fixed slots and uses the tree's transparency for walking behind it.\n\nRich detail belongs on facades, roofs and crowns. No terrain, surrounding ground, paths, characters, fences, bridges, posts, scene backgrounds, grid lines, labels, or checkerboard baked into the image. Preserve the slot order. Seasonal decorations stay attached to the objects. Do not add objects between the slots.\n\nReturn just the transparent art sheet. Do not draw the layout guide or its labels.\n\n## Preview and install\n\n1. Open /studio?theme=${theme.id}. Choose **New treatment**, then **Open AI art sheet**.\n2. Check the preview and **Walk around it**. Walk behind both trees from north and south.\n3. Name the treatment, choose an unused id and download the theme file.\n4. Run: npm run theme -- "path/to/downloaded-theme.json" --sheet "path/to/ai-art.png"\n5. Restart the server (or build and deploy). Select the new map when creating a game. Existing games keep their maps.\n\nThe ground and all ten collision pieces remain fixed. Do not import the art sheet as the background picture. A new 2K sheet requires no geometry edits.` : `Create a square ${theme.art} × ${theme.art} background using layout.png and reference.png. Keep all red areas solid, the green ground clear, and the spawn and named places unchanged. Blue marks walk-behind areas; their silhouettes need a visual check in Studio. No characters or text labels. Open the finished art with **Open a picture**; the map's coordinate size stays fixed.`}\n\n## Files\n\n- layout.png: gameplay geometry, not finished artwork.\n- reference.png: current appearance with avatar scale.\n- art-sheet-guide.png: slot positions (Commons only).\n- ${theme.id}.json: geometry and art placement.\n\nLayout: ${theme.layout ?? theme.id}. World: ${theme.world} × ${theme.world}. Art coordinates: ${theme.art} × ${theme.art}.\n`;
}

export function templateTextFiles(theme: Theme, direction: string): Record<string, string> {
    if (theme.scenery) {
        const prompts = sceneryPrompts(theme, direction);
        if (isBackgroundBrief(theme)) return { 'instructions.md': prompts.instructions, 'prompt.md': prompts.background,
            'story-context.md': prompts.context, [`${theme.id}.json`]: formatTheme(theme), 'layout.svg': layoutGuide(theme) };
        return { 'instructions.md': prompts.instructions, 'ground-prompt.md': prompts.ground, 'scenery-prompt.md': prompts.objects,
            'story-context.md': prompts.context, [`${theme.id}.json`]: formatTheme(theme), 'layout.svg': layoutGuide(theme), 'art-sheet-guide.svg': sheetGuide(theme) };
    }
    return { 'instructions.md': artInstructions(theme, direction), [`${theme.id}.json`]: formatTheme(theme), 'layout.svg': layoutGuide(theme),
        ...(theme.layout === COMMONS_LAYOUT ? { 'art-sheet-guide.svg': sheetGuide() } : {}) };
}
