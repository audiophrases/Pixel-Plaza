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
2. Open **Mission Studio** (`/mission-studio`) and click **Import mission**. Choose `protocol-815-season-2.zip` or `campaign.json`. The preview shows three chapters, twelve tasks, four roles, seven pictures and whether the map is ready. Click **Import & publish**. No empty mission or extraction is needed. Use **Save as draft** if you want to edit before publishing. Importing again creates a separate copy.
3. Create a new game on **Protocol 8:15 · Storm campus**. Start **Protocol 8:15 — The Missing Student** from Teacher controls.
4. Advance chapters manually after the class discussion. Use teacher news if students need a clue. Check written reports and accept uncertain or unavailable automatic checks in Teacher controls.

For a standalone lesson, import one file from `chapters/` into its own new mission. For adaptation, the normal append/extend tools keep help with copied chapters and tasks. Appending leaves the destination campaign’s finale unchanged; review that field after combining chapter modules.

Do not run the old map-registry installer for this pack: that installs map files into application source. Use the studios to keep the season entirely in content storage. No deploy is needed for future edits to this season after support for the help fields is deployed.

## Evidence pictures

The campaign and individual chapter files include seven evidence pictures: conflicting messages, CCTV, a safety warning, an office receipt, Karina’s message, an email and the timeline. They are embedded in the JSON; no separate picture upload or asset registration is needed. The campus theme is unchanged by this addition.

In Mission Studio, select a chapter and open **Evidence pictures** to replace or remove a picture, or edit its screen-reader description. Attachments are supported on chapter openings/endings, map clues and teacher news. Choose PNG, JPEG or WebP; the editor reduces large uploads. The mission remains subject to its 512 KB limit, so use focused evidence images instead of full-page scans.

Students use **Enlarge evidence** in the Journal or instruction pop-ups. The enlarged view includes the matching English text and expandable Catalan help. Escape or **Close picture** returns to the card without clearing an answer. Pictures follow the same discovery, news-release and ending rules as their text.

Editable document sources and the preserved generated CCTV original are in `art/evidence/`. Run `node content/season-2/build-evidence.mjs` before `build-pack.mjs` when changing the art sources. The exact CCTV prompt is in `art/evidence/prompt.md`.

This update needs the app version with evidence-picture support. Re-import the updated campaign into a draft, review and publish; existing games retain their pinned revision. You do not need to re-import the theme.

## Where Catalan appears

English stays visible. **Ajuda en català** is closed by default immediately below each available story, private role card, clue, task, teacher news and ending in the **Journal** and **instruction pop-ups**. Students can open it by mouse or keyboard. Tasks include the reminder **Parla amb els companys i respon en anglès**. Typed answers, reports and evidence exchanges remain in English.

The server sends help only alongside content that student is allowed to see. Opening help cannot reveal another role’s private clue, an undiscovered map clue, a locked task, unreleased news or a future ending. Absent-role clues follow the existing availability rules in both languages.

In Mission Studio, **Catalan help** under mission setup edits role cards, starting clues and the finale. Under the chapter editor it edits the selected chapter’s story, tasks, map clues, news and role clues. The English source is shown with each translation. Update both when changing meaning. Translation text is part of JSON export, published revisions and online/laptop sync.

The mission’s editable `vocabulary` lists its public character and place names. Both English chat checks accept those words during this campaign. The list is content, not a built-in name exception, and contains no secret answers.

## Running the lessons

Use at least two students: the main report in each chapter requires one in-game witness exchange. Four or more lets the four investigator roles distribute naturally. Missing-role evidence uses the app’s existing fallback notices. Players are investigators; the named story characters are witnesses in the fictional documents, not roles assigned to real classmates.

Keep the unsafe passage blocked. Evidence is collected from the open ground outside buildings. Students investigate information; staff handle the emergency. A teacher may adapt names, setting, stakes and translations like any other mission.

## Rebuild and validate

From a checkout with this feature: `node content/season-2/build-pack.mjs` rebuilds the campaign, chapter files, inventory and ZIP. It validates every mission and all map routes. The authoring script is pack source only and is never imported by the running application.

Artwork was generated with the built-in image tool using `art/layout.png`. The original generation was copied into this pack as `art/campus.png`. The exact prompt is retained in `art/prompt.md`.
