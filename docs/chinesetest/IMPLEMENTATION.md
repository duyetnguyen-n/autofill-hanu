# ChineseTest provider

integrations/chinesetest contains the HTTPS client, human login helper, encrypted runner, cloud relay and website page. The existing extension is unchanged; there is no Chrome bridge or browser fallback during submission. tool-autofill remains reference source.

Human login uses an isolated Chrome profile. Only after Finish does the helper read ChineseTest cookies, validate /userInfo/getInfo through Node and persist a session in AES-256-GCM with an OS-protected key. Passwords, challenges and unrelated getInfo fields are not retained. Temporary browser data is removed after successful import/cancel. Calls reproduce the official client’s Origin, Referer, language, fresh server timestamp and request signature. This is the normal protocol, not a verification bypass. TLS verification remains enabled; redirects are rejected.

Live uses a frozen candidate/target snapshot and separate arming with website Live/concurrency/expiry limits. The local worker owns monotonic deadlines, center discovery and submission. Clock jumps/sleep stop unsent runs. Center reads are coalesced per exam/date/format, including in-flight reads. Final checks use current capacity, linked subject and final fee. Capacity can be boolean true. Unsupported schemas, missing identity/photo/history and unparsed records stop instead of guessing.

A synced reservation precedes every registration POST. No automatic POST retry is allowed. Reserved/sending/queued runs after restart require reconciliation. Order polling never resubmits. Cloud stores opaque owner-scoped account/exam claims across disconnect/device deletion; release requires an unsent terminal run or a user-verified absent result. Worker matches cloud grants to the encrypted run before arming. Cloning an already-armed vault is outside the cross-machine guarantee and must not be done.

The tested HCMUE RSA-OAEP/AES-GCM envelope and vault codec are reused with separate provider keys, schema, replay store, vault path and Keychain service. HCMUE's only shared vault change is an optional service argument preserving the default. Provider tables are owner-filtered and inaccessible to public/anon/authenticated roles. Account/device switching clears website state.

## Build and test

- npm run typecheck
- npm run test:chinesetest
- npm run build:chinesetest
- npm run build:cloud-server
- npm run test:chinesetest-ui
- npm run test:chinesetest-native (Windows/macOS; isolated temporary vault)
- npm run package:chinesetest

HTTPS fixture tests need OpenSSL (Git for Windows supplies it). Execution needs Google Chrome only for human login and playwright-core to launch that window; browser binaries are not shipped. Packages contain pinned Node 24.21.0 and the Playwright driver package. Packaging defaults to the current Windows/Mac architecture; --all-platforms on Linux/macOS builds Windows x64 and Mac arm64/x64 while preserving executable permissions. Packaging is separate from machine certification.

## Enable on the existing website

1. Review/back up the database and apply additive supabase/migrations/202610220001_chinesetest_runners.sql as the backend database owner.
2. Build cloud UI/server, then package/copy runner downloads. Vite clears UI output, so packaging follows UI build.
3. Set HANU_CHINESETEST_ENABLED=1 and restart the backend. Default is OFF. Existing account approval, Live access and limits apply.
4. Open runner and pair from /chinesetest. No Google Forms extension update is required.

Production migration/deployment is not performed by local builds. Hiding the feature does not stop offline armed schedules; stop them explicitly first.

## Verification on 2026-10-22

Initial Windows human login and authenticated Node read calls succeeded after closing Chrome. The earlier test vault had no saved candidate/photo and zero Test Records; it was distinct from the user's paired production runner. The 613-test repository suite passed with two workers (unrestricted parallelism overloaded the local test databases and timed out); ChineseTest's original 20 targeted tests passed separately. UI fixture checks exercised pairing, fingerprints, three synthetic accounts, Dong A API inspection, scheduled Test, profile editing, mobile/light/dark and return to Google Forms, with zero registration POSTs. Native Windows checks covered DPAPI, actual worker/encrypted relay, replay rejection, local UI and stop. macOS remains unverified.

### Production Live acceptance at 17:10 ICT

With explicit user authorization and agreement confirmation, the existing production management page and paired Windows runner completed a real HSK 4 IBT registration at Dong A for 2026-12-13, including the required Speaking subject. The user's existing saved profile and portrait were used. Re-login was initiated from the management page and completed through Finish login; a subsequent read-only API inspection returned a final fee of 60 USD.

The run was armed several minutes ahead of 17:10 ICT. A pre-deadline identity check succeeded. The management connection briefly reported an interruption, then recovered; the same saved local run continued. The server created an order from exactly one registration submission, with a payment deadline of 2026-11-27. Read-only reconciliation found the registration and its ID on Test Records. No payment or cancellation was performed; cancellation was left to the user. Private identifiers and the actual result screenshot are kept only in ignored test-results/chinesetest artifacts.

This verifies the full management-page-to-runner-to-API flow with an available center. It does not establish session lifetime, reproduce the old 16:16 failure, measure submission latency, or verify release-time contention/closed-to-open center behavior.

### Session precheck correction

The original T−30/T−5 precheck discarded every failure cause and stopped with an expiry message, including transport and server failures. The runner now classifies explicit authentication responses separately from HTTP access errors, protocol/clock failures and transient transport/429/5xx failures. Transient early checks preserve the armed schedule; final identity verification retries at most once within the wait deadline. Registration POSTs remain single attempt. Overlapping identity reads coalesce per account; an old read cannot invalidate a newly imported login. Stop/version guards apply to warnings, retries and late responses.

31 ChineseTest tests and typecheck passed for this correction, including expiry, transient recovery/exhaustion, HTTP-versus-JSON 403, coalescing, stop during retry and stale-session rejection after re-login. scripts/chinesetest-session-check.ts reads the selected local vault and calls only identity APIs without constructing an Engine or writing the vault; output omits account identifiers and credentials. This fix requires updating the local runner, with no new migration or backend environment variable. A read-only probe of the default vault returned an identity-stage JSON 401; that vault dated from the earlier test, so it does not establish the cause or lifetime of the user's newly logged-in session.
