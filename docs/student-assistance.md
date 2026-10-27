# Student assistance and submitted-message history

Students can use **I need help** while playing to ask about writing an idea, game instructions, a classmate's message or another problem. The help panel copies their unfinished chat draft without changing or sending it. They can instead describe their intention in any language.

With the existing `OPENAI_API_KEY` configured, the single **Get help** button provides one successful AI-assisted language scaffold per student per classroom session. The AI selects a relevant vocabulary tip, grammar explanation or incomplete starter from a validated set. Arbitrary generated answers, names, codes and mission solutions cannot be displayed. Only the submitted help note and topic go to the model; mission content, hidden clues, answer keys, classmates' messages and chat history are not supplied. The student finishes and sends their own message.

Further requests go directly to the teacher. The student sees the same button without choosing a recipient. Every AI request also creates a teacher check-in immediately; its alert shows the AI feedback when ready so the teacher can intervene or let the student continue. The feedback remains in submission history. Teacher replies are text-only, including mixed Catalan and English, with no automatic speech or Listen button.

The **Message history** tab shows **AI help requests used / students in this session**. The denominator counts distinct students who joined this session, including those now disconnected. Usage and the private hint persist in SQLite across refreshes, reconnects and server restarts. Reservations are atomic and durable so simultaneous requests cannot launch a second AI call. A new classroom session starts when the teacher opens a closed class, switches to another game or creates a new game. Repeating Open while already open, reconnecting, changing chapters and resetting the campaign do not reset usage.

The helper uses the existing OpenAI key/base URL with `gpt-4o-mini`, at most 80 completion tokens and a strict four-second timeout covering the entire request. It makes one call with no automatic retries. No key, timeout, refusal, invalid output or other failure falls back to the same teacher alerts without consuming the allowance. Failed attempts have a 30-second retry cooldown to bound costs; teacher help stays available throughout. Chat grammar hints and safety moderation remain independent.

The API uses [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) to select a scaffold ID; the server validates the ID and renders only its own approved text.

The **Teacher (private help)** chat recipient lets a student explain an idea without the English-word or grammar checks stopping it. Private teacher replies arrive in that student's chatbox and are replayed after reconnecting. The teacher can send help to an offline student; it appears when they return to the same game. These messages are recorded for teacher review and stay private to that student and the authenticated teacher.

## Suggested check-ins

Three observations in the same category within five minutes suggest that the teacher check in. Writing observations include blocked word checks and grammar hints. Instruction observations include incorrect journal and warm-up answers. Other repeated message-filter refusals are shown separately. A repeated check of one submission does not count as several grammar observations, and technical rate limits or connection failures do not produce a language alert.

Suggestions include the observed reasons and submitted text. They remain for review until the teacher acknowledges or resolves them. Resolving a check-in resets its detection history, so three new observations are required for another suggestion. Explicit requests and suggestions for the same student coalesce into one active check-in. The app verifies events and offers a prompt to help; the teacher assesses the student's needs, understanding and language. It does not assign a proficiency score or grade.

## Complete submission history

In Teacher controls, open the **Message history** tab, or click a student's face for their conversations beside the class. Filter by student and use **Load older messages** to review the whole game history. The history includes chat and whispers, witness questions and replies, journal/report and warm-up answers, help notes and private teacher replies. Each record shows original text, time, source, recipient or objective, status and the reason a submission was stopped. Grammar suggestions and revised submissions are retained separately from the original wording.

Recording starts when a student explicitly submits text, before browser word checks, server filters, teacher moderation and other delivery refusals. Draft typing is not recorded. Audit records have no 500-message pruning limit. Closing or reopening a class, reconnecting, restarting the server or resetting a campaign preserves them; explicitly deleting the game erases its history and help data.

Pending browser audit records are scoped to the student and class PIN and saved without authentication tokens. They remain in browser storage until the server acknowledges them, and resend after reconnecting or reopening the game. Restored records do not post chat, submit answers or notify the teacher on the student's behalf. If browser storage is disabled or full, pending records survive in memory only until that page closes. A help request that could not reach the teacher keeps its note and asks the student to retry the notification when connected.

Retained chat from before this feature is imported once. Previously deleted chat and attempts that old clients never recorded cannot be reconstructed. Teacher history endpoints require a teacher session, and requests bind the selected game and student filter to prevent stale pages from showing another game's records.

## Validation

Storage tests cover the observation window, resolution reset, original/revised text, ownership, game and student pagination, equal timestamps, retained-chat migration and game deletion. Browser tests cover prefilter recording, offline queues and acknowledgement, private help, preserved drafts, full history pagination and game switching. Multiplayer tests cover help requests, filtered and rate-limited attempts, private replies, more than 600 records, reconnect/restart, repeated grammar checks, incorrect answers and a game switch during moderation.

AI-specific unit and runtime tests cover concurrent reservation, successful usage, failed-call refund/cooldown, direct teacher bypass, session reset, reconnect/restart persistence, request privacy, invalid outputs and the four-second timeout. Student and teacher UI checks cover the saved composer, incomplete hint, absence of automatic chat messages, teacher escalation and dashboard counter. These checks use a fake OpenAI service rather than making billable model calls.
