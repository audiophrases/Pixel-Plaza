# Teacher quick guide

In Teacher controls, open **Campaign**. Each campaign has **Teacher quick guide** before its Start button, so you can compare versions before choosing one. During a running story, the **Teacher guide** button beside the chapter indicator opens the guide at the current chapter. The chapter menu lets you look ahead or revisit an earlier episode without advancing the game.

Each chapter gives you:

- **Mission:** what students are investigating.
- **Student workflow:** the short sequence to follow in that version.
- **Main tasks and answers:** expand any task for its exact steps, prerequisites, minimum group size and clue trail.
- **Optional missions:** partner quests and extra reports, kept separate from the main mystery.
- **Help when students are stuck:** private role clues, the thief’s own instructions and cover story, map discoveries and prepared news you can release.

## Which Castanyada?

| Version | Length | What students do |
| --- | --- | --- |
| The Haunted Castanyada | 3 chapters | Share private clues through chat, combine them and answer the Journal questions. |
| Castanyada: Side Mysteries | 3 chapters | The same main path, plus two optional Chapter 1 partner quests. |
| The Haunted Castanyada: Five Chapters | 5 chapters | Continue through the festival plan and haunted celebration; optional interview and exchange quests in every chapter. |
| Castanyada: Witness Investigations | 5 chapters | Before every main conclusion, complete a task-linked witness exchange in the Journal. Identifying the thief needs two different witnesses. |

The app derives these instructions from the actual published mission, including teacher edits. An open preview refreshes when a new revision is published. A running game's guide uses its saved revision plus live-released quests, and updates when roles or the thief change. Publishing a changed draft does not replace that game's answers. Custom campaigns and Plaza Free Play also receive guides.

## Witnesses and partners

A chosen witness and an assigned partner work differently. A main witness question lets the investigator choose an online classmate in their Journal. A partner quest starts with accepting it on the quest board; the app assigns the partner. The guide states any role restrictions, different-role requirement, teacher release and requirement to finish the main mystery first.

The exchange is: ask about the task and attach a private clue → the witness sees it and replies with their own private clue → investigator compares the evidence and submits their answer. Two witnesses require two such exchanges with different classmates for that question, and at least three students online. The investigator's own Journal task is separate from replying as somebody else's witness.

Reports require at least five words after any required exchange. The app records participation and the written attempt; the teacher assesses the explanation and English. Partner exchanges ask students to compare contributions and agree on a response, then submit their own reports.

## Solving the story

The guide shows the answers from the game definition, rather than maintaining a separate answer key. For example, Chapter 1's answers are park/pond, 9:30 and two key holders; Chapter 3 uses the cellar and code 7431. The longer versions continue with the hotel plan, 5:30 rehearsal, hotel venue, and a proposal; then the park lantern, wind, new neighbors, and a welcome proposal. Exact accepted alternatives are shown in the app.

Names are dynamic: the live guide shows the class members with the required roles and the thief selected for that game. Before a thief is chosen, the guide explains that selection will happen when the chapter starts and enough students are present. A task's clue trail follows its prerequisites, including the main-path rewards needed for fast-finisher quests.

Reaching the chapter's readiness percentage leaves time for unfinished students and optional quests. You choose when to start the next chapter. Selecting another chapter in the guide only changes what you are reading.

## Access and verification

The guide endpoint requires a valid teacher session and returns no-store responses. Guide answer keys and clue trails are not added to student Journal messages. A stale guide request for another active game is refused; the page cancels outdated requests and has a retry button for failures.

- `npm run check:teacher-guide`: rendered guide, lazy previews, 3/5 chapter menus, witness counts, chapter changes, refresh, request races and retry.
- `node --test worker/tests/teacher-guide.test.mjs`: mechanics, source edits, answers, private notes and dynamic names.
- The runtime guide test in `worker/tests/plaza.test.mjs` checks teacher authorization, publication snapshots, live additions, chapter changes and recovery after a Worker restart.

Screenshots: `art/previews/teacher-guide-basic.png` and `art/previews/teacher-guide-witness.png`.
