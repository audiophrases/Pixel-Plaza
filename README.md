# Pixel Plaza

A social plaza for an ESL class. Students sign in through PinPlay's Google student login, choose avatars, move around a shared map, use emotes, and submit chat messages, either to people nearby or as a whisper to one classmate. Every chat message, whispers included, must be approved by the teacher before anyone sees it.

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
3. Approve or reject chat as it arrives. **Mute student** follows the student across reconnects and lessons.
4. **Close class** at the end. Pending chat is rejected and nobody new can join.

A dropped connection (a closed lid, Wi-Fi roaming) reconnects by itself. Opening the plaza in a second tab moves the student's avatar there and tells the first tab why.

The PIN changes every time the class is opened, so last lesson's PIN no longer works. It only lets students in: their avatar and position are saved under their Google account and carry over from lesson to lesson whatever the PIN.

## Play on the teacher's laptop

The class can play on the teacher's laptop instead, over the school network. Students still sign in with Google online, because Google sign-in needs HTTPS, and are then sent to the laptop with their PinPlay session, so their name comes with them.

Once on the laptop: install Node.js and copy the project. The first time `classroom.bat` runs it asks for the teacher password (the same as online) and saves its hash in `.dev.vars`; delete that file to enter it again. Then, each lesson:

1. Double-click `classroom.bat` (or run `npm run classroom`) and keep the window open. The batch file also opens the teacher controls when the server is ready. It prints the laptop's address on the school network, such as `http://192.168.1.20:8787`. The first time, allow Windows to let it through the firewall on private networks.
2. On the laptop, open `http://localhost:8787/teacher` and sign in. This tells the online site to send students to the laptop. Then press **Open class** and write the class PIN it shows on the board.
3. Students open the online site as usual and sign in with Google. They go straight to the laptop, type the class PIN there, and choose their avatar.
4. **Close class** stops sending students to the laptop. The link also ends by itself after 12 hours. Until then, a student who signs in online is sent to the laptop's address even if it is switched off.

`PLAZA_LAN_URL` overrides the detected address, for example when the laptop has more than one network. `PORT` changes the port. Progress on the laptop is kept in `.wrangler/classroom`, separate from the online plaza: avatars chosen online are not carried over, and students choose them again the first time.

The laptop's address is plain HTTP, so student sessions cross the school network unencrypted. Sign in to the teacher controls on the laptop itself (`localhost`), not from another device.

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
```

`npm test` builds the app, runs the unit tests, then starts `wrangler dev` with a fake PinPlay for a full lesson: PIN and identity checks, moving, chat approval, mutes, a second window, and a restart that must keep every student's avatar and position.

## Current limits

- The PIN is shared by the class and changes each lesson. PinPlay supplies each student's verified Google identity; this app depends on PinPlay's login and roster policy.
- There is one plaza. Every class shares it, so open it for one class at a time.
- The word and phrase filter catches only a small set of obvious cases. Teacher approval is the moderation gate. There is no dictionary enforcement or AI context review.
- Chat is nearby chat (heard by students within 350 map pixels of where the sender stood) or a whisper to one classmate. Both wait for teacher approval, and the teacher sees whispers too. Room decoration, items, and building interiors are not implemented.
- Browser controls cannot reliably stop screenshots or external translation tools.
