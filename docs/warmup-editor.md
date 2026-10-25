# Warm-up editor

Open **Warm-up editor** in Teacher controls, or use **Edit warm-up** next to the activity selector. The standalone address is `/warmup-studio`. Sign in with the normal teacher password.

Choose one of the three activity types:

| Type | Editable content |
| --- | --- |
| Who am I? | Identity names and accepted aliases. Include at least one identity per student, plus spare identities for late joiners. |
| Find someone who… | The private made-up fact, its matching “Find someone who…” phrase, and the maximum number of facts to find. |
| Find your pair | Both words or phrases in each pair. Each word belongs to exactly one pair. |

Every type also has a title, student instructions and language-level label. The label does not rewrite your text; write instructions appropriate for your class. A preview shows how the content reads. The editor supports up to 80 identities/facts, 40 pairs and 1–10 facts to find. Actual fact tasks use only facts held by classmates, so small classes may get fewer tasks than the maximum.

## Save and start

1. Edit the list and instructions. Validation explains missing entries, ambiguous aliases or repeated words.
2. **Save warm-up**. There is one saved configuration per type for this classroom. These definitions are independent of campaign drafts and side quests.
3. Return to Teacher controls, choose that type, then start it. **Start again** uses the latest saved content and creates fresh assignments.

An active round retains the exact content it started with. Editing its saved configuration changes future starts, not current secrets, accepted answers, tasks or progress. Closing/reopening a game or restarting the server preserves its round. Saved definitions also survive restarts.

## Built-in mechanics remain active

- Students still get automatic assignments, private cards, answer checks, shared progress and completion rewards.
- Custom identities and aliases are accepted as guesses by the English word checker. The allowed vocabulary contains possible names, not other students' assignments.
- A helper's custom identity and aliases remain blocked in student chat. Guesses about another student, yes/no confirmations, private final answers and teacher help remain available.
- New identity rounds need at least one distinct identity per present student. A late joiner gets an unused identity when available. If all are taken, they may share an identity but investigate someone with a different identity, so the guessing rule still works.
- Late pair players receive a word with a partner who is currently present.

## Backup, restore and conflicts

**Export JSON** backs up the current draft. **Import JSON** opens a saved warm-up of the selected type for review; it does not save automatically. Files use format `pixel-plaza-warmup`, schema version 1, and must be smaller than 64 KB.

**Use built-in content** restores the selected type in the draft. Save when ready. An existing running round still keeps its content.

Leaving with unsaved edits prompts you to save or export. If another tab saves first, the app refuses to overwrite that version. Your draft remains visible: export it if needed, then **Reload saved version** to see the current definition.

Older rounds created before this editor continue using their original built-in content. Their assignments are not migrated into a changed teacher template.

## Verification

`npm run check:warmups` tests the rendered editor, including aliases, all three modes, validation, version conflicts, backup and restore. The warm-up configuration unit tests cover validation and custom assignment mechanics. Worker integration tests cover authorization, request bounds, saving, pinned rounds, English vocabulary, answer checking, secret protection, late arrivals and restart persistence.
