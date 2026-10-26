# Authentication, groups and service setup

The repository contains both the SvelteKit frontend and Cloudflare Worker backend. Vercel hosts the frontend, Firebase provides Authentication and Firestore, and Cloudflare runs OAuth, authorization, financial commands and Discord REST integrations. Deployment has not been performed. There is no data migration because this app has not been published.

## Request and login flow

```mermaid
sequenceDiagram
    participant B as Browser / Vercel SPA
    participant W as Cloudflare Worker
    participant D as Discord
    participant A as Firebase Authentication
    participant F as Firestore
    B->>W: Start Discord login with handoff challenge
    W->>D: OAuth authorize (identify, email)
    D->>W: Authorization code + state callback
    W->>D: Exchange code, read Discord profile
    W->>F: Upsert users/discord_<id>
    W-->>B: Redirect with one-use handoff code
    B->>W: Exchange code + verifier
    W-->>B: Firebase custom token
    B->>A: signInWithCustomToken
    A-->>B: Firebase ID token
    B->>W: API request + Bearer ID token
    W->>W: Verify token signature, audience, issuer and expiry
    W->>F: Check global role / active group membership
    W->>F: Authorized reads / atomic domain command
    W-->>B: Group state or command result
```

Firebase custom authentication lets the Worker use Discord as the identity provider while keeping Firebase sessions. The browser sends Firebase **ID tokens**, not custom tokens, to protected APIs. See [Firebase custom authentication](https://firebase.google.com/docs/auth/admin/create-custom-tokens) and [ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

The provider OAuth flow uses a confidential client, fixed callback, random state, HttpOnly state cookie and single-use server state. A separate challenge/verifier protects the browser handoff: its code expires after 60 seconds, is consumed once, and is removed from the URL before exchange. OAuth state expires after ten minutes. Custom tokens expire after five minutes. Names, avatars and optional email are profile data; only the Discord snowflake determines identity. The Firebase UID and document ID are both `discord_<snowflake>`.

Production accepts only signed Firebase ID tokens for the configured project. Local mode validates against the Auth emulator and is restricted to loopback hosts and the demo project. Password login, anonymous login, and the previous demo-session API are absent.

## Data model

```mermaid
erDiagram
    USERS ||--o{ MEMBERS : "id = member document id"
    USERS ||--o{ GROUPS : creates
    USERS }o--o| GROUPS : lastActiveGroupId
    GROUPS ||--|{ MEMBERS : contains
    GROUPS ||--o{ BILLS : contains
    GROUPS ||--o{ LEDGER : contains
    GROUPS ||--o{ RECEIPTS : contains
    GROUPS ||--o{ SETTLEMENTS : contains
    GROUPS ||--o{ ARCHIVES : contains
    GROUPS ||--o{ AUDIT : contains
    GROUPS ||--|| DISCORD_GUILDS : unique_server
    MEMBERS ||--o{ BILLS : organizer
    MEMBERS ||--o{ LEDGER : "from / to / creator"
    BILLS ||--o{ RECEIPTS : billId
    USERS {
        string id PK
        string discordId
        string role "global admin or member"
        string name
        string username
        string avatarUrl
        string email
        string lastActiveGroupId FK
        string createdAt
        string updatedAt
    }
    GROUPS {
        string id PK
        string name
        string discordGuildId UK
        string createdBy FK
        string createdAt
        number version
    }
    MEMBERS {
        string id PK "same global user id"
        string name
        string email
        boolean active
        string role "group admin or member"
        string avatarUrl
        string bankCode
        string bankLabel "optional free text"
        string bankAccount
        string color
    }
```

| Path                                | Purpose / remaining fields                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{discord_userId}`            | Global identity/profile/role and last selected group, as above                                                                                                                      |
| `groups/{groupId}`                  | Server association and financial version, as above                                                                                                                                  |
| `discordGuilds/{guildId}`           | `guildId`, `groupId`; transactional uniqueness index                                                                                                                                |
| `groups/{groupId}/members/{userId}` | Group profile, role, activation and bank details                                                                                                                                    |
| `groups/{groupId}/bills/{id}`       | `id`, `organizer`, `description`, `date`, `createdAt`, `lines[]`, `total`, `discordNotification`, optional `memberNames`; each line has `memberId`, `amount`, `description`, `note` |
| `groups/{groupId}/ledger/{id}`      | `id`, `from`, `to`, `type`, `amount`, `date`, `createdAt`, `description`, `note`, `creator`, `source`, `reference`, optional `legacySequence`                                       |
| `groups/{groupId}/receipts/{id}`    | `id`, `billId`, `status`, `recipients[]` (Discord user IDs), `deliveries[]` (`memberId`, `status`, `error`), `attempts`, `error`, `createdAt`; Discord notification outbox          |
| `groups/{groupId}/settlements/{id}` | `id`, `hub`, `date`, `creator`, `version`, `entryCount`                                                                                                                             |
| `groups/{groupId}/archives/{id}`    | `id`, `name`, `url`, `date`                                                                                                                                                         |
| `groups/{groupId}/audit/{id}`       | `id`, `actor`, `action`, `date`, `reference`                                                                                                                                        |

The group is represented by the Firestore path, not a redundant `groupId` field in each child record. Member IDs repeat across groups, while bank details and display names can differ per group. Amounts are integer VND; dates are ISO strings. `bankCode` resolves a bank BIN for QR generation and `color` is an internal avatar fallback; neither has a dedicated configuration control. Removed fields such as `bankName` and department are absent.

Cloudflare Durable Object storage holds short-lived OAuth states, one-use handoffs, DM deduplication IDs and rate-limit slots. These are backend internals rather than Firestore business collections. The Wrangler `migrations` declaration creates the Durable Object SQLite class; it is platform resource provisioning, not a migration of app data.

## Roles and membership

- A **global admin** may list the bot's servers, inspect their members and create a group. A global admin does not bypass inactive group membership.
- A **group admin** must be active. They manage activation/roles/profiles, sync members, retry bill notifications, import history and simplify debt. Group admin status does not grant group-creation privileges.
- An **active group member** may access the group's state, create bills, confirm their own QR payments and update their own group profile. The backend determines the actor from the token.
- Imported members always start inactive with group role `member`. The creator is the bootstrap exception: active group admin, allowing them to activate everyone else. Self-deactivation/demotion is blocked by the current management command.
- Inactive members cannot read or mutate group state, even if their financial records remain for history. The last selected group is persisted in the global user document. Login falls back to another active group if access to the remembered group was removed.

`DISCORD_ADMIN_IDS` bootstraps specific numeric Discord IDs into global admin status on login/import. Other new users default to `member`. Existing global roles are preserved, so removing an ID from the allowlist does not itself demote an existing admin: also change that user's global `role` in trusted Firestore administration. There is no client API for editing global roles.

## Local development

```powershell
npm ci
npm run dev
```

Prerequisites: Node.js 24 LTS and Java 21+. The local launcher runs Firebase emulators for `demo-lunchroom`, seeds a fresh Discord-based fixture when needed, starts Wrangler on `127.0.0.1:8787`, and starts Vite on `127.0.0.1:5173`. The first Firebase run may download emulator binaries. Use the login button and pick one of the mock Discord accounts.

The repository pins Node.js 24 through `.node-version` and npm 11.19.1 through `packageManager` in `package.json`. Cloudflare Workers Builds reads these files to select its toolchain; the GitHub workflow also installs the pinned npm explicitly. Use `npm install --global npm@11.19.1` if your local npm differs. npm 10 resolves optional SvelteKit peer dependencies differently and can reject this npm 11 lockfile as out of sync. Keep the pinned npm version when updating dependencies and commit `package.json` and `package-lock.json` together. See [Cloudflare build image configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

The seeded Minh An (`discord_100000000000000001`) is the global admin and local group's active admin. The other users are inactive. Activate Thảo Linh or Quang Huy in member management before testing their group access. A second mock server is available for testing group creation. No real OAuth, Discord API calls or DMs occur in local mode, even if credentials exist in the shell.

Local configuration is committed under `env.local` in `wrangler.jsonc`. The frontend defaults to the local Worker URL during development, so no frontend environment file is needed. Set `VITE_WORKER_API_URL` in Vercel for production as described below. Local database/auth hosts cannot point at production. Emulator snapshots and Wrangler storage are ignored by Git.

Separate processes, if desired:

```powershell
npm run emulators
# In another terminal, after emulator startup:
npm run seed:local
npm run dev:worker
# In a third terminal:
npm run dev:web
```

## Connect Discord

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Record its application/client ID and generate an OAuth client secret.
2. Create/configure its bot and obtain a bot token. Under Bot → Privileged Gateway Intents, enable **Server Members Intent** (`GUILD_MEMBERS`); approval may be required for eligible verified apps. Listing guild members requires this intent even though this app uses REST rather than a persistent Gateway connection. See [List Guild Members](https://docs.discord.com/developers/resources/guild#list-guild-members).
3. Install the bot into the intended server with the `bot` scope. The bot needs access to the server member list and permission to send DMs to the recipients. No Administrator or Message Content intent is required by this implementation. Recipient privacy settings may still prevent DMs.
4. Under OAuth2, add exactly `https://YOUR-WORKER-HOST/auth/callback` as a redirect URI. The Worker requests user scopes `identify email`; it never uses email as identity. See [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).
5. Enable Discord Developer Mode and copy the intended administrators' numeric user IDs. Set them in `DISCORD_ADMIN_IDS` as a comma-separated list. Optionally restrict server discovery with comma-separated `DISCORD_GUILD_IDS`.

Groups link to a Discord server (called a guild in the API). Server discovery lists servers the bot has joined, optionally restricted by `DISCORD_GUILD_IDS`. Member sync paginates that server’s member list and excludes bots and incomplete memberships. Channel visibility and channel-specific overwrites do not determine group membership.

Synchronization adds missing users and inactive memberships. Existing names/bank details, activation and group roles are retained. Users who leave Discord are retained for history and must be deactivated by a group admin; sync is not automatic revocation. Creation/sync currently reject servers over 200 non-bot members instead of truncating them. Large servers may also need increased Worker request budgets and a background sync design.

## Connect Firebase

1. Create a Firebase project and register a web app. Create the **default Firestore database**, selecting the intended location.
2. Initialize Firebase Authentication. Keep other sign-in providers, including Email/Password and Anonymous, disabled for Discord-only access. Custom-token sign-in is implemented by the Worker; no Discord provider toggle or Identity Platform OIDC provider is needed. Add your frontend/custom domain under Authentication → Settings → Authorized domains where applicable.
3. Copy the web app's `projectId`, `apiKey` and `authDomain` into the production Worker variables listed below. These public web configuration values are returned by `/config`; they are not service-account credentials.
4. Create a dedicated Google service account with **Cloud Datastore User** (`roles/datastore.user`) on this project. Generate a JSON key and securely supply its `client_email` and `private_key` to Worker secrets. Enable the Cloud Firestore API if needed. The Worker signs custom tokens and Google service-account assertions locally with this key, so it does not need a separate IAM `signBlob` grant.
5. Publish this repository's deny-all client rules, explicitly selecting the real project:

```powershell
npx firebase login
npx firebase deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

Do not change the launcher's demo project into a production project. There are no browser Firestore reads or writes: all data goes through the Worker, whose Google OAuth service-account requests use IAM authorization. Consequently the Worker enforces every group/role boundary; client security rules do not restrict service-account access. See [Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api).

## Configure Cloudflare

Edit the top-level production `vars` in `wrangler.jsonc`; retain the separate local environment:

| Variable               | Production value                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `APP_ENV`              | `production`                                                                         |
| `FRONTEND_ORIGIN`      | Exact HTTPS frontend origin, e.g. `https://food.example.com`, with no trailing slash |
| `FIREBASE_PROJECT_ID`  | Real Firebase project ID                                                             |
| `FIREBASE_API_KEY`     | Public Firebase web API key                                                          |
| `FIREBASE_AUTH_DOMAIN` | Usually `<project>.firebaseapp.com`                                                  |

Remove all placeholder values. Production refuses emulator flags, demo project IDs and placeholder frontend URLs. Configure the Worker name/account for your Cloudflare account. The Worker uses the `AUTH_SESSIONS` SQLite Durable Object binding already declared in Wrangler.

`workers_dev: true` explicitly enables the Worker's public `workers.dev` address on deployment. If Cloudflare shows “No URLs enabled” for an existing Worker, open Workers & Pages → your Worker → Settings → Domains & Routes and enable its `workers.dev` route. If the account has no Workers subdomain yet, set one on the Workers & Pages overview. Copy the resulting stable Worker URL and append `/auth/callback` for Discord's OAuth redirect. See [Cloudflare workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Authenticate the CLI without deploying:

```powershell
npx wrangler login
```

Prepare `.dev.vars.production.json` locally with these keys: `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_ADMIN_IDS`, and optional `DISCORD_GUILD_IDS`. This filename is ignored by the repository's `.dev.vars.*` rule. Copy `client_email` and `private_key` from the downloaded service-account JSON. The private key accepts PEM newlines or escaped `\n` characters; use a JSON serializer when copying a multiline key. Admin/server ID values are comma-separated numeric Discord IDs.

Keep service-account JSON, OAuth secrets and bot tokens out of Git and frontend environment variables. Do not use `wrangler secret put` as a preparation-only command: it creates and immediately deploys a Worker version. The deployment below uploads secrets and code together. See [Cloudflare secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

Check the bundle without deploying:

```powershell
npm run check:worker
npm run build:worker
```

After reviewing the app and completing configuration, deploy the top-level production environment with code and secrets together:

```powershell
npm run deploy:worker -- --secrets-file .dev.vars.production.json
```

It deploys the API and provisions its declared Durable Object class. Set Discord's callback to the resulting stable Worker hostname. A successful production `/health` confirms required configuration is present; it does not test every external permission or credential. Validate real OAuth, a small server sync and a bill notification in a staging environment before general use. Future `npm run deploy:worker` calls preserve remote secrets; use `wrangler secret put` when deliberately rotating a remote secret.

## Connect Vercel

1. Import this Git repository into Vercel. Use the repository root and SvelteKit framework detection, `npm ci` for installation and `npm run build` for building. Leave output directory detection to the adapter. The Vite configuration selects the Vercel adapter when `VERCEL` is set.
2. Set production `VITE_WORKER_API_URL=https://YOUR-WORKER-HOST`. Optionally set `VITE_APP_ENV=production` explicitly. Vite variables are embedded at build time, so redeploy after changes. The adapter currently targets Node.js 22 functions; use a compatible Vercel Node setting.
3. Set the chosen frontend domain as the Worker's exact `FRONTEND_ORIGIN`. The Worker allows this origin rather than arbitrary preview domains.
4. Keep Firebase service-account, Discord client secret and bot token exclusively on Cloudflare. Vercel only needs the public backend URL for this architecture.

Use a separate staging Worker/Firebase project and configured staging origin for previews requiring login; do not broaden production CORS to every preview hostname. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

## Automatic Worker deployment from this repository

`.github/workflows/deploy-worker.yml` uses the official Wrangler GitHub Action. It runs Worker type checks and unit tests, then deploys on relevant pushes to `master` or manual dispatch. It is **disabled by default** using the repository variable gate.

After reviewing the implementation and configuring production:

1. Configure the production values in `wrangler.jsonc` and perform the initial deployment with the secrets file above.
2. In GitHub repository settings, add secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Use a token authorized to edit Workers in the intended Cloudflare account, including the declared Durable Object binding.
3. Configure the GitHub `production` environment if using environment-level secrets or review rules.
4. Set repository variable `CLOUDFLARE_DEPLOY_ENABLED` to `true` only when automatic deployment is wanted. Push to `master` or manually dispatch the workflow. Application secrets remain in Cloudflare and are not copied into build artifacts.

Vercel's Git integration can independently build the frontend on pushes. Worker CI does not deploy Firestore rules; publish those explicitly as shown above. See [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## API permissions

All `/api/*` routes require `Authorization: Bearer <Firebase ID token>`. Inputs use backend validation; an actor supplied in JSON does not override the authenticated UID.

| Method / path                                                    | Access                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /health`, `GET /config`                                     | Public configuration/health                                               |
| `GET /auth/discord`, `GET /auth/callback`, `POST /auth/exchange` | OAuth flow; state/handoff constraints apply                               |
| `GET/POST /auth/mock`                                            | Loopback local environment only                                           |
| `GET /api/session`                                               | Signed-in global user; returns active groups and selection                |
| `POST /api/groups`                                               | Global admin; body `{name, discordGuildId}`                               |
| `POST /api/groups/{id}/select`                                   | Active group member; remembers selection                                  |
| `GET /api/groups/{id}/state`                                     | Active group member                                                       |
| `POST /api/groups/{id}/commands/{command}`                       | Active membership plus command-specific group role                        |
| `GET /api/discord/guilds`                                        | Global admin                                                              |
| `GET /api/discord/guilds/{guildId}/members`                      | Global admin, or active group admin with matching `?groupId=`             |
| `POST /api/discord/dm`                                           | Bill organizer or active group admin; recipients come from the saved bill |

Bill notification retry body:

```json
{
	"groupId": "GROUP_ID",
	"billId": "BILL_ID"
}
```

Logging a bill with `discordNotification: true` creates a notification outbox atomically with the bill and debt entries, then dispatches its DMs after the financial transaction commits. Recipients are the saved bill's participants, including the payer when they have a meal line. The backend constructs personalized Vietnamese content from the frozen bill; callers cannot supply arbitrary messages or recipient IDs. The toggle defaults on and opt-out creates no outbox.

Per-recipient status is `queued`, `sending`, `sent`, `simulated` (local only), or `failed`. The bill detail shows these results. Organizers and group admins can retry failed notifications through this endpoint or `retryBillNotification`; retries skip successful deliveries. A Firestore claim prevents concurrent/repeated bill requests from resending completed notifications. Discord requests use stable per-bill/recipient nonces with `enforce_nonce`, providing Discord's additional short-window duplicate suppression. See [Create Message](https://docs.discord.com/developers/resources/message#create-message).

DM failures never roll back a committed bill or post additional debt. Recipient privacy settings, bot permissions or rate limits can prevent delivery. Results are saved per recipient; interrupted requests may leave a `sending` status requiring operator inspection, rather than an automatic retry with an uncertain outcome. Delivery is currently processed within the request with up to four sends in parallel, not a background delivery queue. Larger recipient lists can exceed a Worker plan's subrequest budget; use a suitable plan or add a queue before scaling. No real DMs are sent in local mode.

## Verification and current limits

```powershell
npm run check
npm run check:worker
npm test
npm run build
npm run build:worker
# Requires the local development stack:
npm run test:e2e
```

Unit and local browser tests cover identity/permission rules, OAuth replay rejection, unauthorized origins, inactive access denial, global/group role separation, independent group state, last group selection and bill/payment workflows. Local tests do not establish that real Firebase IAM, Discord intent approval or live bank scanning are configured. Production credentials were not available and nothing has been deployed.

On Windows, forcing the Vercel adapter locally with `VERCEL=1` can fail while creating route symlinks (`EPERM`) when the OS account lacks symbolic-link privileges. The default local Node-adapter build does not require these links. The frontend compilation was checked locally; final Vercel adapter packaging still needs verification in Vercel's Linux build environment.

Group snapshots currently scan all seven collections and refresh by polling every 15 seconds. Transactions reject more than 450 changed documents. Discord creation/sync is bounded to 200 server members. Group discovery currently scans groups server-side to find active memberships. Larger installations should add indexed membership discovery, paginated/projection reads and background jobs. Bill notifications use Discord DMs in production and simulated Discord delivery locally; email receipts have been removed.
