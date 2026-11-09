# Protocol 8:15 — Season 2

A fictional school suspense mystery for teenage English learners, based on the supplied storyline. A2–B1; three lessons of approximately 20–25 minutes. All events and accusations are invented for the classroom story.

## Files

- `campaign.json`: the complete three-chapter adventure, including English and optional Catalan help.
- `chapters/01.json`, `02.json`, `03.json`: independently importable chapters with the same investigator roles. Use these for a single lesson or adapting a chapter. Each has its own appropriate ending.
- `theme.json` and `art/campus.png`: the map geometry and generated school artwork.
- `teacher-guide.md`: answers, evidence trail, pacing and the complete timeline. Teacher-only; contains spoilers.
- `storyline.txt`: the supplied story brief, preserved as a reference.
- `art/layout.png` and `art/prompt.md`: geometry guide and exact art brief for future variants.
- `manifest.json`: an inventory of this pack, not an application registration file.

The app does not import this directory, seed this mission, register this map or hardcode its characters. The files become ordinary editable server content only when you import and publish them. Mission Studio accepts the complete ZIP directly. Extract the pack to import its theme and background in Map Studio or use individual chapter files.

## Install through the teacher studios

Use an app version with **Import mission**, evidence pictures and expandable Catalan help.

1. Open **Map Studio** (`/studio`) and sign in. Use **Open a theme file** to open `theme.json`, then **Import AI background** to open `art/campus.png`. Check the paths and walking preview. Save the map draft and **Publish to games**. The studio uploads the picture with the map into server storage.
2. Open **Mission Studio** (`/mission-studio`) and click **Import mission**. Choose `protocol-815-season-2.zip` or `campaign.json`. The preview shows three chapters, nine tasks, four roles, fifteen pictures and whether the map is ready. Click **Import & publish**. No empty mission or extraction is needed. Use **Save as draft** if you want to edit before publishing. Importing again creates a separate copy.
3. Create a new game on **Protocol 8:15 · Storm campus**. Start **Protocol 8:15 — The Missing Student** from Teacher controls.
4. Play in case teams (on by default). Auto-advance releases each chapter’s tips when half the class is stuck and starts the next chapter once the class is ready; you can pause it or advance by hand. Check the shared writing and accept uncertain automatic checks in Teacher controls.

For a standalone lesson, import one file from `chapters/` into its own new mission. For adaptation, the normal append/extend tools keep help with copied chapters and tasks. Appending leaves the destination campaign’s finale unchanged; review that field after combining chapter modules.

Do not run the old map-registry installer for this pack: that installs map files into application source. Use the studios to keep the season entirely in content storage. No deploy is needed for future edits to this season after support for the help fields is deployed.

## Evidence pictures

The season is told in pictures. Each chapter gives every role one private picture (twelve in all), and the chapters open and close with story pictures: the storm, the security camera and Karina’s message. Fifteen distinct pictures are embedded in the JSON as small WebP images; no separate upload or asset registration is needed.

A private clue picture is seen only by students with that role (or, in a team missing that role, by the team as a town notice). In Mission Studio, select a chapter and open **Evidence pictures** to replace or remove any picture, including each role’s **Private clue** picture, or edit its screen-reader description. Choose PNG, JPEG or WebP; the editor reduces large uploads. The mission stays under its 512 KB limit.

Students use **Enlarge evidence** in the Journal or instruction pop-ups. The enlarged view includes the matching English text and expandable Catalan help.

Editable document sources and the preserved generated CCTV original are in `art/evidence/`. Run `node content/season-2/build-evidence.mjs` before `build-pack.mjs` when changing the art sources. The exact CCTV prompt is in `art/evidence/prompt.md`; the storm picture’s is in `art/evidence/opening-story-prompt.md`.

## Where Catalan appears

English stays visible. **Ajuda en català** is closed by default immediately below each available story, private role card, clue, task, teacher news and ending in the **Journal** and **instruction pop-ups**. Students can open it by mouse or keyboard. Tasks include the reminder **Parla amb els companys i respon en anglès**. Typed answers, reports and evidence exchanges remain in English.

The server sends help only alongside content that student is allowed to see. Opening help cannot reveal another role’s private clue, an undiscovered map clue, a locked task, unreleased news or a future ending. Absent-role clues follow the existing availability rules in both languages.

In Mission Studio, **Catalan help** under mission setup edits role cards, starting clues and the finale. Under the chapter editor it edits the selected chapter’s story, tasks, map clues, news and role clues. The English source is shown with each translation. Update both when changing meaning. Translation text is part of JSON export, published revisions and online/laptop sync.

The mission’s editable `vocabulary` lists its public character and place names. Both English chat checks accept those words during this campaign. The list is content, not a built-in name exception, and contains no secret answers.

Its editable `cast` lists the eight story characters, each with one public line (Karina, Youssef, Laia, Chidi, Ms Diop, Ms Ionescu, Ms Sokolova and Mr El Idrissi). Students see them as a 📖 *Who’s who* in the Journal, and the story marks their names 📖 wherever it mentions them, so a character is never mistaken for a classmate. If the mission is already imported, import this pack again or add the characters under *Story characters* in Mission Studio.

## Running the lessons

Chatting is how the case is solved. Every student holds one private picture, and every question needs two pictures held by two different roles; the question names them (“Ask the Message checker and the Document checker”). Nobody can answer from their own picture alone, so the team tells each other what their pictures show, in the 🤝 Team chat or out loud, in English.

The same three steps every chapter, in the opening of each chapter and on the role cards:

1. Look at your picture.
2. Tell your team what it shows. Ask: “What is your picture?”
3. Answer together in the Journal.

Each chapter: two short questions, opening one at a time, then one short piece of writing done together. There is no witness exchange: the team chat replaces it. Each chapter also has two prepared tips, which name the two roles to compare. The map’s places have small extra clues when students walk by; no answer needs them.

Use at least two students; four or more lets every role be played. Started in case teams (on by default), each team of three or four holds the roles between its members, talks in its own Team chat and answers once for the whole team. A missing role’s picture reaches the team as a town notice. The named story characters are people in the pictures, not roles assigned to real classmates.

To use this version, import the rebuilt ZIP or `campaign.json` in Mission Studio and publish it; importing creates a separate copy, and games already running keep the version they started with. The teacher guide has the answers, the pictures each question needs and the timeline.

## Rebuild and validate

From a checkout with this feature: `node content/season-2/build-pack.mjs` rebuilds the campaign, chapter files, inventory and ZIP. It validates every mission and all map routes. The authoring script is pack source only and is never imported by the running application.

Artwork was generated with the built-in image tool using `art/layout.png`. The original generation was copied into this pack as `art/campus.png`. The exact prompt is retained in `art/prompt.md`.
