# Student assistance and submitted-message history

Students can use **I need help** while playing to ask about writing an idea, game instructions, a classmate's message or another problem. An optional note can use any language. The teacher sees the request with the student's real and game names, can acknowledge it, and can complete the check-in after helping in person.

The **Teacher (private help)** chat recipient lets a student explain an idea without the English-word or grammar checks stopping it. Private teacher replies arrive in that student's chatbox and are replayed after reconnecting. The teacher can send help to an offline student; it appears when they return to the same game. These messages are recorded for teacher review and stay private to that student and the authenticated teacher.

## Suggested check-ins

Three observations in the same category within five minutes suggest that the teacher check in. Writing observations include blocked word checks and grammar hints. Instruction observations include incorrect journal and warm-up answers. Other repeated message-filter refusals are shown separately. A repeated check of one submission does not count as several grammar observations, and technical rate limits or connection failures do not produce a language alert.

Suggestions include the observed reasons and submitted text. They remain for review until the teacher acknowledges or resolves them. Resolving a check-in resets its detection history, so three new observations are required for another suggestion. Explicit requests and suggestions for the same student coalesce into one active check-in. The app verifies events and offers a prompt to help; the teacher assesses the student's needs, understanding and language. It does not assign a proficiency score or grade.

## Complete submission history

In Teacher controls, open **Message history** or **View messages & help** on an alert. Filter by student and use **Load older messages** to review the whole game history. The history includes chat and whispers, witness questions and replies, journal/report and warm-up answers, help notes and private teacher replies. Each record shows original text, time, source, recipient or objective, status and the reason a submission was stopped. Grammar suggestions and revised submissions are retained separately from the original wording.

Recording starts when a student explicitly submits text, before browser word checks, server filters, teacher moderation and other delivery refusals. Draft typing is not recorded. Audit records have no 500-message pruning limit. Closing or reopening a class, reconnecting, restarting the server or resetting a campaign preserves them; explicitly deleting the game erases its history and help data.

Pending browser audit records are scoped to the student and class PIN and saved without authentication tokens. They remain in browser storage until the server acknowledges them, and resend after reconnecting or reopening the game. Restored records do not post chat, submit answers or notify the teacher on the student's behalf. If browser storage is disabled or full, pending records survive in memory only until that page closes. A help request that could not reach the teacher keeps its note and asks the student to retry the notification when connected.

Retained chat from before this feature is imported once. Previously deleted chat and attempts that old clients never recorded cannot be reconstructed. Teacher history endpoints require a teacher session, and requests bind the selected game and student filter to prevent stale pages from showing another game's records.

## Validation

Storage tests cover the observation window, resolution reset, original/revised text, ownership, game and student pagination, equal timestamps, retained-chat migration and game deletion. Browser tests cover prefilter recording, offline queues and acknowledgement, private help, preserved drafts, full history pagination and game switching. Multiplayer tests cover help requests, filtered and rate-limited attempts, private replies, more than 600 records, reconnect/restart, repeated grammar checks, incorrect answers and a game switch during moderation.
