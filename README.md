# Chia tiền ăn

A bill splitting app for Vietnamese Discord users. In fact, you can't use this app if you don't have a Discord account, and most features only work if you are in Vietnam.

Tech used:
- Frontend: PWA/SPA with SvelteKit/Svelte 5, shadcn, Tailwind
- Backend: Firebase for authentication, Supabase for database, Cloudflare Worker for backend logic

Discord OAuth is the only login method.

## Run locally

Install Node.js 24.12 or later in the 24.x line and Java 21 or later. Corepack uses the pnpm version pinned in `package.json`.

```powershell
corepack enable pnpm
pnpm i
pnpm dev
```

If pnpm reports a conflict with an existing npm install, close any editor or dev server using this checkout, run `pnpm clean`, then rerun `pnpm i`.

Open [the app](http://127.0.0.1:5173). The launcher starts Firebase Auth/Firestore emulators, seeds fictional data, runs the Worker locally with Wrangler, and starts Vite. No service account or Discord credentials are needed.

| Service                | Address               |
| ---------------------- | --------------------- |
| Frontend               | http://127.0.0.1:5173 |
| Worker API             | http://127.0.0.1:8787 |
| Firebase emulator UI   | http://127.0.0.1:4000 |
| Firestore emulator     | 127.0.0.1:8080        |
| Firebase Auth emulator | 127.0.0.1:9099        |

To reproduce a group's production data locally, export production data from **Dữ liệu & lưu trữ → Tải bản sao JSON**. Then run

```powershell
pnpm restore:local "C:\path\to\bill-splitting-backup.json"
```

This replaces all seven data collections for `groups/local` in the Firestore emulator.

## Verification

```powershell
pnpm check
pnpm check:worker
pnpm test
pnpm build
pnpm build:worker
# With pnpm dev running:
pnpm test:e2e
```

`build:worker` is a dry run and makes no deployment. Browser tests exercise local OAuth, single-use exchanges, role boundaries, inactive-member denial, group isolation, remembered selection and bill workflows. They use mock Discord only; live credentials and live OAuth require a configured environment.

To start the services separately, run `pnpm emulators`, then `pnpm seed:local`, then start `pnpm dev:worker` and `pnpm dev:web`.

