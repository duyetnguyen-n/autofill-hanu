# 1.5.0 — ten concurrent Chrome profiles

## Runtime contract

- Each selected profile prepares, crosses its own durable Start transaction, and dispatches immediately. Another member's slow capability check, missing attachment, disconnect or rejected preflight does not hold it behind a batch barrier. Start results persist per member and request IDs remain idempotent.
- The group gate exists before preparation. Stop/Pause fences members still preparing as well as members already running. PostgreSQL still checks account permissions, the concurrent-profile quota, session ownership/version and submit locks transactionally.
- Dashboard actions are pending per profile. Stop stays available during a slow operation. WebSocket state is authoritative; an out-of-order HTTP refresh cannot overwrite a newer acknowledgement.
- A document uses one independent renderer lease for filling, menus, uploads and Next. Foreground fallback remains unavailable in the cloud build, preventing a slow physical-window queue from serializing profiles.
- Start waits for a readable DOM/account, rather than unrelated page resources completing. Dropdown options wake on DOM changes. Account and server form checks can run concurrently; both must finish before input.
- Fields are read back before advancing, including selections and photos. Free text must preserve the exact saved case and diacritics; normalization is only for matching question labels/options. An old upload skip hint is never evidence that the current document contains the file. Resume after reload rechecks/refills it from the frozen profile.
- Background navigation monitoring survives replacement of the old content document. At 5 seconds it reports slowness. At 25 seconds it parks and schedules the existing bounded recovery through the original GET URL. It never clicks Next twice for one unresolved navigation or reloads a locked submission.
- A delayed document, interrupted run, new run or Stop cancels the predecessor monitor. The journal/alarms restore observation after worker suspension; worker/server disconnect still requires explicit reconciliation. Chrome/OS scheduling can delay timers.
- Form observations and HALT acknowledgements have deadlines. A frozen renderer cannot hold the durable Stop/recovery queue indefinitely. Old content progress is rejected after Stop.

## Validation

`npm run typecheck`

`npm test -- --maxWorkers=2 --testTimeout=20000`

`node scripts/run-node24.mjs node_modules/tsx/dist/cli.mjs scripts/background-flow-check.mjs --cloud --profiles=10 --faults`

`node scripts/run-node24.mjs node_modules/tsx/dist/cli.mjs scripts/profile-isolation-ui-check.ts`

The ten-profile fixture uses ten real headed Chromium processes with independent extension storage, actual cloud WebSockets and PostgreSQL (PGlite). Google hostname traffic is routed to a synthetic local HTTPS form; it never submits real registrations. Form pages are not attached to Playwright or given harness focus/throttling overrides.

The mixed fault scenario combines a hung streamed POST document, CAPTCHA and rejected upload while seven healthy profiles finish. Other cases cover 500/503/429, retry exhaustion/cancellation, reload with saved corrections, 22-second Next, disconnect, extension reload, double Restart/stale Stop, actual panel/manager buttons, and accepted Submit with lost confirmation. Test submits zero; synthetic Live is exactly once per profile.

The UI isolation check leaves Focus 1 unresolved while Restart 2 and Stop 1 complete.

## Timing interpretation

The operational target is 15–20 seconds to the verification/Submit stage, with correctness and isolation mandatory. Local fixture timings measure software overhead and permit before/after comparisons; they do not predict a crowded Google server, a real Picker upload, human verification or a cold Render instance. The ten-profile scope does not establish twenty-profile capacity.

Benchmark options: `--latency-ms=1500`, `--asset-delay-ms=20000`, `--report=unique-name`. JSON reports record per-profile readiness/page times, hardware, latency settings and isolated-process resource samples under `test-results/`.

The actual Google test form must be tested in Test mode from cleared drafts after deployment. Report the number of real profiles separately from synthetic load and exclude time spent waiting for human verification.
