# Commons artwork generation

Generated with the built-in image-generation tool, with `transparent_background: true`. Original outputs were copied into this repository without resizing or repainting. Both PNGs are 1254 × 1254 with alpha. Fractional source rectangles make that size work with the 1024-coordinate layout.

- Garden sheet: `public/assets/maps/commons-garden.png`
- Autumn sheet: `public/assets/maps/commons-autumn.png`

## Shared prompt

Use case: stylized-concept. Asset type: production transparent sprite sheet for Pixel Plaza, a friendly social game. Create a square 1024x1024 PNG with TRUE transparent background and EXACTLY four isolated sprites in a precise 2x2 grid of equal 512x512 cells. No panel borders, no labels, no captions. Each sprite must remain completely inside its cell, with 16px transparent padding. Front-facing slightly elevated orthographic cozy pixel-art buildings, detailed polished 16-bit RPG illustration matching a charming village. Consistent camera and scale. Upper left cell: a small two-storey hotel with a central door and red tiled roof. Upper right: a small cafe with a striped awning and central door. Lower left: a small general shop with blue tiled roof and display window. Lower right: ONE broad round deciduous tree with a sturdy short trunk, its bottom at cell y=500 centered at x=256, crown centered horizontally, no scenery or ground plane. Buildings each fill most of their cell, roof near top, wide facade, foundation ending at y=500, no narrow projecting objects or steps extending outside cell. Each building has a broad stone foundation, central entrance, decorative window boxes and warm welcoming details contained on facade. Empty alpha around each object. No characters, no roads, no benches, no lamp posts, no fence, no surrounding vegetation, no checkerboard texture, no ground. Crisp clean silhouettes are essential. Use all four cells.

## Garden suffix

Season: late spring garden village. Fresh green tree canopy, sage foliage, cream plaster, terracotta red hotel roof, teal cafe awning, blue shop roof, soft warm daylight.

## Autumn suffix

Season: cozy autumn chestnut festival village. Amber and copper tree canopy, cream and ochre plaster, red terracotta hotel roof, burgundy cafe awning, dark teal shop roof. Small orange pumpkins only ON the building foundations, autumn garlands on facades. Soft warm afternoon light.

## Acceptance

Both outputs preserve the four-cell order and real transparency. The generator returned 1254px sheets instead of the requested 1024px; they work directly because crops are fractional. The trees fit the fixed ground anchors without a traced polygon. Visual review is still part of accepting a new treatment; the template is a guide, not a guarantee that an AI will honor every boundary.
