# Guessing-game chat rules

Different activities need different rules. Do not apply a global list of mission answers to chat: investigators need to exchange evidence, and guessers need to type candidate answers.

| Activity | Current protection |
| --- | --- |
| Who am I? warm-up | Automatically blocks the sender's own assigned identity and accepted aliases in nearby chat, whispers and messages to everyone. |
| Ten Questions, Undercover Object, Mystery Word | Reminds the clue-giver to keep the chosen object secret and answer yes/no. Guessers may name guesses and receive confirmation. Teacher review is needed because the app does not store the chosen object. |
| Taboo Showdown | Reminds the describing player to avoid the answer and forbidden words during their turn. Guessers may name the answer. Student-chosen words need teacher review. |
| Job Hot Seat, Postcard From Somewhere | Reminds the clue-giver to keep the job/place name out of clues until guessed. Guesses and the discussion after a correct guess remain allowed. |
| Find your pair, Find someone who…, mystery investigations | Normal information and clue sharing remains allowed. |
| Operation Pizza and Word Smuggler | Saying a particular word is part of the task. Do not ban it for every participant. |

## Who am I?

The app already stores who holds each secret identity. It checks the sender's identity, not every famous name in the message:

- A student holding Messi cannot write “I am Messi”, “Lionel Messi”, or “Yes, Messi!” to classmates.
- A student holding a different identity can ask “Are you Messi?” or type Messi as their private final answer.
- The helper can confirm with “Yes!” or “Yes, I am.”
- Private messages to the teacher remain available.

Checks recognize case, accents, ordinary punctuation, invisible formatting, stretched letters and elementary spelling-out. This is a direct-name rule, not a semantic judge of every indirect hint.

The server applies the rule without an AI key, before posting or queueing a message. It checks again after asynchronous moderation and before teacher approval, including Approve all. Blocked messages and reasons stay in the teacher's history. Rules come from persisted assignments, survive reconnects/restarts and continue when a student finishes their guessing task: they may still be helping others. Ending the warm-up releases the restriction.

For student-chosen secrets, automatic blocking would first require a private setup step recording the secret, forbidden words, clue-giver and guessers for each round. Those library activities currently provide reminders and teacher review; they do not claim automatic blocking. Mission Studio's prompt tells an external authoring AI to preserve this distinction.
