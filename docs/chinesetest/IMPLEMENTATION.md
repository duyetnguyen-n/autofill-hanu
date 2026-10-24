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

HTTPS fixture tests need OpenSSL (Git for Windows supplies it). Execution needs Google Chrome only for human login and playwright-core to launch that window; browser binaries are not shipped. Packages contain pinned Node 24.21.0 and the Playwright driver package. Packaging defaults to the current Windows/Mac architecture; --all-platforms builds Windows x64 and Mac arm64/x64. On Windows, Python 3 is used only by the developer packaging script to set Unix executable modes in Mac ZIPs; runtime and launcher ZIP modes/CRCs are verified. Recipients do not need Python. Packaging is separate from machine certification.

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

### Slow photo synchronization correction (2026-10-24)

The old client applied a 15-second deadline to every API and described any transport timeout as an uncertain registration. Uploads now have a 60-second deadline; reads have a 20-second deadline and at most one transport/HTTP transient retry. POSTs are never automatically retried. Errors identify clock, identity, upload or registration separately. The provider can return an upload-specific code 500 authentication message even when the same session passes getInfo; that response is translated without automatically invalidating the account.

`start-profile-sync` returns a job ID immediately. `profile-sync-status` reads queued/checking-session/uploading/saving/done/failed through the existing encrypted relay. Polling bypasses the command queue; completed results include only profile/version data. Repeated saves of the same pending account/draft/version join its job. Different concurrent drafts are rejected. Saves take priority over queued catalog/fee reads after the current command finishes. Staging a pending photo is immediate, with post-read checks preventing an in-flight preparation/arming from using the previous photo. Only successful durable saves can produce a done result and the cloud revision acknowledgment. Jobs are memory-only; originals/drafts and synced versions remain durable, so restart recovery uses the same Save action without re-uploading an already synced version.

The UI requires `profileSyncJobsVersion: 1` and shows an update instruction for older runners. Deploy both website/server assets and rebuilt runner packages. No additional SQL migration or environment variable is needed beyond the existing portrait-storage setup.

Real macOS verification used the exact retained original of the reported profile and its existing authenticated session. A direct upload returned a valid provider path; an earlier attempt exceeded the old timeout and another returned the provider's code 500 authentication response. These observations establish variable provider/network behavior, not a proven expired session or malformed multipart body. Official frontend source confirms multipart field `file`. Diagnostics did not submit registration requests or change the live vault/cloud sync status. Windows uses the same client, engine and encrypted protocol; native Windows execution of this correction remains unverified.


### Direct ChineseTest portraits (2026-10-24, Windows follow-up)

Supersedes the Supabase-original/draft flow above. Photo selection starts `start-photo-upload`, independent of incomplete personal fields. Reopening/retrying a read uses `start-photo-read`, so slow identity/image requests do not outlive a single relay request; it joins an in-flight account upload when present. It uploads once, durably records a pending provider path, reads its bytes through the runner, and returns them over the existing encrypted memory-only relay. The UI waits for its actual image element's load event before showing success or recording cloud metadata. Read/decode failure is not success. Retrying the same photo version or reopening after a read failure uses GET without another upload. An interrupted upload with no returned path requires the user to choose/retry the file; no automatic POST retry is added.

The image reader allows only a bounded JPG/PNG path on the official HTTPS origin, verifies TLS, refuses redirects, bounds size/time, checks content type/magic, and retains bytes only in memory. Cookies/bearer remain in the runner. HTTP 401/403 for an image triggers identity verification before deciding that login expired. Upload-specific code 500 and network timeout remain distinct from expired identity.

`photoFlowVersion: 2` gates the new UI. `/photo-metadata` accepts only path/version/MIME/revision. Cloud GET does not expose personal drafts. Legacy original/draft writes and preview routes return 410; no new Storage put/get occurs. Existing originals/drafts are removed after a replacement image was displayed and metadata saved; failures retain the cleanup key for retry. There is no blanket deletion migration. Personal fields are persisted only in the runner vault when Save is pressed. Existing encrypted runner state remains compatible. Website and runner must be updated together.

The Windows follow-up verified a fresh isolated runner login and authenticated profile GET (~607 ms); getLastBm and the stored runner profile had no provider photo path, so an actual portrait read-back could not be checked without a new external upload. No external upload/profile change/registration was made in this follow-up. The observed JWT has only login_user_key and no exp. The inspected official frontend uses Img_API=/ and appends the returned upload path. Absence of an observed refresh endpoint is not proof that no backend renewal exists. No periodic traffic promising session extension is added.

`npm run diagnose:chinesetest-network` makes anonymous read-only requests and records cumulative DNS/TCP/TLS/TTFB/total timings without opening a vault or modifying profiles. Run the same command on Mac and a different network for a comparable report. Windows observations on 24 October: home 1.2–3.24 s, public APIs 0.34–1.03 s; authenticated profile GET 0.607 s. Minute-long Mac failures were not reproduced in these Windows samples. A real public static PNG was also read through the new image reader in 546 ms (12,484 bytes); this does not prove access to an uploaded candidate portrait or its durability across session expiry.

Fresh-session idle observation: no research-client requests between 08:06:44 and 08:36:46 UTC; identity then returned 401/auth/identity, confirmed again at 08:37:36 UTC. The newly acquired token differed from the old runner token and matched its imported token cookie. This is a fresh-session rejection after the observation interval, not the previous stale-vault case. It does not establish the exact expiry instant, a fixed 30-minute TTL, renewal by activity, or concurrent-login semantics. An activity-versus-idle comparison requires another fresh human login in a later session. No unproven keepalive mechanism was shipped.

Evening follow-up used another fresh human login: all eleven 5-minute identity checks through minute 55 succeeded with the original bearer token. Chrome closed after minute 10, leaving about 45 minutes of Node-only operation. With no further research-client requests for 35 minutes, the same session then returned 401/auth/identity at 15:31:00 UTC, confirmed by a newly constructed client at 15:31:17 UTC. This supports authenticated read activity as a practical maintenance approach in the tested window, without proving exact TTL or unlimited duration. No periodic maintenance feature has been integrated into the runner yet. See [session research](SESSION-RESEARCH-20261024.md) for the protocol, data and remaining limits. No registration/profile writes were performed; the temporary Windows sleep-inhibition request was released.

### Enrollment correction and session activity (2026-10-25)

The new runner maintains authenticated identity activity every five minutes after arm, through waiting_center/checking, with response-based scheduling and the existing per-account identity promise coalescing. It stops on stop, completion, revoke, close or invalidation; late results cannot reactivate a schedule. Transient failures preserve login and back off at least five minutes, respecting longer Retry-After. The final pre-submit identity/fee/duplicate/consent checks are unchanged. Prepared/inactive accounts do not create periodic provider traffic. This supersedes the earlier notes saying maintenance is not integrated; it does not promise unlimited session lifetime.

Real getJiLianList for Dong A HSK 4 IBT 2026-12-13 returned two rows: 60202044 (HSK Level 4 Speaking), then 984459 (HSKK Intermediate). Official enrollment chunk 059c7f0.js uses jiList[0] for validJiLian and jlKmId. The runner now follows that ordering instead of requiring length === 1. It validates the first ID and never guesses a later row when the first is malformed. Fee quotes show only that selected subject and bind its ID; a changed subject blocks submission even at an unchanged price. getKsFees already returned total 60 USD, while center.fee was 35 and validJiLian returned 25; no extra 25 is added to the total. Official source: https://www.chinesetest.cn/_nuxt/059c7f0.js.

An isolated engine with writes/registration disabled passed a real provider Test at 16:57:23 UTC on 24 October (23:57:23 Vietnam), using a fresh human login and fixture personal fields never transmitted to ChineseTest. Quote, inspection, preparation, arm and final Test all passed, 60 USD, jlKmId 60202044, zero provider POSTs. No live user vault or schedules were changed by this API acceptance.

UI acceptance found an intermittent hidden accessible profile dialog on reopen after other dialogs, especially with all controls disabled during async loading. Profile and absence dialogs explicitly activate their modal after Tabster observes the surface; absence checks focus the surface before disabling controls. The browser checks exercise repeated reopen, loading, keyboard focus, close, and old-runner warnings. enrollmentChecksVersion:1 gates preparation/arm/inspection/fee commands on the website so older executables do not silently keep the bug after web deploy.
