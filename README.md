# Pixel Plaza

A social plaza for an ESL class. Students sign in through PinPlay's Google student login, choose avatars, move around a shared map, use emotes, and submit chat messages, either to people nearby or as a whisper to one classmate. Every chat message, whispers included, must be approved by the teacher before anyone sees it, unless the teacher chooses the review mode below.

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
3. Approve or reject chat as it arrives: **A** and **R** act on the oldest waiting message, **Approve all** clears the queue, and a beep and the tab title count what is waiting. A message that has already posted can be taken down with **Remove**, and it vanishes from every student's chat. **Mute student** follows the student across reconnects and lessons.
   With an OpenAI key (see *AI moderation*), **How chat is moderated** starts on *post nearby chat after OpenAI checks it*: messages OpenAI cleared appear at once and you review afterwards. Whispers, flagged messages and anything it could not check still wait for you. Choose *approve every message first* to make every message wait. Without a key, every message waits.
4. **Close class** at the end. Pending chat is rejected and nobody new can join.

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

## Editing the map (theme studio)

Open `/mission-studio` from the teacher controls to edit campaigns, chapters, roles, clues and accepted answers. Start from Castanyada or create a new draft. **Save draft** keeps work in progress; **Publish for new games** validates it and makes it available in the teacher's campaign list. Games already running keep their published story revision, including after a restart.

**Create with an AI prompt** builds instructions to copy or download for your AI. Ask it to create an adventure, add chapters, or add quests to the selected chapter. Import its JSON by paste or file, inspect the preview, then **Apply to draft** and save. Imports can extend the selected chapter, append chapters, or replace draft content. **Export JSON** provides a backup. No AI key is needed for this workflow. Direct in-app AI generation and live quest release are future work; see [the Mission Studio implementation plan](docs/mission-studio-plan.md).

Open `/studio` (for example `http://localhost:8787/studio`). It opens the plaza theme: draw or move **blocks** (where nobody can walk: rectangles, ovals or free shapes), **walk-behind areas** (trees and lamps that hide a student standing behind them, with a ground line), **zones** (named places for the story) and the **start**. **Check where students can walk** shows any place that is cut off, and **Walk around it** lets you try it. Then **Download the theme file** and run `npm run theme -- plaza`: it checks the newest `plaza.json` in your Downloads folder and installs it in `shared/themes/`. Restart the server to play it. `git checkout shared/themes/plaza.json` puts the old one back.

## Names in the plaza

Each game is created with **Random names** on (the default) or off:

- **On:** a student is given a made-up name such as *Happy Plato* or *Brave Hypatia*, drawn from PinPlay's random-names lists with unkind adjectives left out. They can ask for **Another name** until they **Keep** one, which they keep for the whole game; until then they cannot chat. Classmates never see real names, and the teacher controls show the real name beside each made-up one.
- **Off:** students are shown by first name, plus the first letter of their surname when two students of the game share a first name (*Roger L*, *Roger C*). Whoever was already there is renamed on every screen when a namesake joins.

The choice is made when the game is created and applies to that game only.

## AI moderation (optional)

With an OpenAI API key, every message, nearby or whisper, is checked by OpenAI's moderation endpoint (`omni-moderation-latest`, free to use) after the word filter and before it reaches the teacher.

- **Flagged:** the student is asked to rewrite it. The teacher sees it as *blocked*, with the categories OpenAI gave, such as `harassment`.
- **Clean:** goes to the teacher as before. Approval is still required.
- **OpenAI not answering** (3 second limit): the message still goes to the teacher, marked *not checked by moderation*, so a bad connection never stops the class.

Online: `npx wrangler secret put OPENAI_API_KEY`. On the teacher's laptop, add `OPENAI_API_KEY=...` to `.dev.vars`. Without a key nothing changes. Messages are sent to OpenAI to be checked, so mention it in your school's data notice.

## English only

Before a message is sent, every word is checked against an English dictionary (Hunspell `en_US`, in the student's browser). A word that is not English, whether another language or a spelling mistake, stops the message and shows the word with up to three suggestions to tap, such as *recieve* → *receive*, or *u* → *you*. Names of the students in the Plaza, laughter (*haha*), and chat words (*lol*, *ok*) are allowed, and accents do not matter (*cafe* and *café*).

- It is a dictionary check, not a grammar check, and a few loanwords such as *amigo* are English words too.
- On the teacher's laptop (`npm run classroom`) the server checks again with the same dictionary, so tampering with the page does not skip it. The online site checks in the browser only. The teacher review and OpenAI check apply to whatever is sent.
- The dictionary (about 200 KB compressed) loads when the Plaza opens. If it cannot load, chat carries on without the check.

## Grammar hints (optional)

With the same `OPENAI_API_KEY`, a message that passes the dictionary check is also read by a small OpenAI chat model before it is sent. If it finds one clear mistake (verb form, article, plural, preposition, word order, a missing word) the student sees **Try this: *She goes to school every day.*** with a one-line reason in simple English and two buttons:

- **OK** sends the corrected sentence.
- **Ignore** sends what they wrote.

It never blocks. A message that looks fine, a short one (under 4 words), a slow answer (2 seconds), or any error means the message is simply sent. A student who turns hints down three times in a row is left alone for the next message. The queue shows the teacher a *Grammar hint* line for each message, saying whether the student used the suggestion or kept their own words.

Each hint is one small API call (one message, a few hundred tokens), and a student gets at most one a second. The model is `gpt-4o-mini`; set `OPENAI_GRAMMAR_MODEL` in `.dev.vars` (or as a variable online) to use another. Set a monthly spending limit on the OpenAI account. Messages are sent to OpenAI to be checked, so mention it in your school's data notice.

## Costs

The Workers free plan is enough for a class. The heaviest case, 30 students all walking non-stop for an hour, is about 54,000 of the 100,000 Durable Object requests the free plan allows each day. Position updates are capped at 10 a second per student (`SEND_EVERY_MS` in `src/game/scenes/LobbyScene.ts`), and outgoing messages are free.

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
```

`npm test` builds the app, runs the unit tests, then starts `wrangler dev` with a fake PinPlay for a full lesson: PIN and identity checks, moving, chat approval, mutes, a second window, and a restart that must keep every student's avatar and position.

## Current limits

- The PIN is shared by the class and changes each lesson. PinPlay supplies each student's verified Google identity; this app depends on PinPlay's login and roster policy.
- There is one plaza. Every class shares it, so open it for one class at a time.
- The word and phrase filter catches only a small set of obvious cases. Teacher approval is the moderation gate. With an `OPENAI_API_KEY` set, every message also goes through OpenAI's moderation first (see below); the server-side English check runs only on the teacher's laptop.
- Chat is nearby chat (heard by students within 350 map pixels of where the sender stood) or a whisper to one classmate. Both wait for teacher approval, and the teacher sees whispers too. Room decoration, items, and building interiors are not implemented.
- On the map each avatar is a paper doll made from the same eight parts as the portrait: the head turns the way the student walks (the back of the head when walking away), the torso takes the shirt, and arms and legs swing as they walk. Pants and shoes are derived from the shirt choice, so the saved avatar format is unchanged. See `src/game/AvatarFigure.ts`.
- Browser controls cannot reliably stop screenshots or external translation tools.
