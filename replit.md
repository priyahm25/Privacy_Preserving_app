# SecureSphere

A privacy-preserving collaboration vault: you pick a file from your device, an AI layer checks it for spam and malicious content, and only a clean file gets encrypted and stored — then shared with teammates you invited by email.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/securesphere run dev` — run the Expo app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Environment files

There are **two**, and the split is a security boundary, not a convention:

| File | Read by | Contents |
|---|---|---|
| `.env` (repo root) | API server, drizzle-kit | Server secrets: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY` (`sk_`), SMTP |
| `artifacts/securesphere/.env` | Expo | Only `EXPO_PUBLIC_*` — bundled into the app, so readable by anyone who installs it |

Copy each from the `.env.example` beside it. Both are gitignored; the `.env.example` files are committed, so never put real values in those.

Loading is via Node's native `--env-file-if-exists`, wired into the `start` and `push` scripts — there is no `dotenv` dependency. On Replit the file is absent and Replit Secrets supply the same variables, which is why the flag is the "if-exists" variant.

Minimum to boot: `DATABASE_URL`, `CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile app: Expo / React Native (Expo Router), Clerk auth
- API: Express 5
- DB: Supabase Postgres + Drizzle ORM (metadata only)
- File bytes: Supabase Storage, private bucket, encrypted before upload
- Validation: Zod (`zod/v4`), `drizzle-zod`
- AI scan: Anthropic SDK (`claude-opus-5`)
- Email: nodemailer over SMTP
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/securesphere` — the mobile app. Screens are files under `app/` (Expo Router).
- `artifacts/api-server` — the Express API. Routes in `src/routes`, shared logic in `src/lib`.
- `artifacts/mockup-sandbox` — Vite + shadcn sandbox for previewing UI components in isolation.
- `lib/db/src/schema` — **source of truth for the database.** `teammates.ts` (users, teammates, invitations) and `files.ts` (files, file_shares). These mirror the live Supabase tables; keep them in sync.
- `lib/api-spec/openapi.yaml` — OpenAPI spec; `lib/api-zod` and `lib/api-client-react` are generated from it.
- `artifacts/securesphere/data/mockData.ts` — dummy data still backing the screens that have no API yet.

## Architecture decisions

- **Client-side scan before encrypt, then ciphertext upload before record.** `POST /api/files/upload` receives only ciphertext, an IV, scan metadata, and blind-index tokens. The retired `POST /api/files/share` plaintext upload endpoint returns `410 Gone` and must not be used.
- **Current privacy boundary.** Client-side LightGBM scanning, AES-256-GCM encryption, HMAC blind-index generation, and decryption handle plaintext only on the device. The API authorizes and stores/proxies ciphertext; it does not hold `FILE_ENCRYPTION_KEY`, decrypt files, or run the legacy server scanner. See `SECURE_SEARCH.md` for the exact searchable-encryption scope and leakage.
- **The scan has two stages and degrades safely.** `src/lib/scanHeuristics.ts` is dependency-free and always runs (extensions, magic bytes, content patterns); `src/lib/spamScanner.ts` adds a Claude pass over the real content. If the model is unreachable the upload falls back to the heuristic verdict rather than failing, and the response says the deep scan did not run.
- **Supabase holds ciphertext and metadata; it never holds a key or a plaintext.** `src/lib/supabaseStorage.ts` is the only place bytes leave the process, and by contract everything through it is already AES-256-GCM output. `FILE_ENCRYPTION_KEY` lives solely in the API server's environment. Object keys are random UUIDs under an owner prefix — never derived from the filename — and objects are uploaded as `application/octet-stream`, so a bucket listing reveals nothing about what a file is or contains.
- **Decryption only ever happens in the API, after an access check.** No public or signed Storage URL is issued, so there is no path for a client to read the bucket directly. The GCM auth tag is appended to the stored blob (the `files` table has an `iv` column but no tag column), and the IV stays in the row — so recovering a file needs the object, the row, *and* the key.
- **Scan reasoning is returned but never persisted.** The model's written explanation can quote file content, so it goes to the user in the upload response and stops there; only `malware_scan_result` and `malware_scan_confidence` are stored.
- **File content is untrusted input to the model.** The scan prompt wraps it in explicit markers and tells the model that instructions found inside are evidence of prompt injection, not commands.
- **Identity always comes from Clerk.** `requireAuth` verifies the session token and every query is scoped to the resulting `clerkId`; frontend-supplied user ids are never trusted.
- **Sharing is restricted to accepted teammates.** Recipient ids are filtered through the `teammates` table before any share row is written.

## Product

- **Auth & onboarding** — Clerk sign-in/sign-up, onboarding carousel.
- **Secure share (Home → Share)** — opens the device file explorer, then runs scan → encrypt → store with the verdict, risk score, and findings shown to the user. Optionally shares with selected teammates in the same step.
- **Teammates & invitations** — search users, invite by email (the link is emailed, with copy/share/resend as fallbacks), accept invitations, list teammates.
- **Still mock data** — files list, file details, shared tab, notifications, AI assistant, search, security score, storage usage.

## User preferences

_Populate as you build._

## What Supabase can and cannot see

Worth being precise about, since the whole design rests on it.

**Cannot see:** the plaintext of any file; the encryption key; the AI scan's written reasoning; the original filename in the Storage bucket (object keys are random UUIDs).

**Can see:** the metadata columns — `filename`, `mime_type`, `size_bytes`, `owner_clerk_id`, `created_at`, the scan verdict and confidence — plus users' emails and names, and who is a teammate of whom. That is inherent to running the database there.

**Locked down (2026-09-06):** all five tables have RLS enabled with zero policies, and the `anon`/`authenticated` grants are revoked, so PostgREST exposes nothing. The API connects as table owner and bypasses RLS, so server code is unaffected. Reference SQL lives in `lib/db/sql/enable-rls.sql`.

> **Why the schema calls `.enableRLS()`:** `drizzle-kit push` manages RLS state and will `DISABLE ROW LEVEL SECURITY` on any table whose Drizzle definition does not declare it. Without `.enableRLS()` on every table, a routine `push` silently undoes the lockdown. If you add a new table, add `.enableRLS()` to it too.

If filenames themselves count as sensitive for your threat model, the `filename` column is the remaining gap and can be encrypted the same way (it would cost server-side search on names). Not done — say the word.

## Gotchas

- **The Storage bucket must be private.** Create it as `secure-files` with Public = OFF. A public bucket would expose the ciphertext objects to anyone with a URL — still encrypted, but it removes a layer that should be there.
- **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** Never put it in an `EXPO_PUBLIC_*` variable or the mobile app; it grants full bucket access.
- `FILE_ENCRYPTION_KEY` must be 64 hex characters. Uploads return 503 without it, and **changing it makes every already-stored file undecryptable.** Do not store it in Supabase — keeping the key beside the ciphertext defeats the purpose.
- After editing anything in `lib/db/src/schema`, run `pnpm --filter @workspace/db run push` before starting the server.
- The Expo app reads `EXPO_PUBLIC_API_URL`; if the API runs on 5000, set it — the built-in default is `http://localhost:3000`.
- **Use Supabase's Session Pooler connection string, not the direct one.** `db.<project-ref>.supabase.co` is IPv6-only, so it fails with `ENOTFOUND`/`ENETUNREACH` on Replit and any IPv4-only network — and intermittently wherever IPv6 comes and goes. The pooler host (`aws-0-<region>.pooler.supabase.com`) has IPv4. Its username is `postgres.<project-ref>`, not `postgres`.
- **Clerk sign-in must sync a profile row.** `AppContext` POSTs to `/api/teammates/sync-user` on every sign-in. Without that row, invites, teammate lists, and file sharing all fail server-side with "profile has not been synced" even though auth succeeded.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so a package published in the last 24 hours will not install. Don't disable it.
- Email and the AI scan are both optional: without SMTP the invitation link is still returned, without `ANTHROPIC_API_KEY` the heuristic scan still runs. Neither absence blocks the app.
- `nodemailer` is in the esbuild `external` list in `artifacts/api-server/build.mjs` — it resolves from `node_modules` at runtime rather than being bundled.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
