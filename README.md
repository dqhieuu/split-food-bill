# Chia tiền ăn

A Vietnamese group expense SPA using SvelteKit, Svelte 5, TypeScript, shadcn-svelte, Tailwind, Firebase Authentication/Firestore and a Cloudflare Worker. Code and documentation are English; UI is Vietnamese.

Discord is the only login method. Firebase user IDs are `discord_<Discord ID>`. Global administrators create groups linked to Discord servers. Group administrators activate imported members and manage group data. Global and group roles are independent.

No service has been deployed. No existing data migration is required or included.

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
| `/activity` | Ledger               | Bills, immutable ledger, CSV export and simulated receipt retries        |
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

Bills and ledger entries remain immutable. Ledger import accepts normalized CSV/JSON with existing group member IDs, stable entry IDs and explicit ISO dates. Unknown member IDs are rejected; Discord sync must add them first. Imports commit in chunks of 150 and safely skip identical IDs on retry. JSON backup restoration currently supports ledger entries only; XLSX ingestion and full backup restoration are not implemented.

The bill toggle sends Discord DM notifications to its participants after the bill is committed. Each message includes the bill, date, payer, personal share and total. Delivery results are persisted per recipient; organizers and group admins can retry failed deliveries without changing debt or resending successful notifications. Local mode simulates delivery; production uses the configured Discord bot. Email delivery is no longer part of the bill flow.

## Architecture and service setup

The frontend signs into Firebase with a custom token issued after Worker-side Discord OAuth. Requests to the Worker carry Firebase ID tokens. The Worker verifies tokens, reads live roles/membership, and accesses Firestore through a dedicated service account. Browser Firestore access is denied. Each group's seven collections sit under `groups/{groupId}`; global users live under `users/{userId}`.

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

Useful separate commands: `npm run emulators`, `npm run seed:local`, `npm run dev:worker`, `npm run dev:web`. When running them separately, seed after the emulators start, then start Worker and frontend. [Feature parity notes](docs/feature-parity.md) describe the spreadsheet workflows preserved by the app.
