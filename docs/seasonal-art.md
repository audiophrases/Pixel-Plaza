# Complete scenery and seasonal art

## Change the whole setting

Studio starts on **Summer beach**, a finished example with sand, beach huts, two palms and a rock. Choose **New scenery** to start a **Snowy plaza**, **Summer beach**, **Cruise-ship deck** or **Custom setting** brief. Snow and cruise-deck presets contain prompts and a layout guide; their illustrations still need to be generated. Existing Garden/Autumn Commons and Pixel Plaza remain available.

The simple gameplay geometry is reusable, while every visible surface and object can change. There is no required fountain, grass, pond or bridge. The three large obstacles can be cabins, huts, snowbanks or other solid objects. The two tall foreground pieces can be trees, umbrellas or other appropriate silhouettes. The low oval can be a rock, hot tub or another solid feature. The template has ten collision pieces, two foreground anchors and five places. It keeps the routes generous and avoids tracing new hiding masks.

1. Pick a preset, press **New scenery**, and edit the setting, ground, six object descriptions and visible place names. Add your art direction.
2. **Download AI Template**. The ZIP contains `ground-prompt.md`, `scenery-prompt.md`, `story-context.md`, visual guides, a reference, instructions and theme JSON. The two art prompts can also be read and copied in Studio.
3. Give the art AI the ground prompt and layout guide. Generate a square opaque ground image with a clear playable interior. Snow, sand or deck planks can cover the whole interior; water and other impassable terrain belong at the outer edge.
4. Give it the scenery prompt, three-column/two-row sheet guide, and generated ground as a style reference. Generate six isolated sprites with real transparency. The recommended sheet is 1536 × 1024; normalized crops also support other sizes. Ground must be square; a scenery sheet may be rectangular.
5. **Open AI ground**, then **Open AI art sheet**. The preview uses both files without changing collision geometry. Walk around the obstacles, behind both tall objects and around the low oval. Inspect silhouettes and bases; the alpha and reachability checks cannot judge whether artwork fits perfectly.
6. Choose a fresh ID and name, download the theme file and install both images:

   ```powershell
   npm run theme -- "theme.json" --picture "ground.png" --sheet "scenery.png"
   ```

7. Restart locally, or build and deploy through the usual workflow. Select the scenery when creating a new game.

In **Mission Studio → Create with an AI prompt → Story scenery**, choose the installed scenery to include its setting and visible place names in the prompt. For an uninstalled draft, paste `story-context.md` into the mission brief. Discovery IDs stay compatible with the current story schema; visible names can change. Existing campaigns retain their authored text and answers. Create or adapt an adventure for the new setting before playing it.

The beach assets' actual generation prompts and dimensions are recorded in `art/scenery-prompts.md`. Their source definition is `shared/scenery.ts`. The ground is independent of the transparent sheet, so a recolor can reuse existing objects or a prop-only variant can reuse existing terrain.

## Original Commons treatments

The original Pixel Plaza is still `plaza` (Season 1). Existing games migrate to that map automatically. New games have a map picker: Pixel Plaza, Garden Commons, Autumn Commons and installed treatments. A game's map id is saved alongside its PIN. Reopening it restores the same map and its own student positions. The renderer, server movement checks, discovery zones and teacher map use that selection.

## Try it

Choose Garden Commons, Autumn Commons or Pixel Plaza in **Choose a map**. **Walk around it** uses the real foot box and movement speed; **Check paths** verifies the gathering areas and highlights disconnected ground. The original drawing tools remain available.

The Commons has five places: hotel, café, shop, square and park. It uses ten collision pieces: four straight boundaries, three building footprints, two tree bases and a pond. There are two intentional walk-behind trees. Streets are broad, the square is open, and the park has routes around the pond rather than a narrow bridge. The original map has 159 collision pieces and 34 traced walk-behind shapes.

## Make the next treatment

1. Select a Commons map, describe your season, and press **Download AI Template**.
2. Unzip it. Give the art AI `instructions.md`, `art-sheet-guide.png`, and `reference.png`. `layout.png` shows the gameplay geometry.
3. Ask for a square **transparent art sheet**. There are four equal cells: hotel at top left, café at top right, shop at bottom left, one tree at bottom right. Use a consistent front-facing, slightly elevated camera. The guide gives the padding and ground anchors.
4. Choose **New treatment** in Studio, then **Open AI art sheet**. Opening art on a built-in map also creates a draft automatically. The sheet is checked for a square shape, four nonempty cells and real transparency. A checkerboard painted onto an opaque image is rejected.
5. Inspect the building bases. Walk behind and in front of both trees, and try the routes around them. Choose a new name and an unused id. Download the theme file.
6. Install the downloaded JSON and art:

   ```powershell
   npm run theme -- "C:\Users\Admin\Downloads\commons-winter.json" --sheet "C:\Users\Admin\Downloads\winter-art.png"
   ```

   An id alone finds the newest matching JSON in Downloads:

   ```powershell
   npm run theme -- commons-winter --sheet "C:\path\to\winter-art.png"
   ```

7. Restart the local server, or build and deploy through the project's usual workflow. Select the new treatment when creating a game.

No AI API key is needed in the app for this workflow. Do not use **Open a picture** for the four-cell sheet: that control replaces the ground/background.

The installer validates the file, verifies walking access, checks the art, copies it into `public/assets/maps/`, writes `shared/themes/<id>.json`, and updates `shared/themes/installed.ts`. Missing art or invalid input is rejected before installed files change. Use a fresh id for each released season: editing a registered theme's geometry would affect games that use that id.

## Why an art sheet

It is easier to generate four isolated pieces than to make an AI reproduce an entire map's boundaries exactly. The app fits each cell into a fixed placement. Transparent tree pixels are drawn at the tree's ground depth, so a changed canopy needs no manually traced hiding mask. Each tree's base still needs to line up visually with its small collision footprint. Placement and silhouette checks remain necessary.

The ground is a fixed SVG with paving, grass, broad gathering areas and a pond. It has no narrow gates, bridge deck, tiny posts or individual decorative collisions. Seasonal palettes are generated by `commonsGround()` in `shared/commons.ts`; the two served `*-ground.svg` files are tracked assets. A new treatment can reuse either ground. This first workflow changes buildings and trees; it does not ask an AI to redraw terrain.

`Theme.layers` contains transparent image pieces. Each `source` rectangle uses fractions of the art-sheet dimensions; each destination `rect` uses logical art coordinates. A 1024px, 1254px or 2048px square sheet therefore uses the same 1024-coordinate Commons map. A `sortY` makes a layer a foreground piece. The renderer uses the image's alpha, while the original map continues to use its existing ellipse/polygon masks.

Background picture import also preserves logical map size. Larger square artwork fits the existing geometry. Nonsquare pictures are rejected instead of stretched.

## Stories and saved games

The five existing discovery zone ids are preserved, so current location-triggered clues work. The Commons includes a pond and a café, hotel and shop. Story text specifically describing the original bridge, fences or fountain should be adapted in Mission Studio for this layout. The map picker does not rewrite authored story text. Hiding is visual depth; it does not implement stealth or change the existing distance-based vision rules.

The map id is persisted; there is no live map-changing control for an existing game. Create another game to use another season. Original maps and their saved positions are retained. No production deployment is performed by Studio or the theme installer.

## Validation and previews

- `npm test`: build, theme geometry, art-sheet transparency, import/installation checks and Worker regression tests. The map integration test covers different collision geometry, invalid ids, switching maps, reconnecting and a Worker restart.
- `npm run check:studio`: drawing tools, undo/redo, reachability and the walking preview. Counts are relative to existing shapes.
- Start `npm run dev`, then `npm run check:themes`: real Chrome rendering, walking previews, ZIP/PNG export, a 2K art-sheet import, full scenery presets, editable labels, six-cell imports and nonsquare rejection. This optional check needs Chrome/Chromium (or `CHROME_PATH`) and Python 3 for independent ZIP validation.
- Against an **isolated tester server** with the password `tester`, `node scripts/check-theme-browser.mjs http://127.0.0.1:8797 --tester` also verifies real Phaser movement through the Worker, captures both sides of the foreground pieces and checks the scenery-specific mission prompt. Use this flag only for a throwaway tester server.

Browser screenshots and a flattened autumn reference are in `art/previews/`. The AI sheets are `public/assets/maps/commons-garden.png` and `commons-autumn.png`. Their generation prompts are recorded in `art/commons-prompts.md`.

The ready-made autumn AI kit is `art/templates/commons-autumn-ai-template.zip`. You can use it directly or export a fresh one with your own brief in Studio.

The complete beach kit is `art/templates/scene-beach-ai-template.zip`. It includes separate ground and scenery prompts and `story-context.md`, along with the three-column/two-row guide.

Group comfort and artistic preference still need a human playtest. Automated checks cover geometry, import/export, image alpha, UI behavior and Worker integration.
