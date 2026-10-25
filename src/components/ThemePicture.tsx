import type { ArtLayer, Theme } from '../../shared/theme';

export function ArtPiece({ layer, image }: { layer: ArtLayer; image?: string }) {
  const [x, y, width, height] = layer.rect;
  return <svg x={x} y={y} width={width} height={height} viewBox={layer.source.join(' ')} preserveAspectRatio="none" overflow="hidden" pointerEvents="none">
    <image href={image ?? layer.image} width="1" height="1" preserveAspectRatio="none" />
  </svg>;
}

export default function ThemePicture({ theme, className }: { theme: Theme; className?: string }) {
  return <svg className={className} viewBox={`0 0 ${theme.art} ${theme.art}`} role="img" aria-label={theme.name} style={{ display: 'block', width: '100%', imageRendering: 'pixelated' }}>
    <image href={theme.image} width={theme.art} height={theme.art} />
    {theme.layers?.map((layer, index) => <ArtPiece key={index} layer={layer} />)}
  </svg>;
}
