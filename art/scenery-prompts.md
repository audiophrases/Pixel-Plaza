# Full scenery example: Summer beach

Generated using the built-in image-generation tool. The ground used `transparent_background: false`; the object sheet used `transparent_background: true`. Files were copied from the generated outputs without repainting or resizing.

- `public/assets/maps/scene-beach-ground.png`: opaque 1254 × 1254 ground.
- `public/assets/maps/scene-beach.png`: 1536 × 1024 RGBA, six sprites in a 3 × 2 grid. The installer and browser check visibility and transparency in each cell.

Snow and cruise-deck are editable prompt presets, not additional finished illustrations. Each uses the same ground-plus-six-objects workflow. Studio exports the actual current brief, including edits and place names.

## Ground prompt

Use case: stylized-concept. Create a finished 1024x1024 square top-down RPG beach ground image for a social game. This is only the GROUND layer. Warm pale cream sand covers the entire central 960x960 pixels. Fine natural sand grain, a few extremely subtle flat ripples, soft sunlight, refined cozy pixel-art/16-bit illustration. A very narrow turquoise ocean border confined to the outermost 32 pixels on all four sides, so the image reads as a sunny sandy island surrounded by water. The whole inner square must be continuous walkable sand, edge to edge, with NO water, pond, grass, paving or objects anywhere inside it. Absolutely NO buildings, palm trees, rocks, furniture, paths, signs, flowers, people, icons, grid or text. The game adds every obstacle separately. No perspective horizon: camera looks down. This is a usable calm terrain asset, not a diagram. Opaque background.

## Object sheet prompt

Use case: stylized-concept. Production TRUE TRANSPARENT PNG art sheet for a cozy summer beach RPG. Landscape 1536x1024, exactly THREE columns and TWO rows of equal cells. Six isolated objects, centered one per cell, no borders or labels. TOP ROW left to right: (1) welcoming tropical beach bungalow, (2) charming beach cafe hut with a striped awning, (3) surf-rental hut with colorful surfboards attached to its facade. BOTTOM ROW left to right: (4) one lush palm tree with short sturdy trunk, (5) a different lush palm tree with a short sturdy trunk, (6) one round warm gray coastal boulder seen from slightly above, no ground. Front-facing slightly elevated orthographic village-game camera, polished detailed 16-bit pixel-art illustration, cheerful cream/teal/coral palette. Objects fit inside their own cells with transparent padding. Buildings fill most of their cells, broad foundations, entrance centered at bottom. Palm trunk bases exactly centered horizontally and near bottom of cell; broad canopy stays inside cell. The rock should be roughly circular in its cell; the app fits it into a low oval. No sand, ground planes, shadows extending beyond objects, sea, background scenery, people, text, watermark or checkerboard drawn into the image. Preserve genuine alpha. Exactly six sprites in a precise 3x2 grid.
