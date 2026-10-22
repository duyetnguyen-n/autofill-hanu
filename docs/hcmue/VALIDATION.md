# Local validation, 2026-10-21

- Original baseline: 549 tests in 54 files passed before changes.
- Feature tests: 21 additional tests cover engine deadlines, 20-account execution, duplicate locks across re-login, queue/timeout handling, OS-vault encryption codec, transport session isolation and cloud ownership.
- Final full suite: **570/570 tests in 58 files passed**. An earlier overlapping packaging run overwrote the shared runtime during test-worker startup; packaging now extracts into its own staging directory, and the full suite passed after that fix.
- TypeScript: both application and manager/provider projects passed.
- Cloud server/UI and bundled local runner builds passed.
- Browser HCMUE check: real encrypted relay with synthetic data; pairing, fingerprint comparison, prepare/arm/deadline dry run, light/dark/390px mobile and returning to Google Forms passed. Zero HCMUE registration POSTs.
- Existing Google Forms browser suite passed on installed Chrome: login/callback fixture, account isolation, pairing, upload while editing, save/sync, logout/switch state clearing and mobile login. The existing test script was run from an ignored copy with only its browser channel changed from Chromium to the installed Chrome; application and original test were unchanged.
- macOS arm64 native smoke passed: actual bundled worker, actual Keychain-backed vault, encrypted state command over the relay, and independent local stop. Temporary state was removed. No school API requests.
- Scheduler benchmark, dedicated worker, 1,000 batches ×20 callbacks: P95 lateness 0.855 ms, P99 1.276 ms, maximum 11.525 ms; P95 batch spread 0.040 ms. Scope is monotonic scheduling and JSON payload serialization on this machine, **not network latency or slot success**.
- macOS arm64, macOS x64 and Windows x64 archives include a pinned Node 24.21.0 runtime verified against the official SHA-256 manifest. Source/build metadata intentionally does not claim complete platform certification.

Screenshots and machine reports are under ignored `test-results/hcmue/`. Runner archives and their SHA-256 sums are under ignored `releases/`. Production migrations/deployment and a new real registration have not been performed. Windows/Intel real-machine checks remain required before relying on those builds for a live opening.

## Per-account planning update, 2026-10-22

- Each account now selects its own exam, Vietnam dispatch time and mode. Independent preparation failures no longer abort the batch. Editing a prepared plan prevents arming the outdated plan; preparing a new level replaces the previous prepared schedule for that account.
- Every returned exam remains available, including ended/full exams. Source status and all exam fields remain unchanged; time/capacity observations are separate. Read-only inspection returns individual profile/questions/registration/conflict checks without creating a schedule.
- Rehearsals allow ended/full/future exams and existing registration/conflicts, while retaining identity/photo/email/question checks and never calling registration POST. Live mode retains actual registration eligibility checks and now gives specific errors. Runner protocol version 2 is required for these new actions; older runners show update instructions.
- 32 HCMUE tests passed. Full suite: 593 tests in 61 files passed with `--testTimeout=15000`. The first default-timeout run passed 592 and timed out one existing cloud admin-lock test at 5 seconds; that file independently passed 12/12, then the entire suite passed with the longer per-test timeout. No unrelated test source was changed to hide the timeout.
- CUA browser verification used the actual cloud fixture, encrypted relay and engine with three synthetic candidates: HSK 2 ended, HSK 4 full and HSK 6 available. API inspection read all four checks for all three; live preparation correctly rejected the first two independently while preparing the third in test mode. Rehearsal of all three completed without registration POST. Exact source JSON for the ended exam remained visible with status `open` alongside the separate expired observation.
- Desktop 1440px and mobile 390px light/dark checked; mobile document width 375px <= viewport 390px. Returning to Google Forms showed its original form-link control. Screenshots: `test-results/hcmue/per-account-*.png` (ignored local evidence).
- No new real school registration, payment or cancellation was performed. A real registration queue-to-final-result check in a valid opening and Windows/Intel native-machine validation remain outstanding.
