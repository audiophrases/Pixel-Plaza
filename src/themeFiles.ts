import { COMMONS_LAYOUT } from '../shared/commons';
import { layoutGuide, sheetGuide, templateTextFiles } from '../shared/artTemplate';
import type { Theme } from '../shared/theme';
import { isBackgroundBrief } from '../shared/scenery';
import { zipFiles } from '../shared/zip';

export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function loadPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The picture could not be opened.'));
    img.src = url;
  });
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not make the template picture.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function svgPng(svg: string, size: number, height = size): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = await loadPicture(url), canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0, size, height);
    return await canvasPng(canvas);
  } finally { URL.revokeObjectURL(url); }
}

export async function downloadArtTemplate(theme: Theme, direction: string, background: string, sheet?: string) {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(templateTextFiles(theme, direction)).map(([path, text]) => [path, encoder.encode(text)]));
  files['layout.png'] = await svgPng(layoutGuide(theme), theme.art);
  if (theme.layout === COMMONS_LAYOUT || theme.scenery && !isBackgroundBrief(theme)) files['art-sheet-guide.png'] = await svgPng(sheetGuide(theme), theme.scenery ? 1536 : 1024, 1024);
  const canvas = document.createElement('canvas'); canvas.width = theme.art; canvas.height = theme.art;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(await loadPicture(background), 0, 0, theme.art, theme.art);
  const images = new Map<string, HTMLImageElement>();
  for (const layer of theme.layers ?? []) {
    const url = sheet ?? layer.image;
    if (!images.has(url)) images.set(url, await loadPicture(url));
    const image = images.get(url)!;
    const [x, y, w, h] = layer.source;
    ctx.drawImage(image, x * image.width, y * image.height, w * image.width, h * image.height, ...layer.rect);
  }
  // A representative 95-world-pixel figure, consistent with the game's scale.
  const s = theme.art / theme.world, { x, y } = theme.spawn;
  ctx.fillStyle = '#325b8b'; ctx.fillRect(x - 12 * s, y - 65 * s, 24 * s, 65 * s);
  ctx.fillStyle = '#f7cfa5'; ctx.beginPath(); ctx.arc(x, y - 82 * s, 13 * s, 0, Math.PI * 2); ctx.fill();
  files['reference.png'] = await canvasPng(canvas);
  downloadFile(`${theme.id}-ai-template.zip`, zipFiles(files), 'application/zip');
}
