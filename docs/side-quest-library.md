# Side Quest Library

Ready-made optional quests for students who finish early, for warm-ups, and for short sessions between story chapters. Open **Side quest library** from Teacher controls (`/quest-library`), search, pick, and add quests to the game that is running.

## What is in it

| Kind | Theme | What it is | Where it fits |
| --- | --- | --- | --- |
| Story | Castanyada | Ten quests for each chapter of The Haunted Castanyada. They use that chapter's people, places, times and clues. | Only while that chapter is running, in any Castanyada template that has the chapter. |
| Generic | Social | Social missions for fun: icebreakers, interviews, opinions, debates, story chains, describe-and-guess, secret agent missions, team decisions, kindness, hobbies, media, plans, travel, creative writing. | Any game, any chapter. |
| Generic | Plaza | Quests that use the plaza: directions, caf&eacute;/shop/hotel role-plays, events in the square and park, avatar fashion. | Any game on the plaza map. |
| Generic | Puzzles | Riddles, word games, logic and number puzzles, mostly with a typed answer the game checks. | Any game. |
| Generic | Seasonal | Autumn and Halloween, winter holidays and New Year, Carnival, Saint George's Day, spring and summer. | Any game, in the right season. |

Every quest card shows its kind (**Story** in orange, **Generic** in blue), its theme, a level and a short description of who it involves:

- **Levels:** A1 Starter, A2 Elementary, B1 Intermediate, B2 Advanced. The instructions themselves are written at the level, with sentence frames for A1 and useful phrases from A2.
- **Who:** solo, pair, small group or whole class. Pair, group and whole-class quests wait until 2, 3 or 4 students are online.
- **Answer:** a *typed answer* is checked by the game (riddles, puzzles, story facts); a *written report* counts once the student writes a real attempt, and you read it under "What students wrote" in Teacher controls.
- **Teacher note:** what to look for, how to adapt the quest, and for typed answers the solution and every accepted variant.

## Finding quests

- Type words in the search box: a topic (food, hotel, Christmas), a language point (past simple, comparatives, giving opinions), a level name (starter) or an activity (riddle, survey, role-play). Every word must match; title matches come first.
- Narrow with the filters. Each button shows how many quests it would leave. *Kind* separates story and generic quests; *Chapter* appears for story quests.
- Shortcuts: warm-ups (5 minutes or less), auto-checked answers, pair work, whole-class mingles, story quests for the running chapter, Halloween and autumn, Christmas and winter.
- Tick **Only quests that fit … now** to hide quests the running game cannot take (story quests for another chapter, or quests already added).
- Click a tag inside a teacher note to search for it.

## Adding quests to a game

1. In Teacher controls, open the game and start a campaign. Between chapters, or on any day without a story, start **Plaza Free Play: Side Quests**.
2. In the library, select up to ten quests (or press **Pick 5 at random from these**) and choose **Review and add to the game**. The review shows how many students could accept each quest right now.
3. Choose **Release to students**. The quests appear on every student's quest board at once; progress in the story is not touched.

The server builds each quest from its own copy of the library, checks that it fits the chapter, and adds it once per game. A chapter can receive up to 40 live additions. In Plaza Free Play, **Start the next chapter** opens a new session with an empty board. Unstarted quests can be withdrawn from Mission Studio.

**Download for Mission Studio** saves the selection as a campaign file. In Mission Studio, import it with "Extend the selected chapter" to make the quests part of your own campaign draft.

## Plaza Free Play

A campaign without a mystery, for short sessions between chapters and for any day of the year. Students get one of four light roles (Explorer, Reporter, Host, Artist), check in with one or two sentences, and then play the quests you add. It has eight sessions; each new session starts with an empty quest board.

## Good to know

- Students type in English: the chat blocks words that are not English, so quests about local festivals ask for English names ("chestnut festival", "Saint George's Day").
- Story quests never spoil a main answer: those that use information from a main question unlock after it, and those about a chapter's solution unlock once the student has finished the main mystery. None asks who the thief is, so the thief can play them too.
- Written reports are not graded automatically. Choose a few to discuss with the class.
- The library lives in `shared/sideQuests/library.json`, one entry per quest; `shared/sideQuests.ts` turns entries into quest-board objectives and provides the search. Tests in `worker/tests/side-quests.test.mjs` check every quest against the game's rules.
