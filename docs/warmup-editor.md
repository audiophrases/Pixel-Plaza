# Warm-up editor

Open **Warm-up editor** in Teacher controls, or use **Edit warm-up** next to the activity selector. The standalone address is `/warmup-studio`. Sign in with the normal teacher password.

Choose one of the three activity types:

| Type | Editable content |
| --- | --- |
| Who am I? | Identity names and accepted aliases. Include at least one identity per student, plus spare identities for late joiners. |
| Find someone who… | The private made-up fact, its matching “Find someone who…” phrase, and the maximum number of facts to find. |
| Find your pair | Both words or phrases in each pair. Each word belongs to exactly one pair. |

Every type also has a title, student instructions and language-level label. The label does not rewrite your text; write instructions appropriate for your class. A preview shows how the content reads. Identity collections need at least two entries and have no entry-count ceiling; the 64 KB size limit still applies. The editor supports up to 80 facts, 40 pairs and 1–10 facts to find. Actual fact tasks use only facts held by classmates, so small classes may get fewer tasks than the maximum.

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

**Export JSON** backs up the current draft. **Import JSON** previews a saved warm-up of the selected type before changing the draft. Files use format `pixel-plaza-warmup`, schema version 1, and may contain at most 64 KB (64,000 bytes). The limits, import errors and success messages appear beside the import control; selecting a file moves focus to its preview or error.

- **Replace draft** uses the file's entire list, title, level and instructions. Review the entry count, then **Apply import**.
- For **Who am I?**, **Append new identities** previews the additions, skipped duplicates and final count. It keeps the draft's title, level, instructions and existing identities and aliases. An identity with the same name (ignoring case, accents and punctuation) is skipped. A reused ID with a different name, conflicting aliases, or a combined definition over the 64 KB size limit blocks the append and explains why. Resolve the conflict in the file or choose replacement if that is your intent.
- **Cancel import** leaves the draft alone. Editing the draft also cancels a pending preview. Invalid files never change the draft, and you can select the same file again after correcting it.

After applying an import, **Save warm-up** to persist it. Importing alone does not save or change a round already running. For example, a 110-identity file containing the 33 built-in identities adds 77 and skips 33 when appended to the built-in list.

**Use built-in content** restores the selected type in the draft. Save when ready. An existing running round still keeps its content.

Leaving with unsaved edits prompts you to save or export. If another tab saves first, the app refuses to overwrite that version. Your draft remains visible: export it if needed, then **Reload saved version** to see the current definition.

Older rounds created before this editor continue using their original built-in content. Their assignments are not migrated into a changed teacher template.

## Verification

`npm run check:warmups` tests the rendered editor, including aliases, all three modes, validation, version conflicts, backup and restore. The warm-up configuration unit tests cover validation and custom assignment mechanics. Worker integration tests cover authorization, request bounds, saving, pinned rounds, English vocabulary, answer checking, secret protection, late arrivals and restart persistence.
