# Flat Quest

A private, collaborative home-furnishing app for our flat. Flatmates see everything the house needs, claim what they're bringing or buying, and tick items off once they're physically in the flat.

Mobile-first React web app backed by Supabase (Auth, Postgres with row level security, Storage, Realtime).

> **New to this? Start with [`SETUP_GUIDE.md`](SETUP_GUIDE.md)**, which gives click-by-click setup instructions.
> Status and verification details: [Phase 1](reports/PHASE_01_IMPLEMENTATION.md) · [Phase 2](reports/PHASE_02_IMPLEMENTATION.md) · [Phase 3](reports/PHASE_03_IMPLEMENTATION.md)

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
| Hosting | GitHub Pages via GitHub Actions (Vercel-compatible too) |

All dependency versions are pinned exactly in `package.json`; `package-lock.json` is committed.

## Getting started

Requires Node 20.19+ (tested on Node 22).

```bash
npm ci
```

Local development also needs a `.env` file:

```bash
cp .env.example .env
```

Fill it in with your Supabase project URL and **publishable** key (Project Settings → API Keys). Production builds read `.env.production`, which is committed and holds the same two public values, so hosting needs no configuration. Never put the `service_role`/secret key in any `VITE_` variable or committed file: everything prefixed `VITE_` ships to the browser.

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

| Migration | Purpose |
| --- | --- |
| `20261110000001_core_schema.sql` | Tables, triggers, RLS, RPCs, realtime |
| `20261110000002_avatar_storage.sql` | Private `avatars` bucket and policies |
| `20261110000003_harden_helpers_and_indexes.sql` | Advisor follow-ups |
| `20261111000001_private_helpers.sql` | Membership helpers moved to a non-exposed `private` schema |
| `20261111000002_single_invite.sql` / `…0003_invite_full_house.sql` | One current invite per household (Vault-encrypted code), member limit |
| `20261111000004_item_assignees.sql` / `…0008_drop_phase1_responsibility.sql` | Responsibility shared between selected members |
| `20261111000005_provided_status.sql` | "Provided with flat" status, landlord appliances |
| `20261111000006_tour_and_household_photo.sql` | Tour state, household photo, `household-media` bucket |
| `20261111000007_wishlist.sql` | Wishlist ideas, votes, conversion to checklist |
| `20261111000009_phase2_indexes.sql` | Performance-advisor indexes |

`supabase/tests/rls_verification.sql` is a self-cleaning script that impersonates three users and checks access isolation; run it in the SQL editor and every row should read `PASS`.

### Auth configuration (dashboard)

**Authentication → URL Configuration**

- **Site URL:** `https://jayjett.github.io/Flat-Quest`
- **Redirect URLs:** add both
  - `http://localhost:3000/**`
  - `https://jayjett.github.io/Flat-Quest/**`

The app sends users back to `/auth/callback?next=…` after Google sign-in, email confirmation and password reset, so the `/**` wildcard is required.

**Email:** Supabase's built-in email sender is heavily rate-limited and intended for testing only. Before inviting all four flatmates, configure custom SMTP (Authentication → Emails → SMTP Settings), e.g. Resend or Postmark.

### Google sign-in

The "Continue with Google" button only appears once the Google provider is enabled (the app checks `/auth/v1/settings`), so it never shows a dead button.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or choose a project.
2. **Google Auth Platform → Branding:** set the app name ("Flat Quest"), support email and authorised domain `supabase.co` (plus your own domain if you use one).
3. **Audience:** while the app is in *Testing*, add each flatmate's Google account as a test user (or publish the app).
4. **Data Access:** scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
5. **Clients → Create client → Web application**
   - Authorised JavaScript origins: `http://localhost:3000` and `https://jayjett.github.io`
   - Authorised redirect URI: `https://ivnovvdpkxrqsmsiqhid.supabase.co/auth/v1/callback`
6. Copy the Client ID and Client Secret into Supabase **Authentication → Sign In / Providers → Google**, and enable it.

## Hosting (GitHub Pages)

The live app is **https://jayjett.github.io/Flat-Quest/**.

`.github/workflows/deploy.yml` runs on every push to `main`. It lints, runs the unit tests, builds with `BASE_PATH=/Flat-Quest/`, copies `index.html` to `404.html` so deep links work, and publishes `dist/` to GitHub Pages. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

The app works from a sub-folder because Vite's `base` comes from `BASE_PATH`, the router uses `import.meta.env.BASE_URL` as its basename, and every absolute URL the app generates (auth redirects, invite links) goes through `appUrl()` in `src/lib/urls.ts`.

Vercel also works (`vercel.json` is kept): import the repo and deploy with no settings. `BASE_PATH` defaults to `/`.

## How it works

- **Households and invites:** a signed-in user creates a household (becoming its owner) or joins one with an invite link. Each household has one current link at a time (enforced by a row lock and a unique index), valid for 7 days while the flat has free places (default limit 4). The 144-bit code is kept encrypted in Supabase Vault so members can share it again; the readable table only holds its SHA-256 hash. Membership can only be created through the `accept_household_invite` RPC.
- **Who's on it:** `item_assignees` links items to any number of members (0 = unclaimed, 2+ = shared). Composite foreign keys keep assignees inside the item's household and remove them automatically if a member leaves.
- **Wishlist:** ideas with room/price/link/photo, one vote per member (`wishlist_votes` primary key), and `add_wishlist_to_checklist` to turn a chosen idea into exactly one checklist item.
- **Household photo / wishlist photos:** private `household-media` bucket, one folder per household, readable and writable only by members.
- **Tour:** stored per person in `profiles.tour_completed_at`; replay from the menu ("Show me around").
- **Access control:** every table has RLS. Policies call `is_household_member()`, which checks the `household_members` table for `auth.uid()`. Profiles are visible to people you share a household with and editable only by their owner (column-level grants restrict editable fields). Avatars live in a private bucket under `<user-id>/…` and are served via short-lived signed URLs.
- **Items:** responsibility (who's bringing or buying it) and ownership (who keeps it) are separate. Completion (`is_complete`) is independent of status, so an *Ordered* item stays open until someone ticks it. *Not needed* items are excluded from all progress counts. *Provided with flat* items (landlord appliances) count towards progress once ticked, but are never "unclaimed". `completed_at`/`completed_by` are set by a database trigger, not the client.
- **Realtime:** one channel per household listens to `items`, `item_assignees`, `rooms`, `households`, `household_members` and `profiles` changes (the Wishlist page adds ideas and votes). After a disconnect the app refetches everything, and it also refreshes when the tab becomes visible again or the device comes back online.
- **Optimistic updates:** ticking, claiming and editing update the UI immediately and roll back only the touched fields if the write fails, with an error toast. The completion animation plays only after the database confirms the write.

## Checklist import

`data/checklist.csv` is the exact CHECKLIST tab (103 items, 10 rooms) of the original Flat Quest Google Sheet, exported on 2026-11-10. When creating a household you can start with it; **Settings → Checklist import** can restore it or import another CSV.

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

### Phase 3 regression checks

Build with `BASE_PATH=/Flat-Quest/`, run `npx playwright install chromium webkit`, then `npm run test:browser`. The browser suite intercepts Supabase with invented fixtures. The Pages workflow runs this suite and the 80-check RLS script against a disposable local Supabase stack before publishing. The test SQL rolls back all fixtures.
