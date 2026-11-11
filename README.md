# Chia tiền ăn

A bill splitting app for Vietnamese Discord users. In fact, you can't use this app if you don't have a Discord account, and most features only work if you are in Vietnam.

Tech used:
- Frontend: PWA/SPA with SvelteKit/Svelte 5, shadcn, Tailwind
- Backend: Firebase for authentication, Supabase for database, Cloudflare Worker for backend logic

Discord OAuth is the only login method.

## Run locally

```powershell
npm install
npm run dev
```

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
npm run restore:local -- "C:\path\to\bill-splitting-backup.json"
```

This replaces all seven data collections for `groups/local` in the Firestore emulator.

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

