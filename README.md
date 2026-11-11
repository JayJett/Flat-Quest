# Flat Quest

A private, collaborative home-furnishing app for our flat. Flatmates see everything the house needs, claim what they're bringing or buying, compare products and track orders together, and tick items off once they're physically in the flat.

Mobile-first React web app backed by Supabase (Auth, Postgres with row level security, Storage, Realtime).

> **New to this? Start with [`SETUP_GUIDE.md`](SETUP_GUIDE.md)**, which gives click-by-click setup instructions.
> Status and verification details: [Phase 1](reports/PHASE_01_IMPLEMENTATION.md) · [Phase 2](reports/PHASE_02_IMPLEMENTATION.md) · [Phase 3](reports/PHASE_03_IMPLEMENTATION.md) · [Phase 4](reports/PHASE_04_IMPLEMENTATION.md)

## Stack

| Concern | Choice |
| --- | --- |
| UI | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| Routing | React Router 8 (data router) |
| Motion | `motion` 14 (respects `prefers-reduced-motion`) |
| Icons | `lucide-react` |
| Font | Plus Jakarta Sans (self-hosted via `@fontsource-variable`) |
| Backend | Supabase: Auth (email + Google OAuth, PKCE), Postgres + RLS, Storage, Realtime |
| Tests | Vitest (unit), Playwright (browser, fixture-backed), SQL access suite on a disposable database |
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
| `npm run test:browser` | Playwright browser tests against the production build (needs `npm run build` first) |

## Supabase setup

The hosted project is `flat-quest` (`ivnovvdpkxrqsmsiqhid`, Sydney region). Migrations in `supabase/migrations/` have already been applied to it. To set up a fresh project, apply them in order (Supabase CLI `supabase db push`, or paste each file into the SQL editor):

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
| `20261112000001_shopping.sql` | Phase 4: purchase stages, room measurements, product options, preferences, purchase coordination, purchase and delivery records |

`supabase/tests/rls_verification.sql` impersonates four throwaway users and checks access isolation (163 checks, every row should read `PASS`), then rolls everything back. `supabase/tests/coordinator_race.sh` fires simultaneous claims, selections and preferences from separate connections. Both are meant for a **disposable local database**, never the hosted project:

```bash
# A real local Supabase stack (what CI uses; needs Docker)
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/rls_verification.sql
FLATQUEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres supabase/tests/coordinator_race.sh

# Or, without Docker: a plain local Postgres 15+ with a small stand-in for the Supabase schemas
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres supabase/tests/run_local.sh
```

`supabase/rollback/` holds the reverse of the Phase 4 migration, for emergencies only.

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
- **Shopping:** a view over the same checklist, not a second list (`/rooms/shopping`, reached from Rooms and from Home). An item is on it while its plan is one of the purchase stages (*Need to buy → Shopping → Ordered → On the way / Ready to collect → Delivered*), which are ordinary values of `items.status`. Items that are not needed, provided with the flat, being brought by someone or still undecided stay off it.
- **Product options:** `product_options` holds several candidate products for one item (shop, price, link, photo, size, notes). Each member can prefer one option per item (`product_preferences`, primary key `(item_id, user_id)`), and the household marks one as its pick (`is_selected`, one per item by a unique index). Preferences never select anything by themselves, and they are separate from wishlist votes.
- **Who's sorting the purchase:** `purchase_coordinators` has one row per item, so two simultaneous claims cannot both succeed. You can claim, release, hand your role to a flatmate, or deliberately take one over; you can never appoint someone else. It does not change who is on the item, who owns it, or who paid.
- **Purchase and delivery:** `item_purchases` (optional, one per item) records what was bought, by whom, the order reference and how it is arriving. The amount paid is the item's own `actual_price` and the stage is the item's own `status`; `save_item_purchase` writes all three in one transaction and refuses to overwrite newer changes. *Delivered* is still not complete: only "It's in the flat" (`is_complete`) is.
- **Measurements:** optional centimetres on product options and rooms. Where both exist the app shows a rough comparison, always labelled as approximate.
- **Household photo / wishlist and product photos:** private `household-media` bucket, one folder per household (`<household>/wishlist/…`, `<household>/products/…`), readable and writable only by members. Photos are resized and re-encoded on the device before upload, which also drops location metadata.
- **Tour:** stored per person in `profiles.tour_completed_at`; replay from the menu ("Show me around").
- **Access control:** every table has RLS. Policies call `is_household_member()`, which checks the `household_members` table for `auth.uid()`. Profiles are visible to people you share a household with and editable only by their owner (column-level grants restrict editable fields). Avatars live in a private bucket under `<user-id>/…` and are served via short-lived signed URLs.
- **Items:** responsibility (who's bringing or buying it) and ownership (who keeps it) are separate. Completion (`is_complete`) is independent of status, so an *Ordered* item stays open until someone ticks it. *Not needed* items are excluded from all progress counts. *Provided with flat* items (landlord appliances) count towards progress once ticked, but are never "unclaimed". `completed_at`/`completed_by` are set by a database trigger, not the client.
- **Realtime:** one channel per household listens to `items`, `item_assignees`, `rooms`, `households`, `household_members` and `profiles` changes (the Wishlist page adds ideas and votes). A second channel carries product options, preferences, purchase coordination and purchases. After a disconnect the app refetches everything, and it also refreshes when the tab becomes visible again or the device comes back online.
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
  shopping/     ShoppingProvider (options, preferences, coordination, purchases) and its sheets
  wishlist/     WishlistProvider, idea card and sheet
  components/   AppShell (header, drawer, bottom nav), sheets, item row, room tile, UI primitives
  pages/        Home, Rooms, Shopping, RoomDetail, Flatmates, Wishlist, Profile, Settings, SignIn, Welcome/Join
  design/       Design tokens (colours, room presets) and icon registries
  lib/          Supabase client, domain types, stats, shopping + date logic, CSV parser, colour + image helpers
supabase/
  migrations/   SQL migrations (applied to the hosted project)
  tests/        Access suite, concurrency script, local runner
  rollback/     Emergency reverse of the Phase 4 migration
data/           Source checklist + wishlist CSVs from the Google Sheet
tests/          Vitest unit tests; tests/browser holds the Playwright suites and fixtures
reports/        Phase reports and screenshots
```

### Browser and database checks

Build with `BASE_PATH=/Flat-Quest/ npm run build`, run `npx playwright install chromium webkit` once, then `npm run test:browser`. The browser suites (`tests/browser/phase3.spec.ts`, `phase4.spec.ts`) intercept every Supabase request with invented "Our Flat" fixtures, so they can never read or write the real household. They run on desktop Chromium, a 320 × 568 iPhone-sized WebKit, and a reduced-motion mobile Chromium.

The Pages workflow runs lint, unit tests, the build, the browser suites, the 163-check access suite and the concurrency script (both against a disposable local Supabase stack) on every pull request, and publishes only from `main` when all of them pass.

`SHOTS=1 npx playwright test screenshots --project=desktop-chromium` regenerates the Phase 4 screenshots in `reports/screenshots/`.
