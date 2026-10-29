# Chia tiền ăn

A Vietnamese group expense SPA using SvelteKit, Svelte 5, TypeScript, shadcn-svelte, Tailwind, Firebase Authentication, Supabase Postgres and a Cloudflare Worker. Local development uses Firebase Auth/Firestore emulators. Code and documentation are English; UI is Vietnamese.

Discord is the only login method. Firebase user IDs are `discord_<Discord ID>`. Global administrators create groups linked to Discord servers. Group administrators activate imported members and manage group data. Global and group roles are independent.

Production data was migrated from Firestore to Supabase Postgres on October 28, 2026. See [the Supabase migration runbook](docs/supabase-migration.md) for configuration, the verified export/import and cutover record. Firebase Authentication and Cloudflare R2 remain in place; the original Firestore data has been preserved.

## Run locally

Install Node.js 24 LTS and Java 21+ on PATH. Use the pinned npm 11.19.1 for local installs and CI:

```powershell
npm install --global npm@11.19.1
npm ci
npm run dev
```

Open [the app](http://127.0.0.1:5173). The launcher starts Firebase Auth/Firestore emulators, seeds fictional data, runs the Worker locally with Wrangler, and starts Vite. No service account or Discord credentials are needed. Use `127.0.0.1` consistently rather than mixing it with `localhost`.

| Service                | Address               |
| ---------------------- | --------------------- |
| Frontend               | http://127.0.0.1:5173 |
| Worker API             | http://127.0.0.1:8787 |
| Firebase emulator UI   | http://127.0.0.1:4000 |
| Firestore emulator     | 127.0.0.1:8080        |
| Firebase Auth emulator | 127.0.0.1:9099        |

Click the Discord login button to open the **local mock account picker**. Minh An is the seeded global/group admin. Other members start inactive; activate them in member management before signing in as them. All Discord data and DMs are simulated in local mode. Sample bank details and transactions are fictional.

The local seed uses Discord-prefixed IDs directly. It replaces an old, uninitialized local fixture rather than migrating it, and skips an already initialized Discord fixture. Ctrl+C exports emulator data to ignored `.emulator-data/`; the next run imports it. `npm run backup:local` explicitly exports a running emulator. Browser drafts are scoped to both group and user.

## Screens

| Route       | Navigation           | Purpose                                                                  |
| ----------- | -------------------- | ------------------------------------------------------------------------ |
| `/`         | Tổng quan            | Spending calendar/chart, recent bills and personal payment history       |
| `/new-bill` | Tạo hoá đơn          | Participants, itemized/equal splits, rounding, review and receipt option |
| `/balances` | Số dư cá nhân        | Pairwise balances, recent charges and QR payment confirmation            |
| `/matrix`   | Ma trận nợ nần       | Signed debt matrix and administrator hub reassignment                    |
| `/activity` | Ledger               | Bills, immutable ledger and CSV export                                   |
| `/members`  | Thành viên & quản lý | Profiles/banks, activation, Discord sync, import, backup and audit       |
| `/groups`   | Nhóm                 | Active group selection and global-administrator group creation           |

Members can edit their own group profile and bank details. Group admins can edit other members and change their activation/role. IDs always come from Discord. The last selected active group is remembered across logins.

## Financial behavior

Amounts are integer VND. Inputs reject negative signs and scientific notation. The composer supports VND/thousands of VND, itemized/equal splits, and rounding up each portion to 1,000 by default. Bill dates and creation timestamps are separate; the UI uses Vietnam time.

```text
amount A owes B = debt(A,B) - payment(A,B) - debt(B,A) + payment(B,A)
net position A = receivables A - payables A
UI profit/loss = payables A - receivables A
```

The organizer's own meal does not create self debt. Payments offset a member pair rather than an invoice. QR generation is stateless and local; only confirmation creates an idempotent payment. It does not verify a bank transfer. Admin hub reassignment preserves every member's net position, including historical inactive members.

On Android and iOS, tapping a payment QR opens a VietQR bank-app link chosen from the signed-in member's saved bank (including when an admin views another member's balance). Recipient details, amount and payment reference match the displayed QR. The local app directory covers the [full VietQR list](https://www.vietqr.io/deeplink/bank-apps), with platform-specific app variants and autofill support as of 2026-10-29. Apps without autofill are labelled accordingly; desktop, missing-bank and unsupported-bank cases retain the normal QR. Links are constructed locally and disclose the transfer details to `dl.vietqr.io` only when tapped. The provider opens in a new tab so the original confirmation dialog stays available. Returning from a bank app never confirms a payment automatically.

Bills and ledger entries remain immutable. Ledger import accepts normalized CSV/JSON with existing group member IDs, stable entry IDs and explicit ISO dates. Unknown member IDs are rejected; Discord sync must add them first. Imports commit in chunks of 150 and safely skip identical IDs on retry. JSON backup restoration currently supports ledger entries only; XLSX ingestion and full backup restoration are not implemented.

The bill toggle sends Discord DM notifications to its participants after the bill is committed. Rich Discord embeds show the group, optional receipt photo, bill/date, personal share and meal, other participants, total and a repayment link. The confirmation dialog includes a per-recipient Discord preview. Delivery results are persisted per recipient for backend diagnostics; bill details do not display notification status. The retry API skips successful deliveries without changing debt. Local mode simulates delivery; production uses the configured Discord bot. Email delivery is no longer part of the bill flow.

## Architecture and service setup

The frontend signs into Firebase with a custom token issued after Worker-side Discord OAuth. Requests to the Worker carry Firebase ID tokens. The Worker verifies tokens, reads live roles/membership, and accesses Supabase Postgres through a verified Hyperdrive connection. Browser database access is denied. Each group's seven collections use paths under `groups/{groupId}`; global users use `users/{userId}`. Supabase stores the same paths and exact objects in a private Postgres schema. The Firestore adapter remains available for local emulators and controlled migration recovery.

See [integration and deployment setup](docs/integrations.md) for the schema diagram, endpoint permissions, Discord application setup, Firebase IAM/rules, Worker secrets, Vercel configuration and automatic deployment instructions. The deployment workflow stays disabled until explicitly enabled in repository settings.

State loads currently scan group collections and poll every 15 seconds. This is suitable for the internal review app; larger datasets should use projections and pagination. Group creation/sync currently accept up to 200 Discord members per server and reject larger servers without truncating them.

## Verification

```powershell
npm run check
npm run check:worker
npm test
npm run build
npm run build:worker
# With npm run dev running:
npm run test:e2e
```

`build:worker` is a dry run and makes no deployment. Browser tests exercise local OAuth, single-use exchanges, role boundaries, inactive-member denial, group isolation, remembered selection and bill workflows. They use mock Discord only; live credentials and live OAuth require a configured environment.

Useful separate commands: `npm run emulators`, `npm run seed:local`, `npm run dev:worker`, `npm run dev:web`. When running them separately, seed after the emulators start, then start Worker and frontend.

Discord member previews and group member management include explicit refresh buttons that bypass the member cache. System admins can reset the configured app database from group management after typing the confirmation phrase. See [database reset](docs/integrations.md#database-reset) for scope and recovery.
