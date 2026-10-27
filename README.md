# Pixel Plaza

A social plaza for an ESL class. Students sign in through PinPlay's Google student login, choose avatars, move around a shared map, use emotes, and submit chat messages: to the people nearby, to everyone in the plaza, or as a whisper to one classmate. Every chat message, whispers included, must be approved by the teacher before anyone sees it, unless the teacher chooses the review mode below.

## Where it runs

One Cloudflare Worker, `pixel-plaza`, on the same account as PinPlay and Dictation Time:

| Piece | What it does |
| --- | --- |
| Static assets | The built app (`dist/`). |
| `worker/index.ts` | `/api/*`: student sign-in (passed to PinPlay), joining, teacher controls. |
| `worker/plaza.ts` | The `PlazaRoom` Durable Object: the live room over WebSockets, and the SQLite storage that keeps progress. |

There is nothing to start before a lesson and no cold start. The Worker reaches PinPlay through the `PINPLAY_AUTH` service binding, as Dictation Time does, so Google sign-in, the roster and student sessions stay in `pinplay-api`.

## What students keep

Saved under each student's PinPlay `studentKey`, so it follows the student to any laptop:

- their avatar (a returning student goes straight in with **Enter the Plaza**, or picks **Change my looks**)
- where they last stood on the map

The teacher's side is saved too: whether the class is open, mutes, and the last 500 chat messages with their review status. A restart or a new deploy keeps all of it. When adding new progress (items, rooms), add a column or table in `PlazaRoom` and read it with the rest of the student's row.

## One-time setup

1. **Deploy** from the project root (`npm ci` first on a new machine):

   ```powershell
   npm run deploy
   ```

   It prints the address, `https://pixel-plaza.eugenime.workers.dev`.

   Later deploys: double-click `deploy.bat`.

2. **Set the teacher password**, prompted securely:

   ```powershell
   npx wrangler secret put CREATE_PASSWORD_HASH
   ```

   `CREATE_PASSWORD_HASH` is the teacher password as a lowercase-hex SHA-256. **Use the same value as PinPlay's** and the teacher signs in with the PinPlay password. To make one:

   ```powershell
   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1].trim().normalize('NFC')).digest('hex'))" "your password"
   ```

3. **Allow Google sign-in from the new address.** In the Google OAuth web client that PinPlay uses, add `https://pixel-plaza.eugenime.workers.dev` under **Authorized JavaScript origins**. This is a Google Console setting, not a secret.

4. **Try it on one school laptop.** Some school web filters block `*.workers.dev`. If this one does, add a custom domain such as `plaza.pinplay.win` to the Worker in the Cloudflare dashboard, and add that origin in Google as well.

Configure PinPlay's roster policy (**PinPlay → Students**) for the intended class.

## In class

1. Open `/teacher`, sign in with the teacher password, and press **Open class**. The page shows a new 6-digit class PIN for this lesson; write it on the board.
2. Students open the site, type the class PIN, and sign in with their school Google account (once per device; the session lasts as long as PinPlay's).
3. During class the top of the page is the class as it happens. **To do** is one queue, oldest first, of everything waiting on you: chat to approve (✓ or ✕, or **A** and **R** for the oldest, **✓ Approve all** for the lot) and students asking for help or writing to you privately, each with a box to answer in place (answering marks it as helping; ✓ takes it off the list). A switch beside it changes between approving first and posting after the OpenAI check. Below it, the chat that already posted, one line each, with ☆ for a star and 🗑 to take it down. **Class** shows every student as their avatar's face, whoever needs you first (🙋 asked for help, a blue number for messages waiting); click a face for their latest messages, a private message and the spells. What is running (the warm-up, the campaign chapter) sits above, with its next step. Everything else is in the folded cards below. A beep and the tab title count what is waiting. A message that has already posted can be taken down with **Remove**, and it vanishes from every student's chat. **🤐 Mute chat** stops a student writing and **🔇 Sound off** stops their device reading anything aloud; both follow the student across reconnects and lessons until you turn them back.
   With an OpenAI key (see *AI moderation*), **How chat is moderated** starts on *post chat after OpenAI checks it*: messages OpenAI cleared appear at once, nearby, to everyone or whisper, and you review afterwards. Witness exchanges, flagged messages and anything it could not check still wait for you. Choose *approve every message first* to make every message wait. Without a key, every message waits.
4. **Close class** at the end. Pending chat is rejected and nobody new can join.
5. For a report on the lesson, open **Class report** (under *After class*), press **Build the prompt**, copy it and paste it into an AI chat such as ChatGPT, Claude or Gemini. It lists what each student wrote, answered and asked for, with how each message ended (posted, stopped by the word check, rejected...), and asks the AI who is doing well, who needs help, who is not doing much, and for the common errors. Choose *this lesson* (since the class was opened) or *the whole game*, and the class level. **Hide names** (on by default) puts Student 1, Student 2... in the prompt, also inside messages, and keeps the key on your screen. The prompt contains students' writing, so use an AI service your school allows.

Teacher controls are grouped as the lesson goes (*During class*, *Activities*, *Setup*, *After class*) and every card starts closed. The bar at the top jumps to a card and shows counts: red for what waits on you, grey for status.

## How students chat

The chat box lists conversations down its left side, as faces: **Nearby** (everyone within 350 map pixels; the chat starts here), **Everyone** (the whole plaza), a private chat with each classmate, the newest on top, and the **Teacher** (private, any language). The top of the open conversation shows who reads it: in Nearby, the faces of the classmates close enough, or *Nobody near you*.

- Messages are bubbles, the student's own on the right with what became of it: 🕓 waiting for the teacher, ✓ reached nobody (nobody was near enough), ✓✓ delivered (in a group chat, with how many got it), ✕ not posted.
- A private message opens its conversation by itself when the student is not writing anything and the chat they have open has been quiet for 20 seconds. Otherwise it shows as a banner at the top of the chat until they tap it. Each face counts its new messages, and a folded chat shows the newest on its handle.
- Three dots show who is writing a message that will reach you, in the chat and over their head on the map. What someone says shows over their head for a few seconds (🔒 a whisper, 📢 for everyone), and only to those who received it.
- Clicking a classmate on the map, or a name in a group chat, opens a private chat with them; **＋** lists everyone, nearest first.
- A reloaded page or a dropped connection gets this lesson's chat back, and a whisper approved while its reader was away waits for them.
- Messages for everyone are read aloud only while the Everyone conversation is open; nearby and private ones always are.

A dropped connection (a closed lid, Wi-Fi roaming) reconnects by itself. Opening the plaza in a second tab moves the student's avatar there and tells the first tab why.

The PIN changes every time the class is opened, so last lesson's PIN no longer works. It only lets students in: their avatar and position are saved under their Google account and carry over from lesson to lesson whatever the PIN.

## Play on the teacher's laptop

The class can play on the teacher's laptop instead, over the school network. Students still sign in with Google online, because Google sign-in needs HTTPS, and are then sent to the laptop with their PinPlay session, so their name comes with them.

### Setting up a laptop (once)

1. Install Node.js (nodejs.org) and Git, then `git clone https://github.com/audiophrases/Pixel-Plaza.git`. To update later, run `git pull` in that folder.
2. Double-click `classroom.bat`. The first time it asks for the teacher password. **Use the same password as the online site** (the online site only accepts the link from a laptop that knows it), and it saves a hash in `.dev.vars`. Allow Windows to let it through the firewall on private networks.
3. Add your OpenAI key to `.dev.vars` as a line `OPENAI_API_KEY=sk-...` (the key is a secret, so it is not in git). Without it chat still works, but every message waits for you and there are no grammar hints. `PINPLAY_API_URL` is already written there by the setup.
4. Progress (games, avatars, chat) is kept on that laptop in `.wrangler/classroom`, and is not in git, so it does not move to another laptop by itself.

### Each lesson

1. Double-click `classroom.bat` and keep the window open. It installs and rebuilds anything new, opens the teacher controls, and prints the laptop's address on the school network, such as `http://192.168.1.20:8787`.
2. In the teacher controls (`http://localhost:8787/teacher`, on the laptop itself), sign in. That tells the online site to send students to the laptop.
3. **Games:** pick an existing game from the list and press Open, or make a **New game** (name it, choose Random names and how far students see). A game keeps its own PIN, chat, avatars' positions and story, and you can close and reopen it in any later lesson. One game is open at a time.
4. Write the game's PIN on the board. Students open the online site, sign in with Google, are sent to the laptop, type the PIN, and (with random names) choose a name to keep.
5. When most of the class is in: pick a warm-up (**Find someone who…**, **Who am I?** or **Find your pair**) and start it for the first few minutes, then **Start** the campaign (first time) or just let it resume; press **Start the next chapter** when the class is ready for the next one, so the thief is chosen from students who are there. Use **Reveal the next news** if the class is stuck, and **Vision** to widen or narrow how far students see.
6. **Close class** saves everything and sends students out. Students who were absent join the game with its PIN the next time you open it.

`PLAZA_LAN_URL` overrides the detected address, for example when the laptop has more than one network. `PORT` changes the port. Progress on the laptop is kept in `.wrangler/classroom`, separate from the online plaza: avatars chosen online are not carried over, and students choose them again the first time.

The laptop's address is plain HTTP, so student sessions cross the school network unencrypted. Sign in to the teacher controls on the laptop itself (`localhost`), not from another device.

## Warm-up editor

Open **Warm-up editor** from Teacher controls, or **Edit warm-up** beside the activity selector, to customize the three built-in modes. Edit identities and accepted aliases, facts and the number to find, word pairs, titles, language levels and student instructions. Save to use the content on the next start/restart; an active round keeps its original definition. JSON import/export and **Use built-in content** provide backup and restore. See the [warm-up editor guide](docs/warmup-editor.md).

In **Who am I?**, the server blocks students from writing their own assigned secret identity or aliases in student chat. Guessing another student's identity and replying yes/no stay allowed, as do private answers and teacher help. The teacher sees blocked attempts. Other student-chosen guessing games include separate clue-giver/guesser reminders and need teacher review. See [activity chat rules](docs/activity-chat-rules.md).

## Student assistance

**I need help** offers one AI language hint per student per classroom session when the existing OpenAI key is configured. It uses a short vocabulary tip, grammar explanation or unfinished starter while preserving the student's chat draft. Further requests notify the teacher; students can also ask the teacher directly at any time. Failed AI calls fall back to teacher help without using the allowance. Usage survives reconnects and server restarts and resets when the teacher opens a new classroom session. Teacher controls shows the used/student count, explicit requests and existing suggested check-ins. You can help in person, acknowledge/complete a check-in, or send a private message that appears in the student's chatbox. Students can reply through **Teacher (private help)** using their own words without English checks blocking that explanation.

**Message history** retains every recorded submission, including browser-filtered drafts, server refusals, whispers, witness exchanges, answers and private assistance. It preserves originals, suggested corrections and revised text, with student filtering and pagination past 500 records. Pending audit records survive browser reopening until acknowledged. See the [student assistance guide](docs/student-assistance.md) for detection, retention and offline behavior.

## Levels

Students earn experience (XP) and levels, shown as a green bar at the bottom of the screen, as in Minecraft. Experience is kept for good, across games and lessons, and only unlocks looks, never an advantage in play:

- **Your star:** **⭐ +5 XP** on an approved message in Chat review, or on a report in the Campaign card. Once per message or report; the student sees which sentence earned it.
- **First message:** +1 for their first approved message that reaches a classmate, even a greeting. Once per student across all games, with no AI check required.
- **Automatic, once each:** a right journal answer (+2), a partner quest (+5), and finding everyone in a warm-up (+3). Writing more messages earns nothing by itself.
- **Participation:** useful, varied questions and replies to classmates can earn +1, up to 8 per lesson when AI checks are enabled. See [Participation XP](#participation-xp-optional).

Level 1 needs 10 XP and each level a little more (15, 20, 25...). Level 1 unlocks a name colour, level 2 a flair (a badge before the name) and level 3 four more emotes. Students choose them by clicking the bar. Teacher controls show each student's level in Live plaza. The rules are in `shared/levels.ts`.

## Chat voices and goal sounds

Sound starts **on**. New chat messages are read aloud in the sender's chosen character voice while their text stays visible. Students choose an English voice/accent in the character editor and can replay messages with **Listen**. Successful journal objectives and warm-up answers play PinPlay's rotating correct-answer clips for fun.

**Sound on/off** mutes both voices and celebrations immediately and remembers the student's choice on that device. Unmuting does not play a backlog. Chat and gameplay continue normally if sound is muted or speech is unavailable. Headphones are recommended. A browser that blocks autoplay offers **Enable sound**.

A web page cannot tell headphones from speakers (browsers hide the device names), so the teacher finds the speakers instead. Every clip a device reads aloud is listed for the last 15 minutes. Heard a phrase in the room? Type what you remember of it in **Heard something?** above the class faces: it shows the message, who wrote it, and each device that played it (×3 for replays). One click on a device turns its sound off; the student sees **🔒 Sound off** and nothing plays until you click it again. A face with a pulsing 🔊 is reading aloud right now.

If you cannot identify the device, use **Mute all student sound** beside that search. It stops TTS and game sounds for everyone and locks sound off for reconnects and late joiners until you press **Restore student sound**. The class-wide setting survives server restarts and remains in effect across games until restored. Restoring preserves individual teacher sound locks and students' own mute choices; old messages do not play in a backlog. Chat stays available.

Speech reuses PinPlay's Render Edge TTS bridge. The service may take a while to wake up on the first request. Its address and optional secret can be overridden with `EDGE_TTS_URL` and `EDGE_TTS_SECRET`; secrets stay server-side. Only messages the player received can be requested as speech, under the existing moderation and privacy rules. See [sound and voice details](docs/audio-voice-plan.md).

## Creating and editing missions (Mission Studio)

Open `/mission-studio` from Teacher controls. Choose a mission to edit, or press **New mission**, enter a name and choose a simple starter or an existing mission to copy. Internal IDs are created for you.

1. **Mission setup:** name the adventure, write its ending and edit student roles and starting clues.
2. **Build steps:** choose a chapter, then select one task at a time. **Add step** offers short answers, written responses, classmate searches, secret-thief mysteries and optional partner activities, with explanations. Edit the instructions, answers and when the step opens. Use **Move up**, **Move down** or **Copy step** to organize it. Removing a linked step explains the effect and clears its links; **Undo** restores the removed content and links. Chapter story, ordering, map clues, teacher news and extra options expand when needed. Display order and unlock rules are separate; a new main step follows the last main step by default.
3. **Preview & publish:** inspect a student's journal and clue timing. **Go to fix** opens and focuses fields needing attention. **Save draft** keeps unfinished work; **Publish for new games** makes a validated version available in Teacher controls. Running games keep their published story and progress, including after a restart.

The builder supports desktop and phone layouts. On a phone, selecting a step brings its editor into view. `npm run check:missions` exercises the teacher workflow, imports and live releases. With `npm run dev` running and Chrome installed, `npm run check:missions:browser` checks real desktop/phone layouts and saves screenshots under `.wrangler/mission-browser-*` using isolated sample data.

**The Haunted Castanyada: Five Chapters** (`castanyada-complete`) extends the mystery through the missing festival plan and the haunted celebration. It includes ten optional social investigations, private role notes, different-role partners and evidence/decision reports. See the [chapter and classroom guide](docs/castanyada-five-chapters.md). Reports have a multiline 1,000-character box; normal short answers remain limited to 80 characters. Existing campaigns keep their original revisions.

**Teacher quick guide** in the Campaign card explains each version before you start it. During play, press **Teacher guide** beside the current chapter. Choose a chapter to see its mission, student steps, answers, witness requirements and optional quests; expand a task for its exact clue trail. It uses the game's saved mission version and includes live-added quests. Solutions stay in teacher controls. See the [teacher quick guide](docs/teacher-quick-guide.md).

Under **AI help & files**, **Create with an AI prompt** builds instructions to copy or download for your AI. Ask it to create an adventure, add chapters, or add quests to the selected chapter. Import its JSON by paste or file, inspect the preview, then **Apply to draft** and save. Imports can extend the selected chapter, append chapters, or replace draft content. **Download mission backup** exports JSON. No AI key is needed for this workflow. Direct in-app AI generation remains future work; see [the Mission Studio implementation plan](docs/mission-studio-plan.md).

Mission Studio also supports **all/any prerequisites** and an optional **quest board**. Choose **Partner interview** or **Compare information**, set audience roles, minimum online students, and whether both investigators must finish the main mystery first. Students accept each quest once and get an assigned classmate. They exchange a quest-linked question, reply and private evidence through teacher moderation before submitting a short report. They can find another partner if the assigned student leaves. Exchanges, assignments, reports and completed quests survive reopening and restarts. These events verify participation; the teacher assesses language and reasoning.

Choose **Castanyada: Witness Investigations** (`castanyada-investigations`) to require approved evidence exchanges before each main conclusion as well. Identifying the thief requires two distinct witnesses. Mission Studio can set one or two witnesses for individual questions. See the [witness investigations guide](docs/witness-investigations.md) for the journal flow and teacher transcript controls.

**Hide until I release it in Teacher controls** prepares a quest for later: use **Release quest** in Teacher controls to make it available without resetting progress. This releases content already in the game's published revision; it does not apply new Studio edits to a running game. Try the separate **Castanyada: Side Mysteries** template for two Chapter 1 social quests. Version 1 imports and existing games remain supported; exports using the new mechanics use schema version 2.

**Add to a running game** in Mission Studio lets you release new optional board quests during a lesson. Save the draft, refresh the live target, select the matching chapter and new quests, then **Review live release**. The preview identifies the game/chapter, audience, currently eligible students and exact definitions. **Release reviewed quests** adds that frozen selection to this game and updates students' journals without changing roles, main answers or saved progress. No publication for other games is required. Reviews expire after ten minutes and require a new review if the draft, chapter or live content changes.

**Side quest library** (`/quest-library`, linked from Teacher controls) holds hundreds of ready-made optional quests: ten story quests for each Castanyada chapter, and generic social, plaza, puzzle and seasonal quests that work in any game. Search by words or filter by kind, theme, chapter, level (A1 Starter to B2 Advanced), group size, answer type and length; each card shows whether it is a story or a generic quest. Select up to ten, **Review and add to the game**, then **Release to students**; or download them for Mission Studio. Between chapters, start **Plaza Free Play: Side Quests**, a campaign of sessions without a mystery, and add quests from the library. See the [side quest library guide](docs/side-quest-library.md).

**Inspect released definition** shows the answers and clues actually in that game, even after the source draft is edited. **Withdraw unstarted quest** removes an addition if nobody has accepted it and no remaining quest depends on it. Withdrawn IDs cannot be reused in the same game. Live additions, withdrawal history and progress survive restarts; they belong to that game and are removed only when its campaign is explicitly erased or the game deleted. Core edits still take effect through new published revisions for new games.

## Editing the map (theme studio)

Open `/studio` (for example `http://localhost:8787/studio`). It starts with a neutral layout guide for an **external art AI**. Choose a snow, beach, cruise-deck or custom brief, describe the season/campaign, and copy the prompt or download the AI template kit. The starter has five simple obstacles, two hiding areas and broad connected walking space. Every visible feature can change with the setting.

Your chosen AI creates **one complete background**. Use **Import AI background**, then **Adjust an area** to move/resize the small number of collision and hiding areas. Check paths and walk around it, download the theme, then install with `npm run theme -- "theme.json" --picture "background.png"`. Studio prepares the brief, guides and preview; art creation happens outside the app. Original maps and older Commons treatments remain available. See the [external art workflow](docs/seasonal-art.md).

Studio's original tools remain available: draw or move **blocks** (rectangles, ovals or free shapes), **walk-behind areas**, **zones** and the **start**. **Check where students can walk** shows places that are cut off. **Open a picture** replaces the background without changing the logical coordinate size; nonsquare pictures are rejected. **Download the theme file** and `npm run theme -- plaza` still install the latest `plaza.json` from Downloads. Restart the server to play it. `git checkout shared/themes/plaza.json` restores the original geometry.

## Names in the plaza

Each game is created with **Random names** on (the default) or off:

- **On:** a student is given a made-up name such as *Happy Plato* or *Brave Hypatia*, drawn from PinPlay's random-names lists with unkind adjectives left out. They can ask for **Another name** until they **Keep** one, which they keep for the whole game; until then they cannot chat. Classmates never see real names, and the teacher controls show the real name beside each made-up one.
- **Off:** students are shown by first name, plus the first letter of their surname when two students of the game share a first name (*Roger L*, *Roger C*). Whoever was already there is renamed on every screen when a namesake joins.

The choice is made when the game is created and applies to that game only.

## Safety incidents

Slurs about who people are (race, origin, sexuality, gender, disability), in English, Spanish and Catalan, are stopped however they are spelt (`n1gga`, `n i g g a`, stand-ins such as `nigh`), never get a spelling suggestion, and the student is told only that the word is not allowed. The list is in `shared/safety.ts`. With an OpenAI key, threats, sexual content, bullying and self-harm are caught too, including in messages the English word check had already stopped, and no grammar hint is ever made from them.

Each one is a **🚨 incident** at the top of *To do*, grouped per student and kind with a count and their latest words, with a higher double beep and 🚨 on the student's face. Nothing happens to the student unless you act: reply privately, **🤐** mute their chat, or **✓** mark it seen. Self-harm also says to check on the student in person.

## AI moderation (optional)

With an OpenAI API key, every message, nearby, to everyone or whisper, is checked by OpenAI's moderation endpoint (`omni-moderation-latest`, free to use) after the word filter and before it reaches the teacher.

- **Flagged:** the student is asked to rewrite it. The teacher sees it as *blocked*, with the categories OpenAI gave, such as `harassment`.
- **Clean:** goes to the teacher as before. Approval is still required.
- **OpenAI not answering** (3 second limit): the message still goes to the teacher, marked *not checked by moderation*, so a bad connection never stops the class.

Online: `npx wrangler secret put OPENAI_API_KEY`. On the teacher's laptop, add `OPENAI_API_KEY=...` to `.dev.vars`. Without a key nothing changes. Messages are sent to OpenAI to be checked, so mention it in your school's data notice.

## English only

Before a message is sent, every word is checked against an English dictionary (Hunspell `en_US`, in the student's browser). A word that is not English, whether another language or a spelling mistake, stops the message and shows the word with up to three suggestions to tap, such as *recieve* → *receive*, or *u* → *you*. Names of the students in the Plaza, laughter (*haha*), and chat words (*lol*, *ok*) are allowed, and accents do not matter (*cafe* and *café*). Stretched letters are fine (*helloooo*, *nooo*, *yesss*), and so is a lower-case *i'm*, *i'll* or *i've*; stretching does not make another language English (*siiii*, *holaaaa* are still stopped).

- It is a dictionary check, not a grammar check, and a few loanwords such as *amigo* are English words too.
- On the teacher's laptop (`npm run classroom`) the server checks again with the same dictionary, so tampering with the page does not skip it. The online site checks in the browser only. The teacher review and OpenAI check apply to whatever is sent.
- The dictionary (about 200 KB compressed) loads when the Plaza opens. If it cannot load, chat carries on without the check.

## Grammar hints (optional)

With the same `OPENAI_API_KEY`, a message that passes the dictionary check is also read by a small OpenAI chat model before it is sent. If it finds one clear mistake (verb form, article, plural, preposition, word order, a missing word) the student sees **Try this: *She goes to school every day.*** with a one-line reason in simple English and two buttons:

- **OK** sends the corrected sentence.
- **Ignore** sends what they wrote.

It never blocks. A message that looks fine, a short one (under 4 words), a slow answer (2 seconds), or any error means the message is simply sent. A student who turns hints down three times in a row is left alone for the next message. The queue shows the teacher a *Grammar hint* line for each message, saying whether the student used the suggestion or kept their own words.

Each hint is one small API call (one message, a few hundred tokens), and a student gets at most one a second. The model is `gpt-4o-mini`; set `OPENAI_GRAMMAR_MODEL` in `.dev.vars` (or as a variable online) to use another. Set a monthly spending limit on the OpenAI account. Messages are sent to OpenAI to be checked, so mention it in your school's data notice.

## Participation XP (optional)

A student's first approved message delivered to a classmate earns **+1 XP** immediately, including a simple greeting. This welcome bonus works without an OpenAI key, is awarded once per student across all games and lessons, and survives reconnects, server restarts and game deletion. The same message skips the AI participation check, so it earns one point and costs no participation API call. Later messages use the rules below; repeating greetings cannot earn the welcome bonus again.

With `OPENAI_API_KEY`, students can earn **+1 XP** for a useful question, relevant answer, shared idea or helpful contribution to classmates. Understandable learner English is enough, including a short follow-up question. A message must be approved and reach another student before it is considered. Messages to the teacher, rejected messages and messages sent to an empty plaza do not qualify. The rewards menu explains this alongside the existing teacher stars and quest rewards.

The server filters greeting loops, exact repetitions and near copies before calling AI. One short [Decisions API](https://developers.openai.com/api/docs/guides/decisions) predicate evaluates the new contribution against up to eight earlier messages by that student across nearby/direct recipients and four recent conversation messages they actually received. It does not resend the full history or ask a model to generate an explanation. The server uses a conservative 0.8 probability threshold; this is a heuristic, not a guarantee that farming will always be detected.

Per student and classroom session: **at most 8 participation XP, at most 12 API checks, and at least 45 seconds between checks**. Failed and negative checks consume that allowance too; there are no automatic retries or generated-text fallbacks. Quotas, checked texts and awarded message IDs survive reconnects and Worker restarts. A new session starts when the teacher reopens a class. Checks run in the background and failures leave chat working normally. Messages removed while a check runs earn nothing; XP already awarded stays with the student, like existing XP. Set `OPENAI_PARTICIPATION=0` to disable this feature without disabling moderation or grammar hints. Teacher stars remain worth +5 XP.

## Costs

The Workers free plan is enough for a class. The heaviest case, 30 students all walking non-stop for an hour, is about 36,000 of the 100,000 Durable Object requests the free plan allows each day. Position updates are capped at about 7 a second per student (`SEND_EVERY_MS` in `src/game/scenes/LobbyScene.ts`), and the server passes them on to everyone as one batched message every 150 ms (`MOVE_BATCH_MS` in `worker/plaza.ts`), which keeps a phone hotspot from drowning in small messages, and outgoing messages are free.

## Develop locally

Copy `.dev.vars.example` to `.dev.vars` and fill in the password hash. Locally the Worker reaches PinPlay at `PINPLAY_API_URL` instead of the service binding. Then, in two terminals:

```powershell
npm run dev:worker   # the Worker and the plaza, on http://127.0.0.1:8787
npm run dev          # the app, on http://localhost:5173, forwarding /api to the Worker
```

Google sign-in works locally only from an origin listed in the OAuth client (for example `http://localhost:5173`). Browser storage is per origin, so students sign in separately here and at PinPlay. Local plaza data lives in `.wrangler/state`.

## Check the build

```powershell
npm run lint
npm test
npm run check:missions
node scripts/check-audio.mjs
node scripts/check-chat.mjs
node scripts/check-student-support.mjs
```

`npm test` builds the app, runs the unit tests, then starts `wrangler dev` with a fake PinPlay for a full lesson: PIN and identity checks, moving, chat approval, mutes, a second window, and a restart that must keep every student's avatar and position.

## Current limits

- The PIN is shared by the class and changes each lesson. PinPlay supplies each student's verified Google identity; this app depends on PinPlay's login and roster policy.
- There is one plaza. Every class shares it, so open it for one class at a time.
- The word and phrase filter catches only a small set of obvious cases. Teacher approval is the moderation gate. With an `OPENAI_API_KEY` set, every message also goes through OpenAI's moderation first (see below); the server-side English check runs only on the teacher's laptop.
- Chat is nearby (heard by students within 350 map pixels of where the sender stood), for everyone in the plaza, or a whisper to one classmate; the chat box starts on nearby. All of it waits for teacher approval unless review mode posts it, and the teacher sees whispers too. Room decoration, items, and building interiors are not implemented.
- On the map each avatar is a paper doll made from the same eight parts as the portrait: the head turns the way the student walks (the back of the head when walking away), the torso takes the shirt, and arms and legs swing as they walk. Pants and shoes are derived from the shirt choice, so the saved avatar format is unchanged. See `src/game/AvatarFigure.ts`.
- Browser controls cannot reliably stop screenshots or external translation tools.
