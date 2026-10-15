# Sound and character voices

Implemented locally on 15 October 2026 after the teacher approved the clarified scope. Students use individual headphones. Sound starts ON by default; each player can mute it. Changes have not been deployed.

## The two purposes

**Goal celebrations:** reuse PinPlay's correct-answer sound clips when a student reaches a game goal. These short sounds are for fun and make the achievement feel satisfying. The proposal uses the existing rotating success clips.

**Chat read-aloud:** let students hear a chat message while its written text stays visible. English is a foreign language for these learners, and its spelling and sound patterns differ from those they know. Hearing the same words they are reading is intended to help them connect written forms and spelling with actual speech: what those words sound like.

Voice and English-accent choice can form part of character personalization. The character's messages are read in the selected synthetic voice. Students can preview voices before choosing one.

This replaces the previous broader proposal. Separate listening activities, listening mysteries, draft/suggestion rehearsal, instruction narration and a staged research pilot are outside this plan.

## Proposed experience

- Reaching a goal plays one of PinPlay's correct-answer clips, rotating among the available success clips for variety. Trigger the sound once for the new achievement; restoring history or reconnecting should not replay it.
- Newly delivered chat messages are read aloud automatically in the sender's selected character voice while the exact written text stays visible. A Listen/Stop button also allows replay.
- Character personalization includes an English voice/accent picker with a short sample. Reuse PinPlay's voice catalogue and Edge TTS service via Render.
- A Sound on/off button mutes both chat voices and goal clips immediately. The choice is saved per student on the device, with no old-message backlog on unmute. Speech and celebration clips share a queue so they do not overlap.
- Keep the visible text available throughout playback. If speech is unavailable, chat continues to work normally.

Automatic playback is the default. Join/save gestures unlock browser audio; if the browser still blocks it, Enable sound resumes playback after a click. Restored teacher-message history stays quiet. Retraction, disconnection, mute and leaving the game cancel pending or active speech. System announcements are not spoken.

## PinPlay reuse already identified

Source inspected: `audiophrases/pinplay`, commit `876da8b7938beabee868c7f8e1a5fd0bea7f1fe0`.

| Existing source | Used for |
| --- | --- |
| [Correct-answer clip rotation](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/play.js#L6621) | Reuse the four success clips for goals reached |
| [English voice catalogue](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/app.js#L3540) | Voice/accent selection and character previews |
| [Render deployment](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/render.yaml) and [Edge bridge](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/setup/tts-bridge/edge_tts_bridge.py) | Synthesize chat text using the selected voice |
| [Worker proxy](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/cloudflare/worker.js#L2339) and [compact speech player](https://github.com/audiophrases/pinplay/blob/876da8b7938beabee868c7f8e1a5fd0bea7f1fe0/spellingbee.js#L433) | Adapt the small request/playback pieces to Pixel Plaza |

The catalogue contains 34 English voice options in 14 regional groups. Old characters use Sonia (UK) until a voice is chosen. Voice is saved alongside appearance, and each chat message keeps the voice selected when it was sent. Fixed sample requests to the existing Render bridge returned MP3 successfully for Sonia (UK) and Emily (Ireland); the entire catalogue has not been tested live. The first request took 43 seconds and the later request 1.9 seconds. No production configuration was changed.

## Implementation notes

Goal sounds are static app assets. A small Web Audio player handles speech and effects. The authenticated `/api/plaza/speech` endpoint accepts a message ID and checks actual recorded delivery recipients in the current game before requesting speech from Render. The message's exact text and stored voice come from the server, rather than arbitrary client text. The same checks run again before returning audio, covering retractions or game changes during synthesis. Recorded recipients preserve earshot permissions after players move and across restarts. Legacy messages without delivery provenance fail closed.

Private teacher replies and the student's own private messages to the teacher follow the same audience restrictions. Teacher replies use the default English voice. The separate `/api/plaza/voice-preview` endpoint speaks one fixed sample in an allowed voice. Independent per-student budgets limit speech and preview requests without spending the sign-in/PIN budget.

The app calls PinPlay's existing Render bridge directly, avoiding the public quiz-speech cache. Credentials remain server-side, and speech responses are private/no-store. Optional `EDGE_TTS_URL` and `EDGE_TTS_SECRET` overrides are documented in `.dev.vars.example`. Requests and streamed audio have size and time bounds. Bridge failure leaves chat and gameplay usable.

Read the message exactly as delivered, without silently correcting or changing its wording. Speech playback does not affect goal completion, language grading or the existing teacher-assistance and message-audit features.

## Verification

The production build and lint checks run through the existing commands. Focused tests cover voice validation, sequential playback, default-on behavior, mute persistence, cancellation and browser autoplay recovery. Runtime integration tests cover sender-voice persistence, moderation, actual recipients, movement, private messages, restart, retraction and game isolation. `node scripts/check-audio.mjs` exercises the real React UI with controlled network/audio: automatic incoming speech, mute, replay controls, successful-goal clips, private replies and character voice previews. The existing student-assistance UI checks also pass.

The full regression run passed 132 of 133 tests; the existing “other warm-ups” test timed out waiting for a result and passed on an isolated rerun. The full run is therefore not recorded as green. The additional browser-autoplay test passed in the focused audio suite.

