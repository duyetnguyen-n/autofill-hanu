# Upload investigation — 2026-10-15

> Historical notes. As of 2026-10-17, production commit `9119db2` uses the
> five-second document-age / one-second input-stability guard. The section
> below titled “Faster readiness guard” describes an earlier experiment, not
> the current production helper. Its two successful samples are insufficient
> to certify opened-announcement readiness. See `PICKER-READINESS-20261017.md`
> for the newer comparison and its negative counterexample.

## Finding

The reproduced failure is a Picker startup race. The extension treated the
existence of an enabled file input as readiness. Picker could accept the file,
start a successful Google Drive upload, then replace that input/controller
during startup and never attach the result to Forms.

This is verified for the sampled Google account and sample form. The original
failed registration has no retained network response, so its exact internal
Google state cannot be reconstructed. Historical Render 429/503 errors are
not evidence of the cause of this reproduced failure.

## Live evidence (UTC)

All tests used only a blank 1×1 PNG on the user-approved sample form. The
selected Test run was HALTed and `PAGE_RUN_STATUS.active=false` confirmed
before each test. No Next or Submit action was performed.

| Time | Experiment | Result |
| --- | --- | --- |
| 02:21 | Already-open, warmed Picker; old input/change | File appeared on Forms and Picker closed. |
| 02:39 | Fresh Picker; early input/change | Upload HTTP 200; Forms did not receive file. |
| 02:41 | Fresh Picker; early drop | Same failure; drop alone is insufficient. |
| 02:43 | Fresh Picker; early input/change, valid PNG | Upload HTTP 200; file metadata returned, no error; no Forms attachment. |
| 02:45:10–12 | Old input/change after 5-second startup wait | Forms received exact fake filename and Remove file control; Picker closed. |
| 02:45:34 | Early input/change repeated | Input detached within 100 ms and remained replaced; upload HTTP 200, no attachment. |
| 02:48:51–53 | Production startup guard | Input remained connected at 100/1000 ms; Forms confirmed attachment; Picker closed. |
| 02:49:51–53 | Production guard repeated with newly opened Picker | Same successful result. |

The first diagnostic PNG fixture had an invalid IDAT CRC; it was corrected
before the 02:43 and subsequent comparisons. Conclusions use the corrected
PNG. An earlier experiment reloading only the Picker iframe is invalid as an
end-to-end test because that can break its parent's RPC callbacks; it is not
used as evidence.

Google keeps hidden old Picker frames. Diagnostics match only the visible
parent iframe's RPC identifiers. An empty file input alone is not a failure
signal: Google's upload handler intentionally clears it after selection.

## Fix

- Keep input/change delivery. Experimental early/drop variants live only in
  `scripts/picker-upload-experiment.ts`, outside extension build entries.
- Require document load completion, at least 5 seconds of Picker document age,
  and the same input object across at least 1 second of polling. A replacement
  input starts its own stability wait. This is a tested startup guard, not a
  universal Google readiness API or a guarantee under every network condition.
- Allow up to 20 seconds for startup. Preserve one assignment marker and never
  automatically repeat an upload after handing over the file.
- Preserve transient Google Picker errors, poll status without retransmitting
  image bytes, and distinguish handing over a file from Forms confirmation.
- Keep exact filename + Remove file + Picker closed as the success condition.
  Errors or missing confirmation continue to block Next/Submit.
- Stop waiting once the elapsed upload deadline is reached; background browser
  scheduling can still delay when JavaScript next gets CPU time.

## Faster readiness guard (subsequent optimization)

The five-second floor above was an initial conservative fix. Further controlled
tests on another Google account found a useful semantic signal: Picker adds its
live-region message `Đã mở bộ chọn Chèn tệp.` after replacing the initial input.
The current production helper can proceed after that announcement and 250 ms
of stability of the replacement input. Without a recognized announcement, it
retains the five-second/one-second stability fallback. This is observed UI
behavior, not a documented universal Google readiness API.

| Time (UTC) | Experiment | Result |
| --- | --- | --- |
| 03:00:48 | Remove five-second floor, keep one-second input stability | Success; 3,391 ms to assignment, 5,996 ms to Forms confirmation. |
| 03:02:51 | Only 250 ms input stability, no ready announcement | Failure reproduced; old input detached within 100 ms; upload HTTP 200 without Forms attachment. This variant is rejected. |
| 03:04:33 | Wait for opened-Picker announcement + 250 ms input stability | Success; 1,761 ms to assignment, 4,335 ms total. |
| 03:05:17 | Announcement guard repeated on a newly opened Picker | Success; 1,744 ms to assignment, 4,327 ms total. |

Both successful announcement traces show an initial input with no announcement,
then a replacement input with the announcement, then upload after its stability
check. The input stayed connected during both uploads. Only the approved blank
1×1 PNG was used; Forms was not advanced or submitted.

Startup polling in the background now sends a small `prepareOnly` request;
stored photo bytes are read, encoded and injected only after readiness. Status
polls and repeated assigned requests also avoid reading/transmitting the photo.
Cancellation is checked before preparation, before reading and after encoding.

255 tests across 36 files, application/diagnostic typechecks and diff checks pass.
Attempting another live account check ended when Computer Use could not
determine the current browser URL confidently and stopped. No further browser
input was issued after that stop. These two fast announcement tests cover one
account/form, not a simultaneous multi-profile registration or real ID images.

The optimized release is copied to `releases/dist-cloud`, with a clean ZIP at
`releases/hanu-autofill-online-fast-upload-20261015.zip`. The previous five-second
build is backed up at `.backups/upload-five-second-guard-20261015`. Each Chrome
profile still needs an extension Reload and newly opened form to use this newer
release; browser reloads were not attempted after the Computer Use stop.

## Validation and delivery

250 tests passed across 36 files. Application typechecks, diagnostic typecheck,
`git diff --check`, and Online extension build passed. Live validation covers
one account and form with the synthetic image; it does not cover every Google
account, real ID image, or simultaneous multi-profile registration.

The extension originally loaded from `releases/dist-cloud`, built October 13.
A new build in root `dist-cloud` alone does not update that installed folder.
The fixed build (2026-10-15T02:50:39Z) was copied to that installed folder;
background/content/manifest hashes were verified against its build-info.
The previous release is backed up under `.backups/upload-before-startup-fix-20261015`.
The clean release ZIP is `releases/hanu-autofill-online-upload-fix-20261015.zip`.
The sampled Chrome profile was Reloaded; at 02:54:05 its coordinator connection
was healthy, its Test run paused with recovery required, and the fake attachment
still confirmed on Forms. The other Chrome profiles still need Reload.
Existing Forms content scripts need a newly opened/reloaded form before they use
the new code. No registration was started or submitted as part of the update.
