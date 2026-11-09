# Season 3 — The Trophy That Walked

A funny school mystery in four chapters. The trophy is missing. A giant duck carried a cup away. Each student has a different picture. They talk to solve the case.

**Look at your picture. Tell your team. Answer together.**

## What is included

- Four chapters with two short questions and one chat-supported report each.
- Sixteen private picture clues: symbols, objects, clothes, notes and signs.
- Four illustrated story moments, shown only at the appropriate opening or ending.
- English text and matching Catalan help throughout the campaign.
- Six separately importable warm-ups, each about 3–5 minutes.
- The exact Season 2 campus art and map geometry.

Open `teacher-preview.html` in a browser to review the whole pack: picture cards, tasks, answers, reveals and warm-ups. It works offline and contains spoilers.

Use 15–20 minutes per chapter, plus a warm-up. Start in case teams; four students per team lets everyone hold a different role. Two or more players can use the app’s existing missing-role fallback. Students share their different pictures in Team chat, then submit one shared answer in the Journal. Each chapter ends with a chat question and a short report using sentence starters, just like the current Season 2 flow. If running without case teams, use normal class chat instead; students then submit their own answers.

## Install

1. Keep using **Protocol 8:15 · Storm campus**, the Season 2 map. If it is not installed, open `theme.json` and import `art/campus.png` in Map Studio, then publish the map.
2. In Mission Studio, import `the-trophy-that-walked-season-3.zip` or `campaign.json`. Review and publish. Start **The Trophy That Walked** in a new game on the Season 2 map.
3. For one lesson, import a file from `chapters/` instead. Each standalone chapter includes its own role clues and an ending appropriate to that chapter.
4. Import warm-ups separately through the Warm-up editor. See `warmups/README.md` for the matching types and save behaviour.

The pack uses private role pictures, so use an app version with `roleClueImages` support. The pack is editable content; no app deployment or hardcoded mission registration is needed. Importing creates a new mission, and does not change an existing game.

## Show students

“The trophy is missing. You are detectives. Your team has different pictures. Tell each other what you see.”

Demonstrate one Team chat exchange: “I see a book sign. What place is that?” / “The book means library.” Then show where to answer in the Journal. Each report gives a chat question and sentence starters. Answers stay in English; Catalan help is available underneath.

The three named people are story characters, not classmates to search for. Clues at the map locations are read from the open ground outside the buildings. Keep the blocked passage closed. The illustrated scenes are story pictures, not changes to map geometry or animated world objects.

## Source and validation

Run `node content/season-3/build-evidence.mjs`, then `node content/season-3/build-pack.mjs`. This rebuilds the editable clue diagrams, campaign, standalone chapters, warm-ups, inventory and ZIP. Mission validation, raw import size, warm-up imports and all map routes are checked during the build.

Original story artwork and exact generation prompts are in `art/story/`. The built-in imagegen tool created the four illustrations. Private clue diagrams have editable SVG sources in `art/evidence/`. Small WebP copies travel inside the mission JSON. The delivery ZIP contains the playable pack and guides; full-resolution art and authoring scripts stay in this source directory.

`teacher-guide.md` and `storyline.txt` contain spoilers. Do not distribute the whole pack or source preview to students: the app sends them only the clues they are allowed to see.
