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
