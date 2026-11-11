# Supabase database migration

Keep Firebase Authentication and the current Discord login flow. Move Firestore business records to Supabase Postgres. Keep receipt images in Cloudflare R2 and OAuth/rate-limit state in the existing Cloudflare Durable Object.

Production uses [Supabase project ddqukbyrnkskahljtojf](https://supabase.com/dashboard/project/ddqukbyrnkskahljtojf), with `DATABASE_PROVIDER=supabase` and maintenance disabled. Local development explicitly uses the Firestore/Auth emulators. The original production Firestore database has been preserved. An empty target must never be used as the production database.

## Storage and authorization

`app_data.documents` stores each existing document's exact path and JSON object. Its primary key is the complete path, so identical member/bill IDs in different groups remain separate. A generated collection column and index support collection reads. This first migration preserves the current domain model, integer amounts, dates, immutable ledger entries, undo records, preferences, receipt delivery state, audit history, archives, Discord server indexes and private AI settings without rebuilding them. It does not convert Firebase UIDs into Supabase Auth UUIDs.

The schema is private, has row-level security enabled and grants no access to PUBLIC, anon or authenticated browser roles. The browser continues sending Firebase ID tokens to the Worker. The Worker verifies the token and reads current group membership/roles before database access. There is no direct browser access, Supabase Auth integration or Supabase service-role key in the frontend.

The Worker uses the `SUPABASE_DB` Hyperdrive binding. Hyperdrive connects to Supabase with `verify-full` and the Supabase CA certificate. Query caching is disabled so payment state and membership revocations are read live. The connection limit is five. Each request owns and closes its small pg pool. Financial transactions use PostgreSQL `SERIALIZABLE` isolation and retry serialization/deadlock conflicts; callback errors and create-only conflicts roll back the entire operation.

The migration CLI connects directly using verified TLS. Its bundled public Supabase CA expires in April 2031 and can be overridden with `SUPABASE_DB_CA` if the project's CA changes. Cloudflare's direct socket driver cannot use this custom CA, so production must use Hyperdrive rather than the direct connection string.

Supabase advertises unlimited API requests, but storage, egress and compute still have plan limits. Hyperdrive's Workers Free allowance is **100,000 SQL statements/day**; Workers Paid includes unlimited Hyperdrive queries. A statement can return many documents, so it is not equivalent to Firestore's per-document quota. The existing Worker request limits still apply. See [Supabase pricing](https://supabase.com/pricing) and [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/).

## Configuration

The ignored `.dev.vars.production.json` contains `SUPABASE_DATABASE_URL` alongside the existing Firebase service-account and Discord secrets. It must be a PostgreSQL URI, not the HTTPS project URL. Copy the URI from the project's Connect dialog and replace the password placeholder. Percent-encode special characters in credentials. For migration, use the direct connection if reachable or the Session pooler URI.

```json
{
	"SUPABASE_DATABASE_URL": "postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres"
}
```

Do not replace the existing file with just this example: Firebase's service-account key is still needed to issue custom Auth tokens. The database URL is needed by the migration CLI; the deployed Worker uses the Hyperdrive binding instead.

The current Hyperdrive resource is `e844f7d050434a9982b5e220073971b7`, named `split-food-bill-supabase`; its public CA resource is `29db96bc-923f-4f45-a7d6-19ad753a0baf`. The production binding is declared in `wrangler.jsonc`. Named local development does not inherit it and remains on the loopback Firestore/Auth emulators. Never add the remote binding to the local mock environment.

```powershell
pnpm migrate:supabase check
pnpm migrate:supabase schema
```

`check` only connects and checks schema availability. `schema` creates the private schema and table without dropping or replacing existing data.

## Export, import and verification

Use a new ignored snapshot filename for each export:

```powershell
pnpm migrate:supabase export --snapshot artifacts/migration/firestore-final.json
pnpm migrate:supabase import --snapshot artifacts/migration/firestore-final.json
pnpm migrate:supabase verify --snapshot artifacts/migration/firestore-final.json
```

The source defaults to Firebase project `split-food-bill`; use `--project` for another project. `--secrets` selects another ignored secrets file. Local testing requires `--mode local`, the demo project and loopback emulator/database endpoints.

Export traverses every root collection and nested subcollection, including descendants whose parent document is missing. All reads use one Firestore `readTime`, producing a consistent snapshot. It never modifies the source and never overwrites an existing backup file. Unsupported Firestore-only field types and unsafe integers abort instead of silently converting values. The snapshot includes a SHA-256 checksum of canonical paths and data; backups contain private app data and must remain outside Git.

Import validates the snapshot and checksum before writing. The complete copy is one PostgreSQL transaction. The target must be empty or contain only identical records from that snapshot. Conflicting or unexpected records abort without overwriting or deleting anything. Retrying an identical import is safe. Verification compares every path and every JSON field, the total record count and the full checksum. This is stronger than comparing balance totals alone.

## Production cutover

1. Confirm source reads are available, both authentication configurations still work and all checks below pass. If Firestore returns `429 RESOURCE_EXHAUSTED`, wait for quota to reset or have the project owner enable appropriate billing; an empty export is not a substitute for the existing data.
2. Record the current Worker deployment and database provider. Deploy `DATABASE_MAINTENANCE=true` while still using Firestore. The maintenance gate rejects OAuth, protected API traffic and the database-reset endpoint; health/config stay available. Wait for earlier API/notification work to finish. Keep direct Firestore administrative writers stopped too.
3. Export the final frozen snapshot to a new filename. Import it into the empty target and require exact verification. Re-export the still-frozen source to another filename and compare checksums to confirm it has not changed during the transfer.
4. Set `DATABASE_PROVIDER=supabase` and keep `DATABASE_MAINTENANCE=true` for deployment. Keep Firebase Auth settings/service-account secrets, Durable Objects and R2 bindings. Do not deploy a configuration that resets global/group roles or creates a new Firebase project.
5. After the verified copy and deployment are ready, remove maintenance mode, then check Discord sign-in, group selection, balances, bill details/images and ledger/history. Check unauthorized/inactive group access remains denied. Verify a controlled bill/payment/undo workflow in a test group before accepting normal writes.
6. Preserve the source Firestore database and frozen snapshot. Retire Firestore access only after the new deployment is stable. Once Supabase has accepted new writes, simply switching the provider back would lose those changes; freeze writes and reconcile/reverse-migrate first.

Do not enable automatic deployment of a Supabase provider change before the data is verified. Both adapters remain available, but all production traffic must use one database at a time.

## Verification

```powershell
pnpm check
pnpm check:worker
pnpm test
pnpm build:worker
```

The integration suite requires a disposable local PostgreSQL database ending in `_test`. It truncates only `app_data.documents` in that test database:

```powershell
$env:LOCAL_DATABASE_TEST_URL = 'postgresql://postgres:local-migration-tests-only@127.0.0.1:54329/lunchroom_test'
pnpm test:supabase
```

Tests cover preservation of nested fields and amounts, group/collection isolation, serializable concurrency and retries, all-or-nothing writes, create-only conflicts, orphan traversal and pagination, live membership enforcement, idempotent already-paid bills, private-schema permissions, exact import/retry verification, conflict refusal and backup tamper detection.

## Completed migration, October 28, 2026

Production was switched to Supabase after pausing API writes, exporting a consistent Firestore snapshot, importing all 354 records atomically, and comparing every path and JSON field. A second frozen Firestore export had the same checksum, confirming the source did not change during the copy. Maintenance mode was removed after deploying the Supabase provider.

The verified snapshot contains 66 global users, one group, 66 group members, 19 bills, 147 ledger entries, 51 audit entries, two notification receipts, one Discord server index and one private AI-settings record. Its SHA-256 checksum is `41b087a838bede12fdf6e460b0086ba4e9b5ab473098b043e45cb083ec46562c`.

The live Worker passed Firebase custom-token authentication and returned group metadata and all seven group collections matching the snapshot. All 66 member net/pair balances matched; all 19 existing receipt images loaded from R2. Requests without authentication returned 401, and requests for a group without membership returned 403.

The current production version is `7a51dd72-54ca-42b2-b44b-700de3238c5a`, serving [the Worker API](https://split-food-bill.daohieu61.workers.dev/health). Firebase Auth, existing user IDs, Durable Objects and R2 were retained. The original Firestore database was not deleted or modified by the migration.

The ignored `artifacts/migration/` directory contains the final snapshot, an independent frozen source recheck, the deployment/checksum journal and the read-only production verification script. The original pre-migration Worker version was `04257faa-c60f-47d4-890a-2960280c3690`; do not roll back to its Firestore provider after new Supabase writes without reconciling those changes first.
