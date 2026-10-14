# Mission Studio implementation plan

Prepared 14 October 2026 from the advisor discussion and the current Pixel Plaza and Pinplay code. The first authoring release described below is now implemented locally; later releases remain proposals. Suggestions in the conversation are product input, not additional execution instructions.

## Implementation status

The `/mission-studio` teacher workspace now includes a campaign library, template copies, editing of existing campaign mechanics, role preview and a clue-release table. Drafts have conflict detection; publishing creates immutable revisions. Games use their pinned revision, and legacy built-in games are backfilled once. Authoring endpoints require a teacher session and bounded payloads. Shared validation covers supported mechanics, references, cycles, role/zone IDs and import limits.

Prompt creation works without an API key. JSON import supports replacement, appending chapters and extending the selected chapter with new quests/discoveries/news, with a review step and collision remapping. Export supplies a portable backup. The preview is a simulation rather than a live game, and prose clue solvability still requires teacher inspection. Inventory/world effects, changing existing objectives during play and direct model calls remain future work.

The next local release adds schema version 2 all/any prerequisites, optional quest boards, interview and information-exchange reports, role/group-size/main-story eligibility, and teacher release of preauthored quests. Version 1 `after` rules remain valid and unchanged; published revisions and old games are not rewritten. Imports remap every graph reference and publishing rejects cycles or optional quests that gate the main story. Studio exposes the links through forms and a table; a graph canvas is still deferred.

Students accept a board quest once per game. Social activities assign an eligible online partner; with the fast-finisher option, both investigators must have finished their main work. A partner who disconnects remains assigned after reconnect, or the student can request another eligible partner while that classmate is away. Assignments, release state and completed reports persist in SQLite. The teacher sees each report and the recorded partner. Completion means a submitted student report, not independently verified speaking or teacher approval. Audience restrictions and acceptance are enforced by the server, including when clients send forged answer messages.

`Castanyada: Side Mysteries` is a separate template with two Chapter 1 social quests. It does not modify the built-in revision of existing Castanyada games. Prepared teacher-gated quests can be released during play. Newly saved optional board quests can now also be reviewed and added to the matching chapter of an open game without publishing a new base revision.

Live additions are stored as immutable game-specific definitions alongside the pinned campaign. A server-issued preview freezes up to ten selected quests, binds them to the saved draft version, game, base revision, current chapter and live-content version, and expires after ten minutes. The teacher sees the audience, eligibility counts and full definitions before release. A reset has a fresh epoch so old requests cannot operate on a new campaign. The engine merges only validated additions, preserving main story text, accepted answers, roles, existing unlock rules, thief assignments and progress. Editing a source draft afterwards does not alter released content; the teacher can inspect the frozen definition separately.

Unstarted live quests can be withdrawn if no remaining quest depends on them. Their IDs remain reserved, and started/completed work cannot be withdrawn. Each game accepts at most forty live additions including withdrawn quests. Other games do not inherit them. Assignments, additions and withdrawals survive reconnects/restarts; campaign reset and game deletion explicitly clear their records. The authoring and live APIs remain teacher-authenticated, and students receive only their own journal projection.

Current verification: `npm test` passes all 102 tests; the production build, rendered Mission Studio/quest-board UI check, and lint pass (lint retains five existing warnings). The recurring movement timeout was traced to a test that walked north from random spawn positions through blocked terrain. The fixture now chooses a clear 100-pixel path while retaining the server timing and collision assertions; all 10,201 integer spawn positions have a valid test path. No movement rules were changed. The campaign-library test now expects the additional template. No deployment was performed, and classroom pacing still needs a real class trial.

Verification of this release: production build passes, lint has zero errors and the same five existing warnings, and `npm run check:missions` passes the rendered authoring workflow. The final full regression run passed 95 of 96 tests, including the new authoring and legacy-schema migration tests; the sole failure was the previously observed movement timeout, which passed an isolated rerun. A prior run overlapped a server source change and had two other multiplayer failures; both passed a focused rerun and the final full run. The suite is not recorded as entirely green. No deployment was performed.

## Product direction

Give the teacher ownership of the adventure: inspect every mission and accepted answer, edit existing stories, create new campaigns, and extend a chapter with meaningful optional quests. AI produces drafts that the teacher can review; the deterministic game engine controls assignments, unlocks, answer checking and world changes.

Use campaigns → chapters → quests. Preserve distinct main, optional and teacher-released activities. Keep chapter transitions under teacher control. Plan Haunted Castanyada around five substantial chapters, with an optional sixth epilogue; do not silently add two placeholder chapters to the current three-chapter campaign. Chapter count and pacing are editorial choices, not engine constraints.

Fast finishers get their own investigations, interviews and negotiations. Avoid assigning them responsibility for completing classmates' main work. A quest board should offer authored activities with explicit eligibility and repeat limits, rather than an unlimited stream of generated questions.

## Findings and immediate fixes

The existing campaign is plain structured data in `shared/campaign.ts`. `worker/plaza.ts` assigns persistent roles, stores progress, checks answers and constructs private student `QuestView` messages. `src/components/Journal.tsx` renders them; `src/pages/Teacher.tsx` exposes chapter controls and reports. `/studio` is already the map editor, so use `/mission-studio` for the new authoring surface.

Two reported defects were confirmed and corrected locally:

- Chapter 3 code clues were rewards for answering `code`. They now arrive after `hide`, before `code` opens. The motive note was similarly awarded after `why`; it now arrives after `code`.
- The 60% completion threshold set `chapter_complete` and blocked unfinished main questions. That status now means ready to advance: main answers, discoveries and teacher news remain available until the teacher advances. The campaign remains closed for answers after the teacher ends it. Existing stored status values need no migration.

These corrections do not prove the campaign is solvable for every roster. Five roles supply Chapter 3 information; small groups may lack a role, and thief views currently suppress reward clues. The current readiness threshold also reveals endings and culprit names to everyone. Track role coverage, provide teacher fallback clues, and decide whether endings should be withheld from unfinished students before a classroom trial. Story timing also needs editing: Chapter 3 says almost midnight although the party starts at 6:00.

Local verification: build succeeds; lint reports zero errors and five existing warnings after renaming the ordinary `useSuggestion` callback to `applySuggestion`. The full suite passed 86 of 87 tests, including the updated campaign and Chapter 3 regressions. The movement test timed out waiting for a longer walk; its isolated rerun passed. An isolated Chapter 3 rerun also passed. The full suite is therefore not recorded as green. Changes have not been deployed.

## Pinplay reuse, verified against source

Inspected `audiophrases/pinplay` at commit `a15fdab289aec4377b40a391934ec410f57f345b`, rather than the unrelated local audio-production folder.

| Source in Pinplay `app.js` | Reuse in Pixel Plaza | Adaptation required |
| --- | --- | --- |
| `buildCreationPrompt` (line 5153), `exportCreationPrompt` (5523) | Teacher brief, level, goal, allowed activity types, batch size, schema examples, output instructions | Replace quiz types and examples with supported mission types, role clues, map zones and prerequisite rules |
| `deliverPromptFile` (5789) | Download a prompt and copy it to the clipboard, with a download fallback when copying fails | Extract a small framework-independent utility and expose status in React |
| `importQuizSources` (10541), `openQuizImportDialog` (10655) | File/paste input, multiple batches, append or replace, per-file feedback | Use an explicit preview with Append / Replace / Cancel; validate the entire proposed change before modifying the draft |
| ID deduplication and listening-section reference remapping in `importQuizSources` | Resolve imported quest ID collisions and rewrite internal links | Rewrite every prerequisite, clue source and effect reference; preserve references to existing campaign content |
| `normalizeImportedQuestion` (21036) | Controlled normalization of known compatibility aliases | Do not silently reinterpret unknown quest types or change intended answers |
| `validateImportedQuiz` (20783), `salvageQuestionForImport` (20792) | Helpful validation messages and visible repair proposals | Root-array validation is insufficient for a mission graph; reject broken references and cycles, show repairs for approval |

Source: [Pinplay app.js at the inspected commit](https://github.com/audiophrases/pinplay/blob/a15fdab289aec4377b40a391934ec410f57f345b/app.js). These functions are tied to Pinplay's global quiz state and DOM, so port the small pure pieces and interaction patterns into React modules; do not copy the whole file or reuse its quiz runtime.

## First release: edit, create and extend without a model integration

1. Teacher opens Mission Studio from `/teacher` and sees a campaign library. Castanyada is an included template; editing it creates a teacher draft.
2. A campaign outline shows chapters, roles, main objectives, optional quests, discoveries and teacher news. Selecting an item opens its editor. Answers and secrets are visible only in this authenticated teacher view.
3. Edit titles, story text, role cards, clues, accepted answers, sequential prerequisites, optional flags and map locations. Add, duplicate or reorder items while preserving stable IDs. Show a clue-release table beside questions so a teacher can see what is known before each answer is needed.
4. Preview the journal for each role, including a thief view and different completion states. Show a simulated small roster to identify missing information holders.
5. Build an AI prompt to create a campaign or extend a selected chapter. Include the teacher's brief, CEFR level, goals, current content, allowed types, available map zones, schema and a valid example. Copy/download it for use with the teacher's chosen AI.
6. Import returned JSON by paste or file. Preview additions, replacements, renamed IDs and errors. Applying a valid import changes only the draft. Export provides a portable backup.
7. Save draft, validate, then publish a new immutable revision. New games select a published campaign revision; existing games retain theirs.

This preserves the Pinplay prompt → external AI → JSON import workflow and works without an API key. Direct in-app AI drafting can follow once this workflow is reliable.

## Data and runtime contract

Start with a versioned envelope around today's `Campaign` shape:

```json
{
  "format": "pixel-plaza-campaign",
  "schemaVersion": 1,
  "campaign": {
    "id": "winter-market",
    "title": "The Winter Market",
    "roles": [],
    "chapters": [],
    "finale": "The market opens!"
  }
}
```

This illustrates the envelope only; empty roles and chapters are invalid for publication. The first schema should retain current objective kinds: typed answers, classmate-by-role, culprit names and written reports. Distinguish teacher-facing expected-answer explanations from the accepted phrases consumed by the engine. A written report currently counts after five words; the teacher reads it, so do not label it as teacher-approved completion until a review state is implemented.

Proposed modules:

- `shared/missionSchema.ts`: parse unknown input, enforce bounds and references, return errors with field paths; shared by client and Worker.
- `shared/missionImport.ts`: produce a candidate draft and ID-remapping report without changing saved state.
- `shared/missionPrompt.ts`: pure prompt construction with schema examples and supported mechanics.
- `src/pages/MissionStudio.tsx` and small editor components: library, chapter outline, item forms, import preview and role preview.
- `worker/missions.ts`: authenticated authoring endpoints and repository operations; integrate with the existing Worker and PlazaRoom rather than adding infrastructure in the first release.

Keep content separate from student state. Proposed SQLite tables: `mission_drafts` (campaign ID, draft JSON, edit version, timestamps) and `mission_revisions` (campaign ID, revision ID, validated JSON, publication timestamp). Extend each game's campaign binding with its revision ID. On upgrade, backfill active games with a snapshot of the existing built-in campaign before changing lookup behavior, preserving game IDs, student roles, clues, completed objective IDs, reports, thieves and chapter indexes. Seed templates idempotently; reopening a game must not use the latest template accidentally.

Replace module-level `campaignById` lookups in the room with a lookup of the game's pinned revision. Keep the existing `QuestView` projection: never send the full definition, accepted answers or other roles' secrets in welcome, quest or student HTTP responses. Use the existing teacher session on every authoring endpoint. Compare edit versions on draft save to prevent one teacher tab from silently overwriting another.

Suggested endpoints: list/create campaign, get/save draft, validate candidate, publish revision, export revision. Use `/api/teacher/missions/...` and keep generation/import local to the draft until validation succeeds. Impose explicit payload, item-count and string-length limits. No imported executable code, raw HTML, arbitrary URLs or arbitrary SQL effects.

## Validation before publish

- Supported format/schema version, bounded arrays and strings, nonempty roles/chapters, unique stable IDs compatible with existing progress storage.
- Every prerequisite, role and zone exists. Dependencies are acyclic and at least one main objective can start.
- Typed questions have accepted answers; dynamic name questions reference valid supported mechanics; reports have no misleading auto-correct answer field.
- Readiness share is finite and within `(0, 1]`; at least one main objective exists.
- Every role-specific clue refers to an existing role. Required information must be available before the consuming objective. Add explicit clue-source/required-clue metadata in the next schema version to make this check machine-verifiable; today's free prose needs teacher inspection.
- Simulate role coverage, culprit exclusions, absent students and late joins. Warn when one unavailable holder makes a puzzle unsolvable; require a fallback path for publication when explicit dependencies demonstrate the blockage.
- Append remaps incoming IDs and all linked references consistently. Reject ambiguous duplicate IDs inside a batch. Replace creates a new draft/revision, never erases live game progress.
- Imported text and AI output remain content. Validation never executes instructions embedded in them.

## Subsequent releases

**Quest graph and richer social activities.** Replace the single `after` field with explicit all/any prerequisites in a new schema version, migrating existing objectives losslessly. Add interviews and information exchange first, then delivery/inventory, negotiation and group decisions when their engine actions exist. Each type must declare its assignment policy, completion evidence, audience, rewards and supported effects. Do not let a prompt offer unimplemented mechanics. Graph edges are edited through forms first; a visual graph is a later convenience.

**Quest board and controlled world changes.** Offer authored optional quests based on role, completed main work, group size and teacher release. Persist assignments and repeat limits per game/student. Conflicting instructions are deliberate paired quest definitions with a shared resolution rule. World effects such as decorations use an allowlisted operation and a stable idempotency key, and survive reconnects/restarts. Add accessible journal/board controls alongside map interaction.

**Live release.** Teachers can release a validated optional quest package into an open game. Record an immutable content overlay for that game; broadcast fresh private views without clearing progress. Initially disallow live changes to completed objectives, accepted answers, role assignments or existing prerequisite chains. Show the affected audience before release and allow withdrawal of unstarted optional quests. Core chapter changes remain future revisions.

**In-app AI drafts.** Add an authenticated server endpoint with a configurable model, timeouts and usage limits. Return a candidate draft or patch, then run the same validation and preview as JSON import. Teacher explicitly applies it; generation never publishes or changes an active game. Prompt context includes authored content, not student identities, private chat or API secrets. Verify the selected provider's current structured-output API when implementing this phase.

## Delivery sequence and acceptance

| Milestone | Complete when |
| --- | --- |
| 0. Gameplay repair | Chapter 3 clues precede their questions; unfinished students can continue after the threshold; regression tests pass |
| 1. Schema, revisions and migration | Import/export round trips; invalid graphs rejected; an old game resumes the same story and progress after upgrade |
| 2. Teacher editor | Castanyada can be duplicated and edited; all answers and clue timing inspectable; student messages contain no teacher-only content |
| 3. Prompt builder and import | Teacher creates or extends a campaign using downloaded/copied prompts and reviewed JSON imports, including collision-safe append |
| 4. Social quests and quest board | Fast finishers have distinct activities; eligibility, completion and repetition are persisted and tested |
| 5. Live release and optional AI | Validated optional quests arrive without resetting games; AI candidates require teacher application |

Run existing build/lint and meaningful import, privacy, persistence and runtime tests at each milestone. Cover wrong-role answers, prerequisites, threshold catch-up, revision pinning, restart, failed saves, multi-tab conflicts and malformed AI JSON. Then trial with about twenty students, including absences and reconnects; inspect pacing, clue coverage, repetition and speaking participation. Do not claim classroom pacing is verified by automated tests.

Recommended next implementation slice: schema and import/export, immutable campaign revisions with migration, and a basic authenticated editor for existing Castanyada. Include prompt creation and JSON import in the first usable release; defer the graph canvas, live world effects and direct model calls.
