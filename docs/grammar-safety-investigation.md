# Grammar hint safety investigation

Tested on 27 October 2026. The initial investigation reproduced the problem;
the local changes below subsequently addressed it. Nothing was deployed to the
online app.

## Current changes and validation

- The server applies a local explicit-sexual-content rule before either grammar
  or sending. It catches the reported sexual-action/body-word pattern, explicit
  terms and tested disguises, while preserving ordinary names and health language.
- Grammar is requested only after a positive clean moderation verdict. Its saved
  reason records the safety result or the reason checking was unavailable.
- In automatic mode, failed moderation asks the student to retry with their
  draft intact. It creates no approval queue. Explicit teacher approval mode
  and the investigation activity's intentional approval steps remain supported.
- The drawer says a grammar hint was **generated**, rather than claiming the
  student saw it. The browser still discards hints after four seconds.
- These changes reduce risk; local rules and a classifier cannot guarantee
  identification of every harmful message.

The updated diagnostic completed 13 scenarios. All eight moderation failures
skipped grammar and remained unsent with a retry prompt. The two local sexual
controls were blocked without an AI call. The clean control still posted and
received grammar help. The current JSON output is
`.wrangler/grammar-safety/report.json`; the initial output is preserved as
`report-before.json` in the same directory.

A real-Worker regression test also checked private, nearby and whole-class chat,
no delivery to a second test student, incident deduplication, successful retry
after an outage, and ordinary automatic delivery without any teacher approval.
Four relevant integration tests and 19 unit tests passed. The build and type
checks passed; lint reported existing warnings and no errors.

## Local simulation

Run `node scripts/check-grammar-safety.mjs` from the repository root. It starts
the real Worker locally, creates a throwaway class with a synthetic student,
and uses a simulated OpenAI HTTP server. Production data and real API keys are
not used. It retains a JSON report and Worker log under
`.wrangler/grammar-safety/` and stops its servers when finished.

Neutral canary sentences and local-filter examples test routing rather than AI classification. Only
the moderation endpoint fails; the grammar stub deliberately returns a valid
correction. An HTTP 401 simulation therefore tests independent endpoint
outcomes, not whether an invalid real key could successfully call grammar.

The table below records the **initial behavior before the changes**, not the
current diagnostic results.

| Moderation response | Grammar requested | Hint recorded | Send outcome in post-then-review mode |
| --- | --- | --- | --- |
| Clean control | Yes | Yes | Posted |
| Flagged sexual control | No | No; teacher incident recorded | Blocked |
| HTTP 500 | Yes | Yes | Teacher approval required |
| HTTP 429 | Yes | Yes | Teacher approval required |
| HTTP 401 | Yes | Yes | Teacher approval required |
| Invalid JSON | Yes | Yes | Teacher approval required |
| Empty results | Yes | Yes | Teacher approval required |
| Missing `flagged` field | Yes | Yes | Teacher approval required |
| Connection closed | Yes | Yes | Teacher approval required |
| Response exceeding three-second timeout | Yes | Yes, at 3.047 seconds | Teacher approval required |
| Clean moderation plus slow grammar | Yes | Yes, at 4.369 seconds | Posted |

All 11 initial scenarios completed. Each checked the WebSocket response, saved attempt,
teacher conversation status, incident presence, and subsequent send behavior.
The diagnostic exits successfully when it completes; that is not a claim that
the app's safety behavior is correct.

## Live moderation check

Six real moderation requests used the configured key with three synthetic
examples, repeated twice. No pupil messages were sent and no live grammar
requests were made.

- Ordinary grammar error: clean twice.
- Explicit adult sexual services: flagged as sexual twice.
- Targeted insult: flagged as harassment twice.
- All six returned HTTP 200 in 0.306–1.639 seconds.

This small sample establishes that the current endpoint works with these
examples. It does not establish what it returned for the morning's message.
The local raw results are in `.wrangler/grammar-safety/live-report.json`.

## Findings

Before the fix, `worker/moderation.ts` returned `unchecked` for errors, malformed
responses and timeouts, and the grammar path treated the result as no harm.
The send path independently required a clean verdict for automatic posting,
so the grammar bypass did not imply automatic delivery. The grammar path now
requires an explicit clean result too, and automatic-mode failures request retry.

The previous history label also overstated what it knew: the server writes
`hint-offered` when it generates a correction, while `PlazaConnection.check()`
drops responses arriving after four seconds. The simulated 4.369-second hint
was recorded for the drawer even though it exceeded that browser deadline.
The speech-bubble icon therefore proves a server correction was recorded,
not necessarily that the student saw it. The tooltip now describes that accurately.
The old hint stage did not retain the moderation verdict, preventing a
retrospective distinction between a failed check and a missed flag for the
morning's request. The new hint-stage reasons record clean, blocked or failed
safety outcomes.

## Manual tester

`tester.bat 2` opens a separate local class with teacher, Ana and Ben tabs and
uses the configured OpenAI key. It can check current live behavior visually;
the diagnostic above is needed to reliably force failures and timeouts.
The batch file currently forwards only its first argument, so its documented
`noai` and `random` extra arguments are dropped. To pass those options directly,
run `node scripts/tester.mjs 2 noai` or `node scripts/tester.mjs 2 random` after
a build. Disabling AI also disables grammar hints, so it cannot reproduce the
moderation-failure/grammar-success path.
