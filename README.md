# Flat Quest

A private, collaborative home-furnishing app for **9 Rua Kai Wai** (Brooklyn, Wellington). Flatmates see everything the house needs, claim what they're bringing or buying, and tick items off once they're physically in the flat.

Mobile-first React web app backed by Supabase (Auth, Postgres with row level security, Storage, Realtime).

> Phase 1 status and verification details: [`reports/PHASE_01_IMPLEMENTATION.md`](reports/PHASE_01_IMPLEMENTATION.md)

## Stack

| Concern | Choice |
| --- | --- |
| UI | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| Routing | React Router 8 (data router) |
| Motion | `motion` 14 (respects `prefers-reduced-motion`) |
| Icons | `lucide-react` |
| Font | Plus Jakarta Sans (self-hosted via `@fontsource-variable`) |
| Backend | Supabase: Auth (email + Google OAuth, PKCE), Postgres + RLS, Storage, Realtime |
| Tests | Vitest (unit) |
| Hosting | Any static host; `vercel.json` included for Vercel |

All dependency versions are pinned exactly in `package.json`; `package-lock.json` is committed.

## Getting started

Requires Node 20.19+ (tested on Node 22).

```bash
npm ci
```

```bash
cp .env.example .env
```

Fill in `.env` with your Supabase project URL and **publishable** key (Project Settings → API Keys). Never put the `service_role`/secret key in a `VITE_` variable: everything prefixed `VITE_` ships to the browser.

```bash
npm run dev
```

The dev server runs on **http://localhost:3000**, which matches Supabase's default Site URL.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Local dev server on port 3000 |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build on port 3000 |
| `npm run lint` | ESLint (incl. React Compiler hook rules) |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest unit tests |

## Supabase setup

The hosted project used in Phase 1 is `flat-quest` (`ivnovvdpkxrqsmsiqhid`, Sydney region). Migrations in `supabase/migrations/` have already been applied to it. To set up a fresh project, apply them in order (Supabase CLI `supabase db push`, or paste each file into the SQL editor):

1. `20261110000001_core_schema.sql`: tables, triggers, RLS policies, RPCs, realtime publication
2. `20261110000002_avatar_storage.sql`: private `avatars` bucket and storage policies
3. `20261110000003_harden_helpers_and_indexes.sql`: advisor follow-ups

`supabase/tests/rls_verification.sql` is a self-cleaning script that impersonates three users and checks access isolation; run it in the SQL editor and every row should read `PASS`.

### Auth configuration (dashboard)

**Authentication → URL Configuration**

- **Site URL:** your production URL, e.g. `https://flat-quest.vercel.app` (keep `http://localhost:3000` while developing).
- **Redirect URLs:** add both
  - `http://localhost:3000/**`
  - `https://<your-production-domain>/**`

The app sends users back to `/auth/callback?next=…` after Google sign-in, email confirmation and password reset, so the `/**` wildcard is required.

**Email:** Supabase's built-in email sender is heavily rate-limited and intended for testing only. Before inviting all four flatmates, configure custom SMTP (Authentication → Emails → SMTP Settings), e.g. Resend or Postmark.

### Google sign-in

The "Continue with Google" button only appears once the Google provider is enabled (the app checks `/auth/v1/settings`), so it never shows a dead button.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or choose a project.
2. **Google Auth Platform → Branding:** set the app name ("Flat Quest"), support email and authorised domain `supabase.co` (plus your own domain if you use one).
3. **Audience:** while the app is in *Testing*, add each flatmate's Google account as a test user (or publish the app).
4. **Data Access:** scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
5. **Clients → Create client → Web application**
   - Authorised JavaScript origins: `http://localhost:3000` and your production origin
   - Authorised redirect URI: `https://ivnovvdpkxrqsmsiqhid.supabase.co/auth/v1/callback`
6. Copy the Client ID and Client Secret into Supabase **Authentication → Sign In / Providers → Google**, and enable it.

## Deploying to Vercel

1. Import the GitHub repo into Vercel (framework preset: Vite).
2. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Deploy, then add the production URL to Supabase's Site URL / Redirect URLs and to the Google OAuth client (above).

`vercel.json` rewrites all app routes to `index.html` (client-side routing) and sets basic security headers.

## How it works

- **Households and invites:** a signed-in user creates a household (becoming its owner) or joins one with an invite link. Invite codes are 144-bit random tokens; only their SHA-256 hash is stored, they expire after 7 days and allow up to 4 uses. Membership can only be created through the `accept_household_invite` RPC.
- **Access control:** every table has RLS. Policies call `is_household_member()`, which checks the `household_members` table for `auth.uid()`. Profiles are visible to people you share a household with and editable only by their owner (column-level grants restrict editable fields). Avatars live in a private bucket under `<user-id>/…` and are served via short-lived signed URLs.
- **Items:** responsibility (who's bringing or buying it) and ownership (who keeps it) are separate fields. Completion (`is_complete`) is independent of status, so an *Ordered* item stays open until someone ticks it. *Not needed* items are excluded from all progress counts. `completed_at`/`completed_by` are set by a database trigger, not the client.
- **Realtime:** one channel per household listens to `items`, `rooms`, `household_members` and `profiles` changes. After a disconnect the app refetches everything, and it also refreshes when the tab becomes visible again or the device comes back online.
- **Optimistic updates:** ticking, claiming and editing update the UI immediately and roll back only the touched fields if the write fails, with an error toast. The completion animation plays only after the database confirms the write.

## Checklist import

`data/checklist.csv` is the exact CHECKLIST tab (103 items, 10 rooms) of the "🏡 Flat Quest — 9 Rua Kai Wai" Google Sheet, exported on 2026-11-10. When creating a household you can start with it; **Settings → Checklist import** can restore it or import another CSV.

Imports go through the `import_checklist` RPC and are idempotent: each row is keyed by room + item name, so re-importing never duplicates anything and never overwrites edits. The importer accepts the sheet's own CSV export (title rows above the header are skipped) or the normalised `data/checklist.csv`. "Who's on it?" and "Owned by" values are matched to flatmates' display names; unmatched names stay unclaimed.

`data/wishlist.csv` holds the sheet's 20 wishlist ideas for Phase 2.

## Project structure

```
src/
  auth/         AuthProvider (session), route guards
  household/    HouseholdProvider (data, realtime, mutations), checklist import
  components/   AppShell (header, drawer, bottom nav), sheets, item row, room tile, UI primitives
  pages/        Home, Rooms, RoomDetail, Flatmates, Wishlist, Profile, Settings, SignIn, Welcome/Join
  design/       Design tokens (colours, room presets) and icon registries
  lib/          Supabase client, domain types, stats, CSV parser, colour + image helpers
supabase/
  migrations/   SQL migrations (applied to the hosted project)
  tests/        RLS verification script
data/           Source checklist + wishlist CSVs from the Google Sheet
tests/          Vitest unit tests
reports/        Phase reports and screenshots
```
