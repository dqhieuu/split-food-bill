# Lunchroom / Chia tiền ăn

A Vietnamese single-page group expense app built with **SvelteKit 3, Svelte 5, TypeScript, shadcn-svelte (Nova), Tailwind 4, Firebase Authentication and Cloud Firestore**. Code, method names and documentation are English; UI and receipts are Vietnamese.

Branch: `feat/lunch-ledger-spa`. No deployment has been created.

## Local development

Install Node.js **22.17+** (22 or 24 LTS recommended), npm and Java **21+** on PATH.

```powershell
npm ci
npm run dev
```

Open [the app](http://127.0.0.1:5173). This launches real Firebase Auth and Firestore **emulators**, waits for readiness, then starts Vite. The first run downloads Firestore. No Firebase account, real database or service account is required. If port 5173 is occupied, use the URL printed by Vite.

| Service        | Address               |
| -------------- | --------------------- |
| Emulator UI    | http://127.0.0.1:4000 |
| Firestore      | 127.0.0.1:8080        |
| Authentication | 127.0.0.1:9099        |

The avatar menu switches demo accounts. **Minh An** is the administrator; the other initial active members are ordinary members. Demo names, emails, bank accounts and transaction history are fictional. Do not make real transfers to sample accounts.

Stop with Ctrl+C and allow export to finish. Emulators export to ignored `.emulator-data/` and import that snapshot on the next launch. Abrupt termination can lose changes since the last export. Each organizer's draft is stored separately in browser local storage and survives reload. The emulator is seeded only when `groups/local` is absent. The original spreadsheet is unchanged and has not been imported.

Run `npm run backup:local` while the emulator is running to explicitly save a local snapshot. `npm run emulators` starts only the emulator suite. Running `npm run dev:web` or `npm run preview` alone requires the emulator host variables from `.env.example` and a running emulator.

## Screens

| Route       | Vietnamese navigation | Purpose                                                                           |
| ----------- | --------------------- | --------------------------------------------------------------------------------- |
| `/`         | Tổng quan             | Group spending, personal summary, recent bills                                    |
| `/new-bill` | Ghi thanh toán        | Independent draft, participants, individual/equal splits, review, receipt option  |
| `/balances` | Số dư cá nhân         | Pairwise balances, charge history and QR payment confirmation                     |
| `/matrix`   | Ma trận nợ nần        | All/current-member matrix and admin hub reassignment                              |
| `/index`    | Tiền ăn index         | Daily net history, receivable distribution, cumulative/today repayments           |
| `/activity` | Ledger                | Filtered bills/ledger, CSV export, receipt preview and simulated retries          |
| `/members`  | Thành viên & quản lý  | Profiles/banks, inactive members, ledger import, JSON backup, archives, audit log |

## Financial rules

New amounts are positive integer **VND**. The composer explicitly selects VND or thousands of VND and converts existing values when units change. Equal splits allocate largest remainders so every đồng reconciles. There is no implicit less-than-1,000 conversion.

```text
amount A owes B = debt(A,B) - payment(A,B) - debt(B,A) + payment(B,A)
net position A = receivables A - payables A
```

The UI labels receivables as “Bạn đang lỗ” and payables as “Bạn đang lãi”; ledger calculations remain unchanged. The organizer's own meal stays in the bill total without creating self debt. Payments are recorded through QR confirmation. Payments offset a member pair, not a particular invoice. Recent charges are explicitly not labeled as unpaid invoices.

Inactive members remain in full-history balances by default. Matrix filters limit displayed pairs; index positions always use full history. Hub reassignment includes inactive members, preserves every member's net position, uses the most indebted member as the hub and skips self entries. Synthetic accounting entries are excluded from repayment metrics. This preserves the old hub strategy, not a claim of globally minimal bank transfers.

The QR dialog is stateless: generating, opening or closing it makes no database writes, starts no expiry timer and does not block reassignment. The recipient, bank details and amount shown are held only in the current dialog. Confirmation records that amount using the authenticated payer and an idempotency ID; retries cannot duplicate the payment, even if the ledger changed after scanning. VietQR payloads and images are generated locally with an EMV CRC, without sending bank details to an image service. Bank-app scanning has not been certified against real accounts. Self-confirmation is not bank verification.

## Backend

Authenticated SvelteKit endpoints verify Firebase emulator ID tokens, resolve the actor server-side, validate commands with Zod and enforce roles. Firestore transactions read a consistent snapshot, write only changed documents and update a group version. Direct browser Firestore access is denied by `firestore.rules`.

`groups/local` holds the version. Subcollections contain `members`, `ledger`, `bills`, `receipts`, `settlements`, `archives`, `audit` and `preferences`. Bill/payment IDs provide idempotency. Settlement previews require the current version. New bills freeze receipt content and participant names. No API edits or deletes committed ledger entries.

This is a local review implementation. Group snapshot reads scan collections for simplicity; production scale needs pagination and maintained balance projections. Shared state polls every 15 seconds and refreshes after own mutations. It is not a realtime listener.

The backend fails closed unless both Firebase emulator hosts point to `127.0.0.1`. It cannot silently connect to a real project. Demo account switching is intentionally part of this emulator-only implementation, not production authentication.

## Mocked external integrations

Email outbox records are committed with bills. Receipt previews escape user content and include the complete shared bill. Success, failure and retries are simulated and visibly labeled; they never repost debt. **No real email is sent.** No original Resend key was copied.

Archive links are stored as references and never automatically fetched/imported.

## Historical import

An administrator can use **Thành viên & quản lý → Dữ liệu & lưu trữ → Kiểm tra tệp nhập**. Accepts a JSON array, an exported app backup's `ledger` array, or UTF-8 CSV with English headers:

```csv
id,from,to,type,amount,date,description,note,legacySequence
legacy-1,former.member,an,debt,55000,2025-05-05T12:00:00+07:00,Team lunch,,1
legacy-2,former.member,an,payment,10000,2025-05-06T12:00:00+07:00,Repayment,,2
```

`type` accepts `debt`/`payment` or legacy `Nợ`/`Trả`. Amounts are integer VND without separators. Dates require ISO 8601 and an explicit timezone. IDs are stable strings with letters, numbers, dots, underscores or hyphens. Without `id`, a unique `sequence`/`legacySequence` produces `legacy-<sequence>`.

The complete file is parsed before import. Preview shows new/known IDs, zero/self rows and unknown people. Unknown IDs become inactive placeholder profiles. Legacy zero, negative and self entries are preserved. Existing identical IDs are skipped; conflicting contents stop the import. Writes commit in chunks of 150; earlier successful chunks remain if a later one fails. Retry the same file safely after correcting the conflict. Limits: 10,000 rows and 8 MB per file.

XLSX ingestion is not included; first normalize/export the ledger into this schema. JSON backup contains all app collections, but re-import currently restores **ledger history only**, not a full application backup. Reconciliation against the original 2,798 rows and 256 matrix cells still requires an authorized normalized export; it has not been run in this project.

## Validation

With the local app/emulators running:

```powershell
npm run check
npm test
npm run test:e2e
npm run build
```

Browser tests use installed Google Chrome headlessly. Unit tests cover bidirectional accounting, exact rounding, randomized settlement conservation, idempotency, permissions, stateless QR confirmation, intervening ledger changes and conflicting retries, imports, HTML escaping, frozen receipt names and QR CRCs. Browser/API tests exercise the real emulators, concurrent duplicate requests, drafts, receipts, repayments, routing and mobile layout.

Local builds use `adapter-node` because Windows can disallow directory symlinks required by `adapter-vercel`. When `VERCEL` is set by Vercel, the config selects the Vercel adapter (Node 22). The Vercel deployment bundle has not been validated on the target platform. No deployment or production Firebase configuration is active.

## Before production (separate future work)

- Replace local account switching with real Firebase sign-in, invitations and group membership authorization.
- Review production credentials/project selection and replace the emulator-only guards as part of that change.
- Add a real email delivery worker/provider with protected secrets and backoff. Rotate the spreadsheet's old exposed key separately.
- Verify intended bank profiles/QR compatibility and reconcile historical data.
- Add pagination, maintained projections, production monitoring and operational backups.

See [feature parity](docs/feature-parity.md) for the worksheet-to-app mapping.
