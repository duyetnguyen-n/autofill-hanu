# ChineseTest provider

integrations/chinesetest contains the HTTPS client, human login helper, encrypted runner, cloud relay and website page. The existing extension is unchanged; there is no Chrome bridge or browser fallback during submission. tool-autofill remains reference source.

Human login uses an isolated Chrome profile. Only after Finish does the helper read ChineseTest cookies, validate /userInfo/getInfo through Node and persist a session in AES-256-GCM with an OS-protected key. Passwords, challenges and unrelated getInfo fields are not retained. Temporary browser data is removed after successful import/cancel. Calls reproduce the official client’s Origin, Referer, language, fresh server timestamp and request signature. This is the normal protocol, not a verification bypass. TLS verification remains enabled; redirects are rejected.

Live uses a frozen candidate/target snapshot and separate arming with website Live/concurrency/expiry limits. The local worker owns monotonic deadlines, center discovery and submission. Clock jumps/sleep stop unsent runs. Center reads are coalesced per exam/date/format, including in-flight reads. Final checks use current capacity, linked subject and final fee. Capacity can be boolean true. Unsupported schemas, missing identity/photo/history and unparsed records stop instead of guessing.

A synced reservation precedes every registration POST. No automatic POST retry is allowed. Reserved/sending/queued runs after restart require reconciliation. Order polling never resubmits. Cloud stores opaque owner-scoped account/exam claims across disconnect/device deletion; release requires an unsent terminal run or a user-verified absent result. Worker matches cloud grants to the encrypted run before arming. Cloning an already-armed vault is outside the cross-machine guarantee and must not be done.

## Center discovery and registering again after cancellation (2026-10-23)

The public `/portal/index/getExamSiteList` directory is paginated and scoped to Vietnam (`countryId=180`) and format (`type`). It normalizes `siteName/siteEName` to `kdName/kdEName` while preserving `kdId`. The UI loads it ahead of publication and automatically loads enrollment centers when level/date/format changes. Catalog promises coalesce by query and device; late results from another date/device are not displayed under the current selection. The enrollment `/examinee/enroll/getExamSiteList` uses `gjId=180` and remains the authority for actual registration. No claim is made that unpublished directory entries can be retrieved.

Discovery intervals accept 0–60 seconds. Zero waits for the previous response and inspection, yields the event loop, then reads again; pending reads still coalesce across accounts. Existing rate-limit backoff and single registration POST behavior are preserved.

Accepted and confirmed runs support explicit absence verification after external cancellation. Verification requires user confirmation, a valid matching session, fully parsed Test Records with no matching level/date, and no in-flight task for that run. Unknown cancellation status codes are never guessed. A durable `released` state with `verifiedAbsentAt` preserves historical order identifiers; existing worker claim messages release the exact cloud claim before the command result. Persistence failures restore the lock. Later reconciliation of released runs cannot revive a historical order. No schema migration is needed. Both website assets and the local runner must be updated; this change does not cancel any registration itself.

### UI feedback and polling correction

The center picker uses a Fluent searchable combobox. Opening it shows the complete directory even with Dong A selected; typing filters names, cities and codes without accents. A separate optional entry supports unpublished names/IDs.

Absence verification owns its progress/error state inside the modal. Active registrations, timeouts and old-runner errors remain visible without dismissing the modal; success requires the returned snapshot to explicitly mark the selected run `verifiedAbsent`. Legacy runners rejecting completed runs get an update instruction instead of a silent error behind the dialog.

Dashboard refresh is independent of ChineseTest discovery. The visibility-aware monitor refreshes devices every 30 seconds and runner state every 60 seconds while idle, or every 2.5 seconds while active. Refresh cycles never overlap, failures back off, and hidden tabs issue no automatic refreshes. Concurrent state reads coalesce; a read started before a mutation cannot overwrite its result. Google Forms/auth fallback reductions are unchanged.

Validation: 50 ChineseTest tests and typecheck pass. Browser integration opens a 10-center select with Dong A selected, filters and chooses an unpublished center, observes no idle devices/state calls over 6.5 seconds, and exercises verification loading, active-registration errors, timeout, legacy runner and successful release. Fixtures send zero registration POSTs; this does not claim a new production registration/cancellation test.

The tested HCMUE RSA-OAEP/AES-GCM envelope and vault codec are reused with separate provider keys, schema, replay store, vault path and Keychain service. HCMUE's only shared vault change is an optional service argument preserving the default. Provider tables are owner-filtered and inaccessible to public/anon/authenticated roles. Account/device switching clears website state.

## Build and test

- npm run typecheck
- npm run test:chinesetest
- npm run build:chinesetest
- npm run build:cloud-server
- npm run test:chinesetest-ui
- npm run test:chinesetest-native (Windows/macOS; isolated temporary vault)
- npm run package:chinesetest

Packaging refuses to overwrite an existing extracted runner directory, including one that a user may still be running. For another release, pass a new directory, for example `node scripts/run-node24.mjs scripts/package-chinesetest.mjs --output-dir=releases/chinesetest-update-20261023`. The ZIP and checksum are written there and copied to the website's download build.

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

## Durable portraits, drafts and read-only fee quotes (2026-10-24)

Migration `202610240001_chinesetest_profiles.sql` adds owner/runner/account-scoped drafts with optimistic revisions. The existing private `hanu-private` bucket stores original portraits under a ChineseTest prefix. Backend image endpoints enforce owner access and version matching, validate size/MIME/signatures, serve no-store previews and clean up replaced originals. Draft metadata and originals survive closing/reloading the editor. User-supplied photo URLs never override the ChineseTest upload path. Credentials/cookies remain exclusively in the encrypted local runner vault; the cloud now explicitly stores personal profile drafts and photo originals, not session credentials.

Choosing a file writes Storage and the cloud draft first, then marks the photo version pending on the runner without uploading to ChineseTest. Save writes the draft, reads that exact portrait version and sends it inside the existing encrypted command envelope; the runner uploads only if its synced version differs, persists profile/path/version together, then the browser acknowledges the exact cloud revision. Failures preserve the cloud draft and block new preparation/arming through the website. Runner-side pending versions also invalidate previously prepared schedules. Reopening restores the saved draft and preview. Legacy photos with no retained original require choosing the file once to gain a cloud preview; no remote-path thumbnail is fabricated.

`read-profile` returns a local clone without identity HTTP calls or waiting behind catalog reads. Catalog controls expose independent loading/retry states. Browser catalog/fee reads are bounded to two pending commands; identical concurrent fee queries coalesce for the current device/configuration. No shared server cache is introduced. Initial device discovery no longer races the device-selection effect during reload.

The fee display reads getKsFees/getJiLianList with the chosen level/format/date/center and authoritative currency from ChineseTest center metadata. Unknown fees remain unknown. New plans use an immutable displayed fee quote instead of editable maximum/currency fields. Preparation requires a quote, and final inspection refuses changed amount/currency before the single registration POST. Existing saved runner plans retain their legacy fee checks until edited in the website. The API inspection and Test/Live paths do not bypass capacity, identity, linked-subject, duplicate-send or consent checks.
