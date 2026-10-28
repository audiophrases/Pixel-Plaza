# External AI background workflow

The app prepares a clear request for an external art AI, then imports and previews the returned background. Artwork is created with the teacher's chosen AI outside the app. No app AI key is needed for this handoff.

## Create a brief

1. Open `/studio`. The initial canvas is a neutral gameplay guide, not finished artwork.
2. Choose **Custom setting**, **Snowy plaza**, **Summer beach** or **Cruise-ship deck**, then **New background brief**. These are text presets, not generated maps.
3. Describe the setting, scene, season, campaign and art direction. Optional suggested features and place names can be changed in the brief.
4. Use **Copy AI art prompt** or **Download AI Template**. Give your external art AI the prompt and `layout.png`.

The AI creates **one complete square background**, including terrain and all scenery. It does not need to supply sprite sheets or separate ground/prop files. Nothing requires grass, a fountain, park, pond or bridge.

The ZIP includes:

- `prompt.md`: the setting, campaign/style brief, avatar scale and current geometry.
- `layout.png` / `layout.svg`: solid footprints in red, hiding silhouettes in blue and broad open ground in green. Blue lines show where foreground objects meet the floor.
- `reference.png`: the current preview with an avatar for scale. Before import this is a diagram.
- `story-context.md`: visible place names paired with the existing mission discovery IDs.
- Theme JSON and `instructions.md` for import, checking and installation.

## Keep geometry simple

The starter has **five obstacles and two hiding areas**, plus four straight outer boundaries. Three large features sit near the upper edge, and two small bases belong to the foreground features. The large central routes and gathering places remain open. All five story places are reachable.

Tell the art AI to keep foreground silhouettes simple enough for one oval or a few straight edges. Avoid dense trees, tiny posts, complicated fences, narrow bridges and extra solid decoration. Flat texture and painted decoration can add detail without adding collisions.

This is a starting layout, not a permanent set of objects or positions. Reuse it across settings, or adjust the few areas to fit the returned image. Delete unnecessary areas. Exporting again uses the current geometry, including edits.

## Import and check

1. **Import AI background**. Any square PNG/WebP fits the logical map coordinates; higher resolution does not move the areas. Nonsquare backgrounds are rejected.
2. Choose an area in **Adjust an area**, or click it on the map. Drag and resize it, or edit its X/Y/width/height. Set a hiding area's ground line where the object meets the floor. Existing polygon tools remain available for a simple outline.
3. **Check paths** verifies access to the story places. **Walk around it** uses the game's foot box and speed and previews hiding. Inspect each foreground feature from both sides. The path check cannot judge visual alignment.
4. If the AI adds clutter or awkward passages, ask it for a revision with the same prompt and guide instead of adding many small collision pieces.
5. Give the theme a fresh ID and name. Under **On the server**, sign in, then **Save draft** and **Publish to games**. The background is uploaded to the plaza database with the map. Publishing and the theme download are disabled until a background has been imported; the AI kit can be exported beforehand.

A published map is offered for new games at once, with no restart or deploy. Existing games keep their selected map and positions.

A map file can also be installed from the command line, for a server that does not have that map yet:

```powershell
npm run theme -- "theme.json" --picture "background.png"
```

The installer validates the map and walking access, copies the background into `public/assets/maps/`, saves the JSON and updates the map registry. The server adds it on its next start. A map the server already has is never overwritten, so change those in the studio. Use fresh IDs for releases.

## Missions and existing maps

Use `story-context.md` when asking for matching missions. After installing the map with `npm run theme`, Mission Studio's **Story scenery** selector includes its setting and visible place names in the mission prompt. For an uninstalled brief, paste the context into the mission brief. Saved campaigns retain their original story text and answers.

Pixel Plaza remains Season 1, with its existing collision and hiding work. Garden/Autumn Commons and the older four-cell art-sheet import remain available for existing treatments. The new **background brief** is the default workflow.

## Verification

- `npm run build` checks types and builds the app.
- `node --test worker/tests/scenery.test.mjs worker/tests/commons.test.mjs worker/tests/theme.test.mjs` checks the brief, guide, geometry, installation and existing maps.
- `npm run check:studio` checks drawing, resizing, undo/redo and walking preview.
- `node scripts/check-theme-browser.mjs <local-origin>` checks the complete external-AI handoff in Chrome, including prompt copy, ZIP content, importing a decoding fixture, zone edits and final export. It also checks older Commons imports. Chrome/Chromium and Python 3 are required.
- Add `--tester` only against an isolated local tester server with password `tester` to verify the existing game's Worker/Phaser movement and map picker.

The ready-to-use neutral brief kit is `art/templates/external-background-template.zip`. It contains guides and instructions, not commissioned artwork.
