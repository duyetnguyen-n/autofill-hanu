# HCMUE API: verified response contracts, 2026-10-22

Base: `https://hsk.hcmue.edu.vn/v1/api`. Keep these independent of HANU/Google Forms APIs.

## Confirmed connection fault

On this machine the pre-fix runner intermittently failed HTTPS with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` before receiving any HTTP/JSON response. OpenSSL showed the server presenting the `*.hcmue.edu.vn` leaf without the DigiCert intermediate. A browser can have that intermediate cached, which explains why the school's site may work while Node fails.

The runner now includes the missing public intermediate, pinned to SHA-256 `C8:02:5F:9F:C6:5F:DF:C9:5B:3C:A8:CC:78:67:B9:A5:87:B5:27:79:73:95:79:17:46:3F:C8:13:D0:B6:25:A9`, verifies its signature against an existing Node trust root, and preserves strict certificate/hostname/expiry checks. Source: [official DigiCert CA download](https://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1-1.crt). No insecure TLS switch is used.

## Request/response shapes

| Endpoint | Request | Response body used by runner | Evidence |
| --- | --- | --- | --- |
| `POST /auth/login` | `{cccd, password}`, fixed `X-Device-Id` | Success: `{status:"success", token:string, user:object}`. Error: `{status:"error",message:string}`; email verification: `status:"email_not_verified"` or `requiresEmailVerification:true` | Current official sign-in bundle; live invalid synthetic account returned HTTP 400 and `Số CCCD không tồn tại`. The user then logged in successfully using the patched local runner; the existing session was retained and authenticated GETs were verified. |
| `GET /me/profile` | Bearer token, same device ID | `{success:true,data:{user:{cccd,email,isVerified,is_verified,email_verified_at,...},cccd:{ho_ten,anh_the,...}}}` | Current authenticated GET after the user logged in, plus prior HAR. Photo and email verification decoded successfully. An unauthenticated GET returns 401 `{status:"error",message:"Token khong hop le"}`. |
| `GET /ky-thi-mo/comming-exam` | `limit=1000&dia_diem_code=HCMUE&hasRegisterCode=0`, optional `ngay_thi` | `{success:true,message,data:Exam[],pagination:{page,limit,total,totalPages}}` | Live GET parsed 4 exams. `phi` is a numeric string; counts and `hasRegisterCode` are numbers. The API can still return ended registration windows with `trang_thai:"open"`; validate the actual time window before scheduling. |
| `GET /ky-thi-mo/{ma_cap_thi}/{ngay_mo_dang_ky}/cau-hoi-va-tra-loi` | Encode each path segment | `{success:true,message,open_exam:{ma_cap_thi,ngay_mo_dang_ky,hasRegisterCode:0},questions:[]}` or supported question array | Live GET, plus previous HAR. Questions are at the root, not inside `data`. |
| `GET /dang-ky-thi/check-registration` | Exact exam tuple in query | `{status:"success",data:{isRegistered:boolean,registration:null\|object}}` | Current authenticated GET for HSK 2/3/4/6, prior HAR and current official upcoming-exams bundle. |
| `GET /dang-ky-thi/check-schedule-conflict` | Exact exam tuple in query | `{status:"success",data:{hasConflict:boolean,conflictType:null\|string,conflict:null\|object}}` | Current authenticated GET for HSK 2/3/4/6, prior HAR and current official upcoming-exams bundle. |
| `POST /dang-ky-thi` | `{ma_cap_thi,ngay_mo_dang_ky,answers:[{ma_cau_hoi,noi_dung_tra_loi}]}`; independent candidates omit registerCode | Success `{status:"success",data:string}` or `ma_dang_ky`; queue `{status:"queued",jobId}`; business errors include `code` | Previous successful authorized registration and current official source. **Not submitted during this fix.** |
| `GET /dang-ky-thi/jobs/{jobId}` | Server-returned job ID only | `{data:{jobStatus:"completed"\|"failed"\|...,ma_dang_ky?,error?}}` | Current official upcoming-exams source. No fabricated job was queried. |

Do not assume every endpoint uses the same envelope: some use `success:boolean`; others use `status:string`; questions are a root array, while identity and registration state are nested under `data`.

The login client now distinguishes transport/certificate failures, a rejected CCCD/password, unverified email, malformed success without token, and an expired session. An incomplete profile may log in and show as needing completion; it cannot pass registration preparation. Never print token/password/identity payloads when diagnosing errors. Short school error messages are filtered before display.

Public source checked: [sign-in](https://hsk.hcmue.edu.vn/sign-in), `assets/index-xxpuTpoe.js`, `assets/sign-in-Bd0ln9m1.js`, `assets/upcoming-exams-DbqIYzm3.js`. Sanitized live response structures are saved locally under ignored `.local-data/hcmue-api-audit/`; they contain field types and no tokens or personal profile values.

## Verified after the real account logged in

The website showed “Đã đăng nhập và kiểm tra hồ sơ trên máy”, the account appeared in the table, and its current encrypted local session was used for read-only verification. Profile decoding, all four exam listings, and questions/registration/conflict for every returned HSK 2/3/4/6 exam passed. The website's Tải kỳ thi action also populated the exam selector. No new school registration POST, payment or cancellation was sent. Successful authentication does not mean these ended registration windows can be scheduled again.

Local regression results: 23 HCMUE tests in 5 files passed; the full working-tree suite passed 584 tests in 60 files; both TypeScript projects and the actual Keychain-backed runner smoke check passed. Six fresh HTTPS connections independently decoded the exam list. Private evidence contains only structure/types, not personal field values or tokens.
