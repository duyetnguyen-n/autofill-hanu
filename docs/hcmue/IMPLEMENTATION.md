# HCMUE provider: implementation and release checks

## Boundaries

- Provider source: `integrations/hcmue/`. Google Forms content scripts, background runner, parsing, native messaging, coordinator, scheduled registrations and existing database rows are unchanged.
- Existing website integration is limited to an optional `/hcmue` page, `/api/hcmue/*` routes and `/hcmue-runner` WebSocket. UI is lazy loaded. The default feature flag is OFF.
- One local worker runs the school API and timing. Cloud relays encrypted commands/replies; it does not receive HCMUE passwords, cookies, tokens or form answers in plaintext.
- Maximum: 20 accounts and 20 active schedules per runner, further constrained by existing website account limits. Up to 3 paired runners per website account. There is no cross-machine duplicate lock: never configure the same HCMUE account on several runners.

## Timing and submission

1. Discover current independent-candidate exams, using the exact `(ma_cap_thi, ngay_mo_dang_ky)` tuple. Keep the school's time string unchanged in POST.
2. Prepare: verify identity/photo/email, questions, existing registration and schedule conflict. Dynamic question answers use the school's option text. Unsupported schemas and linked-unit codes fail closed.
3. Arm explicitly: check Live entitlement, future deadline and one active schedule per account. Save before acknowledging the website.
4. At T−30 seconds (when enough lead time) and T−5 seconds, recheck profile/exam/questions/registration/conflict. Each account owns a keepalive pool, cookie jar and device ID. The final durable reservation must finish before T−2 seconds.
5. A dedicated worker waits on a monotonic deadline. No cloud or disk write is awaited in the dispatch callback. No UI countdown of 10 seconds is added. A wall-clock jump, sleep/event-loop discontinuity or late readiness stops the unsent schedule. OS automatic time synchronization is required; this version does not claim server clock synchronization.
6. Test mode reaches its timer and records local timing without invoking registration POST. Live sends once. A second POST is allowed only after a known failure before TLS connection, after 500 ms, with generation/time checks; maximum two transport attempts.
7. A response containing a code is recorded, then checked against registration status. Queued jobs are polled for up to two minutes (honoring Retry-After). Ambiguous results are checked at offsets 0/1/2/4/8/16/30/60 seconds; they are never blindly resent.
8. In-flight POSTs cannot be recalled. Local/website stop disables future sends and polling; a sent request remains uncertain until verified. A late definitive response may still update its outcome.
9. Restart never replays an armed or reserved request. Reserved/sending/queued records require reconciliation. Stopping or losing the cloud connection is separate from a school's cancellation API; cancellation/payment are not implemented.

## Security and persistence

- Session vault: AES-256-GCM with atomic synced writes, OS key via macOS Keychain or Windows CurrentUser DPAPI. The OS vault key is never stored beside ciphertext. Passwords are not written to the vault.
- Device: RSA-OAEP/SHA-256 identity; commands use a random AES-GCM key wrapped to the device public key, and a separate encrypted reply key. Command ID is authenticated AAD. Commands have a two-minute timestamp window and a durable replay cache.
- One-use pairing code: 64 random bits, five-minute validity, hashed in PostgreSQL. Browser pins the full SHA-256 public-key fingerprint after manual comparison. Runner credentials are random 256-bit tokens, stored only as a hash on cloud.
- Cloud uses existing Google authentication/access checks and explicit owner predicates. `hcmue` schema/table are inaccessible to public/anon/authenticated database roles; only the backend SQL connection manages device metadata. Run migrations as the same database owner used by the backend or grant that role access explicitly.
- Remote revocation clears local accounts and schedules when received; an offline runner must be stopped locally. Re-pairing after revocation needs a restart. Browser-to-runner encryption does not protect against malicious JavaScript delivered by a compromised website, the device OS, or a compromised local user account.
- Logs do not contain HCMUE credentials or payloads. Local UI listens only on 127.0.0.1, validates Host/Origin, requires an unguessable HttpOnly cookie and supports a local stop independently of cloud.

## Build, test and enable

Run from the repository root (Node.js 24 is used through the existing wrapper):

```sh
npm run typecheck
npm test
npm run build:cloud-server
npm run test:hcmue-ui
npm run build:hcmue
npm run test:hcmue-native
npm run bench:hcmue
npm run package:hcmue
```

- Development TLS integration tests require OpenSSL on PATH; packaged runners do not.
- Unit/integration coverage: supported question payloads, encryption/AAD, vault wrong-key rejection, exact-time dry runs, 20 independent accounts, duplicate locks, Live limits, queue reconciliation, ambiguous timeouts, known transport retry, stops, clock changes, durable reservation, restart recovery, real local TLS, cookie/device isolation, owner isolation, pairing and default-off behavior.
- Browser check uses actual encrypted relay + synthetic accounts. It checks light/dark/mobile, pairing/fingerprint, prepare/arm/dry-run and return to Google Forms. It never sends to HCMUE.
- Native smoke uses actual OS vault + bundled worker and an isolated temporary data directory. It pairs with a local fixture, reads encrypted state and stops locally. It makes no HCMUE API calls. This creates/reuses the OS vault key; temporary test state is removed.
- Benchmark is **only the dedicated monotonic scheduler and payload serialization**: 1,000 batches of 20 callbacks. The report identifies OS/architecture and scope. Targets: P95 lateness ≤25 ms, P99 ≤50 ms, P95 batch spread ≤25 ms. It does not measure HTTPS transport, remote acceptance, or slot-success rate.
- Artifacts/screenshots/reports go to ignored `test-results/hcmue/`. Packages go to ignored `releases/HCMUE-*.zip` and `build/cloud-ui/hcmue-downloads/`. Node runtimes are pinned to 24.21.0 and verified against the official SHA-256 manifest.
- The cloud Docker builder also packages all three runners and copies the archives into the website image; it installs zip/unzip only in the builder stage. No public GitHub release or new download credentials are required.
- Run `package:hcmue` **after** the final cloud UI build, because Vite empties its output directory. Run `build:hcmue` again whenever runner source changes. Runner archives are separate from HANU/Google Forms packages.

To enable on a server: back up its database, apply only the additive `supabase/migrations/202610210001_hcmue_runners.sql`, install dependencies/build the new server/UI, produce/copy runner downloads, set `HANU_HCMUE_ENABLED=1`, and restart the server. Existing account approval and Live permissions still apply. To hide the feature, set the flag back to 0 and restart; stop armed local schedules explicitly because they intentionally survive cloud disconnection. No production migration or deployment is performed by building this feature locally.

## Release status limits

macOS arm64 can be smoke-tested on the current machine. Windows x64 and macOS Intel archives can be built here, but real-machine Keychain/DPAPI, packaging, keep-awake, clock/sleep and deadline checks must run on each target OS before claiming that platform is certified. BUILD.json intentionally records realMachineVerified=false until certification. A real low-volume HCMUE end-to-end check is still needed on the current school API before relying on a future opening; do not infer a guaranteed slot rate from local fixture tests or the prior successful request.
