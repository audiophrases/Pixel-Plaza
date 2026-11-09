# Talk Together — 200 more side quests

**100 pair quests and 100 small-group quests**, independent of every campaign, map and artwork. Each task gives students a short reason to talk and a small shared answer to submit. No special locations, clues, items, drawing materials or extra participants are needed.

## Import

Open **Side Quest Library** from Teacher controls. Use **Import** and choose one of these JSON files:

- `side-quests-talk-200.json`: all 200.
- `pairs-100.json`: only the 100 pair quests.
- `groups-100.json`: only the 100 group quests.

The files use the library’s existing format. The same IDs appear in the full and split imports, so importing both does not create duplicate copies of these quests. They use a new `sq-talk200-` prefix and have been checked against the existing 550-quest repository fixture. This check does not inspect your live library. Reimporting an edited quest with the same ID updates that quest through the normal importer.

All entries appear under the app’s **Social** filter, which means general conversation activities. They have no story chapter, assigned story roles, campaign prerequisites, map location or artwork dependency. Search for `talk-200` to find this pack. Filter by Pair / Small group, level, category or duration.

After importing, choose a small selection and use the library’s normal **Add to game** review. Importing into the library alone does not release quests into a running game. The library has a 2,000-record limit including Trash; these are 200 additional records when their IDs are new.

## How students play

“Read the task. Take turns talking. Agree on your short answer.”

Pairs use two students; small groups use three. The app forms quest groups, and one answer completes the quest for all group members. Students talk in the game chat or aloud, then submit the requested result. Tasks stay within their assigned pair or group rather than asking them to find more people.

If a group starts early with fewer people, students can take more than one speaking part. Where a task says three ideas or three steps, they can still produce the three ideas together. For best participation, start with the intended group size.

These are report quests: the response is an idea, decision, short dialogue, plan or story. Most answers take one to three sentences or a short list; a few explicitly request four lines. Each quest has its own success criteria matching its visible task. Short, simple English is accepted; students do not need to submit a transcript. The written answer cannot prove that everyone spoke, so use the group conversation to check participation. Review uncertain or unavailable report checks in Teacher controls as usual.

## Keep it simple

- A1: short descriptions, familiar choices and simple exchanges.
- A2: ask a follow-up, compare information, agree on a plan or explain a reason.
- B1: negotiate, check a claim or improve an idea. Instructions remain short.

The pack includes **60 A1, 104 A2 and 36 B1** tasks. Every instruction is under 30 words, with a 30-word maximum enforced during the build. Durations are 3–6 minutes. Fictional situations let students invent answers without needing to disclose personal experiences or possessions. No quests depend on a celebration, season, named game character, real-world purchase or current facts.

`teacher-preview.html` is an offline, searchable catalogue with format, level and category filters. Expand a card to see its answer guide. It is a local review document, not a new app feature.

## Authoring

`pairs.mjs` and `groups.mjs` contain the 200 individually authored tasks. There are twenty categories of ten tasks, covering listening, guessing, dialogue, choices, stories, planning, invention, explanations, reasoning and teamwork. The builder adds consistent metadata; it does not generate tasks by substituting words into a template.

Run `node content/side-quests-talk-200/build-pack.mjs` to rebuild the three import files, manifest and preview. It checks the exact count, instruction length, unique IDs/titles/text, compatibility with the existing quest importer, and correct pair/group assignment. This content pack does not modify the existing library fixture, seed content, campaign packs or live games.
