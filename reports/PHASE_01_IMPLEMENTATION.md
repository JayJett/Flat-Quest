# Flat Quest — Phase 1 Implementation Report

| | |
| --- | --- |
| Repository | `JayJett/Flat-Quest`, branch `main` |
| Implementation commit | `17679909de74b6f2c1596b953b14137f736b08e2` (this report is committed on top of it) |
| Supabase project | `flat-quest`, ref `ivnovvdpkxrqsmsiqhid`, region `ap-southeast-2` (Sydney), dedicated to this app |
| Report date | 10 November 2026 |

---

## A. Executive summary

Phase 1 of Flat Quest is built: a mobile-first React web app on a new, dedicated Supabase project. It covers:

- Email sign-up, sign-in and password reset, plus Google sign-in code (PKCE). The Google provider is not configured yet.
- Secure household creation and invite-link joining.
- Per-user profiles: name, photo, accent colour and icon.
- The full rooms-and-items checklist: claim, edit, complete, filter, sort, add, delete and reorganise.
- A Home dashboard computed from real data, a Flatmates screen and a Wishlist placeholder.
- Realtime sync across household members.

**The real Google Sheet was read directly.** All 103 CHECKLIST rows across 10 rooms are bundled as `data/checklist.csv` and imported through an idempotent database function when the household is created. There is no demonstration data in the app or the database.

**What is verified vs. not:**

- **Verified:** lint, type-check, build and 28 unit tests pass. 39 scripted browser interaction checks pass against the production build. The schema, RLS, storage policies and RPCs are applied to the live project, and Supabase's security and performance advisors were reviewed.
- **Not yet verified:**
  - **Live sign-in from a browser.** This sandbox's network policy blocks `*.supabase.co`, so browser QA used intercepted fixture responses.
  - **The RLS test suite.** It is written (45 checks, self-cleaning) but not yet run. The Supabase connector asked for your approval to create throwaway test users, and that prompt timed out.
  - **Google OAuth.** It needs Google Cloud credentials that only you can create (section K).

---

## B. Completed functionality

### Authentication and onboarding
- **Sign in / Create account / Forgot password** on one screen (`src/pages/SignIn.tsx`). Validation, friendly error copy (`errorMessage()` in `src/lib/supabase.ts`) and a "Check your email" state for confirmation and reset links.
- **Continue with Google** appears only when the provider is enabled. `useGoogleEnabled()` (`src/pages/SignIn.tsx:13`) reads the public `/auth/v1/settings` endpoint, so users never hit a dead button.
- **`/auth/callback`** completes OAuth and email-link sign-ins, then returns the user to where they were going (`?next=`, restricted to internal paths). Provider errors and timeouts get a clear failure screen.
- **`/auth/reset`** sets a new password after a reset link.
- **Welcome** (users with no household):
  - *Set up our flat* is prefilled with "9 Rua Kai Wai" / "Brooklyn, Wellington", with a "Start with our checklist (103 items across 10 rooms)" toggle.
  - *I have an invite link* accepts a pasted link or code.
- **Join** (`/join?code=…`) previews the household name and member count before joining. Signed-out visitors are sent to sign-in and brought back afterwards.

### Navigation shell (`src/components/AppShell.tsx`)
- A sticky header with the **member's avatar top-left**; tapping it opens the left drawer. Page titles fade into the header on scroll. The header gains a hairline divider only once content scrolls under it (no shadow).
- **Left drawer:**
  - Spring slide-in, with a quick 220 ms exit.
  - Shows avatar, name, personal icon in the accent colour, and the household name.
  - Links: Home, Rooms, Wishlist, Flatmates, Profile, Settings, plus Sign out.
  - Closes on backdrop tap, Escape, the borderless close button, swipe-left, or navigation. Focus is trapped while open and restored afterwards.
- **Bottom navigation** (phones): Home, Rooms, Wishlist, Flatmates. Line icons; the selected tab gets a heavier stroke, ink-coloured label and a small dot. No pills or shadows. Respects the iOS safe area.
- **Desktop (≥1024 px):** the bottom bar becomes a left side rail (profile, five links) and content widens to a two-column dashboard and a 4-column room grid.

### Home (`src/pages/Home.tsx`)
Every number on this screen is calculated from items in the database (`src/lib/stats.ts`).
- Greeting ("Kia ora, Jarden") above a two-weight headline: *Let's furnish* (light) / **9 Rua Kai Wai** (extra-bold). This echoes the reference's "let's learn / **something new**".
- **Progress block:**
  - Large percentage and "x of y in the flat".
  - An animated progress bar.
  - Three counts: Ready, To sort and Unclaimed.
- **One next-action card** (blue), chosen by `nextAction()` (`src/lib/stats.ts:61`). In priority order:
  1. Your own open items ("You've got 6 things to sort").
  2. Otherwise unclaimed must-haves.
  3. Otherwise "N to go".
  4. Otherwise "fully furnished".
- **On your list:** up to 5 of your open items, with working checkboxes.
- **Room by room:** every room with its colour icon, a thin coloured progress bar and "ready/total".

### Rooms (`src/pages/Rooms.tsx`)
- Large saturated room tiles, taken directly from the reference. Each has a cropped line-icon illustration, a "3/25" count, the room name and a progress track. There's also an "Add room" tile.
- An **All rooms / Unclaimed** switch. *Unclaimed* lists every outstanding unclaimed item across the house, must-haves first, each with a **Claim** button.
- **Reorder rooms** sheet (up/down controls) and **Add room**.

### Room detail (`src/pages/RoomDetail.tsx`), the core checklist
- A coloured room header with progress, then **filters** (All / Mine / Open / Done, with counts) and **sort** (priority, name, plan) using a native select.
- With priority sort, items are grouped under *Must-have / Nice to have / Maybe later*, and *Not needed* items collect at the bottom, struck through.
- **Item rows** (`src/components/ItemRow.tsx`) prioritise:
  1. Name.
  2. Completion checkbox.
  3. Who's responsible (avatar, "Shared", or a **Claim** button).
  4. Status, as coloured text.
- **Completion checkbox** (`src/components/Checkbox.tsx`): the check path draws in; a green ring pulse plays **only after the database confirms the write** (`Checkbox.tsx:29`). Light haptic tap where supported.
- **Item sheet** (`src/components/ItemSheet.tsx`), used both to create and to edit an item. Fields:
  - Name, and the "It's in the flat" switch.
  - **Who's on it** (Unclaimed / each member / Shared).
  - **Plan**: the 6 statuses, with inline hints that *Ordered ≠ done* and *Not needed doesn't count*.
  - Priority, room (moves the item between rooms) and **Owned by** (To decide / Shared / each member / Landlord).
  - Estimate and spent (NZ$), shopping link (normalised to https and openable), details and notes.
  - Delete, with confirmation. The Save button stays pinned.
- **Room sheet:** name, 11 colours, 19 icons, live preview, and delete with a warning that states how many items will go.

### Flatmates (`src/pages/Flatmates.tsx`)
- Only actual joined members. Each row shows avatar, name, personal icon in their colour, "N on their list · M in the flat" and a "You" marker.
- Tapping a member opens **their list** (To sort / In the flat). "See my list" on Home uses the same screen.
- **Invite a flatmate:** generates a one-time-displayed link with Copy and native Share. It also lists active links with expiry and use counts, each with **Cancel**.

### Profile (`src/pages/Profile.tsx`)
- **Photo:** pick, validate (type, 15 MB input cap), then centre-crop, resize to 512 px and re-encode to WebP (JPEG fallback). This also strips EXIF/location. The image is uploaded to a private bucket, the old file is deleted, and a remove option is available. A local preview shows during upload; if the profile update fails, the upload is rolled back.
- **Name**, **12 curated colours plus custom hex** (validated, with a warning for very light colours), and **25 curated icons with search**.
- A sticky **Save** bar appears only when there are unsaved changes.

### Settings (`src/pages/Settings.tsx`)
- Flat name and address (editable by the owner; others see why it's disabled).
- **Checklist import:**
  - "Restore original checklist" re-adds any deleted originals; it is idempotent.
  - "Import from a CSV file" shows a preview with item and room counts and any warnings before importing.
- Account email, edit profile, and sign out (with confirmation).

### Wishlist (`src/pages/Wishlist.tsx`)
An intentional placeholder. Its "Dream it up, **together**" heading uses the same two-weight style. Three short rows describe what's coming (share inspiration, vote, decide together). A note says the sheet's 20 wishlist ideas will come across at launch; they're saved in `data/wishlist.csv`. Nothing on the page is interactive or fake.

### States
- **Loading:** a full-screen spinner while the session or household loads, and spinners in buttons.
- **Errors:** a full-screen retry for load failures; toasts for failed writes (with rollback).
- **Empty states:** no items, no rooms, empty filters, nothing claimed, room not found, flatmate not found.
- **Success:** toasts.

---

## C. Architecture

**Stack:** React 19.3, TypeScript 6.0, Vite 8.3, Tailwind CSS 4.3, React Router 8.5, `@supabase/supabase-js` 2.119, `motion` 14.12, `lucide-react` 1.71, `@fontsource-variable/plus-jakarta-sans` 5.3. Dev: ESLint 10 with `typescript-eslint` and `eslint-plugin-react-hooks` 7 (React Compiler rules), Vitest 5, jsdom.

All dependencies are pinned exactly and `package-lock.json` is committed. **TypeScript 6.0 was chosen over 7.0** because `typescript-eslint` 8.72 supports `<6.1`.

```
src/
  auth/        AuthProvider (session), RequireAuth / RequireHousehold guards
  household/   HouseholdProvider: single store for household, members, rooms, items;
               realtime; optimistic mutations. importChecklist.ts (bundled CSV + RPC)
  components/  AppShell, Sheet (+ focus trap, ConfirmSheet), ItemRow, ItemSheet,
               RoomTile, RoomSheet, Checkbox, Avatar (signed URLs), Toast, ui.tsx primitives
  pages/       one file per screen
  design/      tokens.ts (room colours, member colours, room presets), icons.tsx (curated registries)
  lib/         supabase.ts, database.types.ts, domain.ts, stats.ts, csv.ts, color.ts, image.ts
```

**Key decisions**

- **One household store** (`HouseholdProvider`) instead of a query library. The data set is small (around 100–300 items), so a single context with typed mutations keeps realtime, optimistic updates and rollback in one place. The provider is keyed by user id, so switching accounts can never leak state.
- **Optimistic updates with field-level rollback** (`HouseholdProvider.tsx:291`): the UI updates instantly. While a write is in flight, realtime echoes for that item are ignored; if the write fails, only the fields it touched are restored (`:303`), so a concurrent change from a flatmate isn't clobbered.
- **Status ≠ completion** is enforced in the data model, the stats (`progressOf`, `src/lib/stats.ts:23`) and the copy.
- **Design tokens** live in `src/index.css` (`@theme`) and `src/design/tokens.ts`. Rooms store a colour *key* and an icon *key* rather than raw values, so future themes can remap them.
- **Extensibility hooks:** `profiles.preferences` and `households.settings` are JSONB columns for future appearance and branding options. Room colour and icon are already user-editable. Membership supports multiple households per user, with the active one remembered locally.
- **PWA readiness:** web manifest, 192/512/maskable icons, Apple touch icon, `viewport-fit=cover` and safe-area handling. A service worker was deliberately left out (see J).
- **Vercel:** `vercel.json` provides the SPA rewrite and security headers.

---

## D. Supabase

### Tables (all in `public`, all with RLS enabled)

| Table | Purpose | Notable constraints |
| --- | --- | --- |
| `profiles` | 1:1 with `auth.users`; display name, `avatar_path`, `accent_color`, `icon`, `preferences` jsonb | hex colour check; icon key pattern; avatar path must be inside the user's own folder |
| `households` | name, address, `created_by`, `settings` jsonb | length checks |
| `household_members` | (household, user) PK, `role` owner/member | created only via RPCs |
| `household_invites` | `token_hash` (SHA-256), `expires_at`, `max_uses`, `use_count`, `revoked_at` | the plain code is never stored |
| `rooms` | name, icon key, colour key, `sort_order`, `import_key` | `unique(id, household_id)` for the composite FK; `unique(household_id, import_key)` |
| `items` | all fields from the brief (see below) | composite FK `(room_id, household_id)` → rooms, so an item's room must be in the same household; checks tying `responsibility='member'` ⇔ `responsible_user_id` and `ownership='member'` ⇔ `owner_user_id`; price ≥ 0; URL must start `http(s)://`; `unique(household_id, import_key)` |

`items` columns: `id, household_id, room_id, name, description, priority (must_have|nice_to_have|maybe_later), status (to_decide|bringing|need_to_buy|shopping|ordered|not_needed), responsibility (unclaimed|member|shared), responsible_user_id, ownership (to_decide|member|shared|landlord), owner_user_id, is_complete, completed_at, completed_by, estimated_price, actual_price, shopping_url, notes, sort_order, import_key, created_by, created_at, updated_at`. Enumerations are `text` + `CHECK`, so values are easier to extend than Postgres enums.

### Migrations (`supabase/migrations/`, all applied to the live project)
1. `20261110000001_core_schema.sql`: schema, triggers, helper functions, RLS, grants, RPCs, realtime publication.
2. `20261110000002_avatar_storage.sql`: private `avatars` bucket (2 MB, JPEG/PNG/WebP) and policies.
3. `20261110000003_harden_helpers_and_indexes.sql`: advisor follow-ups (below).

### Triggers
- `handle_new_user`: creates a profile on sign-up. The name comes from the `display_name` metadata, else the first name from Google's `full_name`, else the email local part.
- `items_guard` (`core_schema.sql:246`):
  - Blocks moving an item to another household.
  - Requires the responsible person or owner to be a household member.
  - Sets `created_by`, `completed_at` and `completed_by` server-side; client values are ignored.
- `rooms_guard`: blocks moving a room to another household.
- `updated_at` triggers on the mutable tables.

### RLS policies
- **profiles:** select self or anyone you share a household with; update self only. Column grants restrict updates to `display_name, avatar_path, accent_color, icon, preferences`. Insert and delete are not granted to clients.
- **households:** select if member; update (name, address, settings only) if owner. No client insert or delete.
- **household_members:** select within your households; delete only your own row (leave). No insert or update grants, so membership and role cannot be self-assigned.
- **household_invites:** members may select every column **except** `token_hash` (column-level grant). Writes only via RPC.
- **rooms, items:** select, insert, update and delete for household members (`is_household_member(household_id)` in USING and WITH CHECK).
- **anon:** all table privileges revoked; RPC execute revoked.

### RPCs (SECURITY DEFINER, `search_path=''`, each checks `auth.uid()` itself)
- `create_household(name, address)`: creates the household and owner membership (cap of 5 households per user).
- `create_household_invite(household, days=7, max_uses=4)`: members only; at most 10 active invites; returns the plain code once.
- `preview_household_invite(code)` / `accept_household_invite(code)` (`core_schema.sql:505`): hash lookup with row lock; checks revoked, expiry and use count. Idempotent for existing members.
- `revoke_household_invite(id)`: members only.
- `import_checklist(household, rows)` (`core_schema.sql:549`): members only; at most 1000 rows; idempotent via `import_key`.

### Storage
Private bucket `avatars`; objects live at `<user-id>/avatar-<timestamp>.webp`.

| Action | Who |
| --- | --- |
| insert, update, delete | the owner, in their own folder only |
| select | the owner and people who share a household with them |

The app shows avatars through 1-hour signed URLs, cached client-side (`src/components/Avatar.tsx`).

### Realtime
- **Publication:** `items`, `rooms`, `household_members` and `profiles` are in `supabase_realtime`. Postgres Changes respect RLS for subscribers.
- **Channel:** each client subscribes on `household:<id>`. `items` and `rooms` changes are filtered by `household_id`. `profiles` changes come through RLS-filtered and are applied only to known members. Any membership change triggers a refetch.
- **Reconnects:** a `CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED` status marks the connection as reconnecting. On the next `SUBSCRIBED`, the app refetches everything (`HouseholdProvider.tsx:233–237`).
- **Stale data:** the app also refetches on `visibilitychange` (if more than 30 s since the last load) and on `online`.

### Advisor review (run after migrations)
- **Security, 10 × "SECURITY DEFINER function executable by authenticated" (WARN):**
  - The RPCs are intended to be callable.
  - `is_household_member`, `is_household_owner` and `shares_household_with` only answer questions about the caller.
  - `user_in_household(user, household)` **did leak** arbitrary membership. Migration 3 fixed it: it now returns false unless the caller belongs to that household. The warnings remain by design.
- **Performance:** 6 unindexed foreign keys, now fixed by covering indexes in migration 3. The "unused index" notices are only because the project has no traffic yet.

---

## E. Authentication

| Method | Status |
| --- | --- |
| Email + password sign-up / sign-in | Implemented. Uses Supabase defaults (email confirmation **on**). **Not exercised against the live project from a browser:** this sandbox cannot reach `*.supabase.co`. The UI flows (validation, errors, "check your email") were exercised with intercepted responses. |
| Password reset | Implemented (`resetPasswordForEmail` → `/auth/callback?next=/auth/reset` → `updateUser`). Not live-tested, for the same reason. |
| Session persistence | supabase-js `persistSession` + `autoRefreshToken`, PKCE flow (`src/lib/supabase.ts:16`). Verified in the browser harness that a stored session is restored on load and that a member without a household is routed to `/welcome`. The signed-out redirect to `/sign-in` was not separately scripted. |
| Route protection | `RequireAuth` (redirects to `/sign-in?next=…`) and `RequireHousehold` (redirects to `/welcome`). Server-side protection is RLS, not these guards. |
| Sign out | Drawer and Settings; clears the session and session storage. |
| Continue with Google | **Code complete, not configured, not tested.** The Google provider is disabled in the project, so the button is hidden automatically. Setup steps are in section K. |

Things you need to set (section K): Site URL / Redirect URLs, Google provider credentials, and custom SMTP. The default sender is limited to a handful of emails per hour, which four flatmates confirming accounts could hit.

---

## F. Design system

**How the reference shaped the interface:**
- **Bright white base** with `#F5F5F6` surfaces instead of bordered cards (Top Mentors / Class Mentors rows → Flatmates rows, progress block, form fields).
- **Large saturated rounded tiles with line illustrations** (Design Art / Chemistry / Science / Mathe → room tiles and room headers). I used oversized, cropped Lucide line icons as the "illustration", so they stay consistent and editable rather than being bespoke art.
- **Two-weight display headlines** ("let's learn / **something new**" → "Let's furnish / **9 Rua Kai Wai**", "Dream it up, / **together**").
- **Minimal white bottom nav** with line icons.
- Round avatars as the primary identity marker.

**What I did *not* copy:** the reference's content, its screen layouts, its starburst avatar ornament, and its filled-icon nav states.

| Token | Value | Notes |
| --- | --- | --- |
| Background | `#FFFFFF` | |
| Surface | `#F5F5F6`; pressed `#ECECEF` | |
| Primary text | `#111111` | |
| Secondary text | **`#737378`** | The brief's `#858585` is only 3.69:1 on white (fails WCAG AA for body text). `#737378` keeps the tone at 4.72:1. `#858585` is not used for text. |
| Placeholder / disabled | `#A3A3A8` | non-essential text only |
| Divider | `#E7E7EA` | header-on-scroll, sheet footer, Settings section rules only |
| Accent | `#3657E8` (pressed `#2945C9`) | primary buttons, next-action card, links |
| Periwinkle | `#8585F5` (text variant `#5B5BD6`) | Kitchen tile; "Shopping" status text |
| Green | `#42C493` (text `#16855C`) | completion: checkbox, progress, "In the flat" |
| Status text | Bringing `#3657E8`; Need to buy `#C2410C`; Shopping `#5B5BD6`; Ordered `#16855C`; others ink-2 | all ≥ 4.5:1 on white (unit-tested) |
| Room colours | orange `#F45D1E`, periwinkle `#8585F5`, navy `#1F2C8F`, sunshine `#FFC350`, mint `#42C493`, blue `#3657E8`, pink `#F0478C`, sky `#2FB2EE`, violet `#9257F2`, teal `#12B3A0`, red `#FF4B4B` | Each has a white or ink label colour meeting ≥3:1 (unit-tested). Tile labels are ≥19 px bold, so the large-text threshold applies. |
| Member colours | 12 curated, plus validated custom hex | initials colour chosen automatically for contrast |

- **Typography:** Plus Jakarta Sans Variable, self-hosted. It's geometric with friendly rounded terminals and a wide weight range (light 300 through extra-bold 800), which drives the two-weight headlines; it closely matches the reference's typeface. Display 34–38 px (48 px on desktop), titles 22 px, body 16 px, secondary 14–15 px. 13 px is used only under avatars in the person picker. Inputs are 16 px to stop iOS zooming on focus. Numbers use tabular figures.
- **Radii:** tiles 28 px, cards 22 px, controls 16 px, buttons 16–18 px, sheets 28 px top corners.
- **Spacing:** a 4 px base, 16 px page gutters on phones, and generous section spacing (28–36 px) without big empty hero blocks.
- **Shadows:** exactly one token, `--shadow-float`. It is used **only** on the bottom sheet / dialog, the left drawer, and toasts. No cards, buttons, tiles, rows or nav bars have shadows.
- **Borders:** text fields have a transparent 1.5 px border that turns accent-coloured on focus (red when invalid), so there's no layout jump. The unchecked checkbox has a ring. Dividers are listed above. There are no decorative card outlines.
- **Not used anywhere:** gradients, glassmorphism, blobs, dotted patterns, decorative charts or badges.
- **Icons:** Lucide line icons throughout (stroke 1.8–2.4 in UI; 1.1–1.15 for tile illustrations). Curated registries: 19 room icons and 25 profile icons.
- **Motion:**
  - Drawer and sheet: spring in (≈300 ms), 220 ms ease-in out.
  - Segmented control: the indicator slides between options.
  - Progress bars: animate width over 600–700 ms.
  - Checkbox: the check path draws in; a ring pulse follows only after the write succeeds.
  - Buttons and tiles: press scale 0.97.
  - Toasts: slide down.
  - **Reduced motion:** `MotionConfig reducedMotion="user"` plus a CSS media query collapse all transitions and switch off the pulse and press scale.
- **Responsive:** phone column up to 560 px; at 1024 px and up, a side rail, two-column Home and a 4-column room grid. Sheets become centred dialogs from 640 px.

---

## G. Data import

**The actual Google Sheet was imported.** I read the workbook through the Google Drive connector, exported it to XLSX, and extracted the CHECKLIST tab (header row 6, 103 data rows) to `data/checklist.csv`.

**What the file preserves:**
- All 103 item names, including the quoted "Duvet, pillows and bedding".
- The 10 room names. Leading emoji are removed and replaced by mapped icons: 🛋️ Living room → sofa, 🛁 Master ensuite → shower-head, and so on.
- Priorities: 74 must-have, 21 nice to have, 8 maybe later.
- Every other field: Done = FALSE, Who's on it = Unclaimed, Plan = To decide, Owned by = To decide; Budget, Spent, Shopping link and Notes are empty.

A unit test (`tests/csv.test.ts`) asserts these exact counts per room and per priority.

**How it gets into the database:**
- When you create the household with "Start with our checklist" on, the app parses the bundled CSV and calls `import_checklist`.
- Rows are keyed `room:<room>|<item>` (with `#2` for genuine duplicates in a room), so re-running never duplicates anything and never overwrites edits. *Settings → Restore original checklist* uses this to bring back deleted originals.
- *Settings → Import from a CSV file* accepts the sheet's own export (Google Sheets → File → Download → CSV while on the CHECKLIST tab; title rows are skipped) or any CSV with the same headers. It previews counts and warnings, then imports.

**Current database state:** the live database has **no households or items yet**. The import runs when you create the household from the app.

**Landlord-supplied appliances:** the sheet includes "Fridge / freezer (confirm supplied)", "Microwave" and "Washing machine (confirm supplied)". You said the landlord provides these (plus a dishwasher and dryer, which aren't on the sheet). I imported the sheet **exactly** rather than editing it. After importing, open each of those three items and set Plan → *Not needed* and Owned by → *Landlord*; they will then drop out of progress counts.

The WISHLIST tab's 20 ideas are saved to `data/wishlist.csv` for Phase 2 and not imported.

---

## H. Testing

### Automated checks, all passing at commit `1767990`
| Check | Result |
| --- | --- |
| `npm run lint` (ESLint incl. React Compiler rules) | 0 problems (2 justified suppressions for fetch-on-mount effects) |
| `npm run typecheck` | 0 errors |
| `npm run build` | succeeds; JS 821 kB / 244 kB gzip, CSS 35 kB / 9.7 kB gzip |
| `npm test` (Vitest) | **28/28 passed** |

The unit tests cover:
- **Progress maths:** Not needed excluded, Ordered ≠ done, empty household, room breakdown, all next-action branches.
- **CSV parser:** quotes, CRLF, BOM.
- **Bundled checklist fidelity:** 103 rows, per-room counts, priority split, defaults.
- **Raw sheet export layout:** title rows skipped, every column mapped, unknown values warned about.
- **Colour tokens:** contrast for room labels, secondary text, status text and member initials.
- **Hex and invite-link parsing.**

### Browser interaction checks: 39/39 passed
These ran in Playwright against the production build at iPhone 14 Pro and 1280 px sizes, with Supabase HTTP intercepted by fixtures:
- **Checkbox:**
  - Ticking sends a PATCH, stays checked and updates the room count.
  - **When the write is rejected:** the box checks immediately, then rolls back. A "You don't have permission" toast appears, the count is unchanged, and no celebration plays.
- **Claim:**
  - Claiming shows a toast, swaps the Claim button for your avatar, and the item appears under *Mine*.
  - When the write is rejected, the claim rolls back.
- **Create item:**
  - An empty name is blocked; a bad URL is blocked.
  - Values are normalised (`example.com/spice` → `https://example.com/spice`, `$29.90` → 29.9) and the item appears in the list.
- **Edit and delete:** editing to *Ordered* saves without completing the item; delete-with-confirm removes it.
- **Drawer:** closes on Escape, backdrop tap and the close button; a drawer link navigates and closes it.
- **Home:** the next-action card opens my list.
- **Profile:** colour and icon save; invalid hex is flagged.
- **Layout:**
  - No horizontal overflow on any phone screen.
  - No overflow on desktop: this initially **failed**, because inline safe-area padding overrode the desktop gutter. Fixed and re-verified.
  - No uncaught page errors.

### Database
- All three migrations applied successfully via the Supabase connector.
- Security and performance advisors reviewed; findings fixed or explained in section D.
- **RLS suite: written, not yet run.** `supabase/tests/rls_verification.sql` impersonates three users (owner, joiner, outsider) plus anon and records 45 expected/actual checks:
  - Household isolation; profile edit protection.
  - Invite validation; no self-insertion into memberships.
  - Token hashes unreadable; non-members can't be assigned.
  - Cross-household moves blocked; server-set `completed_by`.
  - Idempotent import; anon fully denied.

  It deletes everything it creates. My first run asked for your approval through the Supabase connector (it inserts test rows into `auth.users`), and that prompt timed out. **No RLS behaviour should be considered verified until this runs.**

### Not tested
- Live email and Google sign-in.
- Realtime sync between two real devices. The code paths exist, but realtime websockets were blocked in this sandbox.
- Actual avatar upload to Storage.
- Real iOS Safari or a home-screen install.
- Screen-reader walkthrough.

---

## I. Visual review

Screenshots are in `reports/screenshots/`. Mobile shots are iPhone 14 Pro (393 × 852) at 2× scale; desktop shots are 1440 × 900.

> **These screenshots use test fixtures, not real household data.** The 103 items are the real checklist, but the members (named after you four), their colours and icons, and every claim, status and completion shown are fabricated for QA. None of it exists in the database.

| Screen | File |
| --- | --- |
| Sign in (with Google enabled) | `m01-sign-in.png` |
| Welcome / create flat / join | `m03-welcome.png`, `m04-create-flat.png`, `m05-join.png` |
| Home | `m10-home.png`, `d10-home.png` |
| Drawer | `m12-drawer.png` |
| Rooms / unclaimed | `m20-rooms.png`, `m22-unclaimed.png`, `d20-rooms.png` |
| Room detail | `m30-room.png`, `d30-room.png` |
| Item sheet / room sheet | `m32-item-sheet.png`, `m33-room-sheet.png`, `d31-item-sheet.png` |
| Flatmates / invite / my list | `m40-flatmates.png`, `m41-invite.png`, `m42-my-list.png` |
| Wishlist | `m50-wishlist.png` |
| Profile | `m60-profile.png` |

**Issues found and fixed during review:**
- The headline orphaned "Wai" on its own line.
- Tile illustrations collided with two-line room names.
- Two-letter initials read oddly for single names; they now show one letter.
- Plan buttons peeked out under the item sheet's sticky Save.
- "Show all" was misaligned with its section title.
- A permanently visible disabled "Saved" bar on Profile.
- Desktop horizontal overflow.
- Slow sheet and drawer dismissal.

**Remaining observations:**
- With initials-only avatars (before anyone uploads a photo), the header avatar is a plain coloured circle; it looks better with photos.
- The navy, blue and violet room colours are close in hue next to each other in the grid.
- On large desktop screens the content column leaves some empty space on the right of the side rail. It's acceptable, but there's room to refine.
- Lucide's shower-head icon is small and busy at 22 px in the Home room list.

---

## J. Known issues and limitations

1. **RLS suite not yet executed** (see H). This is the most important open item.
2. **Live auth untested**, because the sandbox network can't reach Supabase. Email confirmation needs Redirect URLs set; Google needs configuration.
3. **No service worker.** The app is installable to the home screen via the manifest, but there's no offline cache. I left it out because caching an authenticated SPA plus OAuth callback routes needs care; this is worth a deliberate Phase 2 task.
4. **Bundle size:** 244 kB gzip in one chunk. Route-level code-splitting (Profile, Settings, auth pages) would cut first load.
5. **Members can't be removed** by the owner from the UI. The policy only allows leaving, and there is no "leave household" button yet. If the owner leaves, nobody can rename the household.
6. **Item reordering within a room** isn't exposed. Items are sorted by priority, name or plan, plus their import order.
7. **Concurrent edits are last write wins**, at field level. Two people editing the same item sheet at once can overwrite each other's unsaved fields.
8. **Realtime profile events** are delivered RLS-filtered but not filtered by household. The client ignores non-members. This is fine at this scale.
9. **Custom accent colours** that are very light get dark text and icons automatically, but a very light accent can still look washed out as a tile or ring.
10. `src/lib/database.types.ts` is a trimmed hand copy of the generated types. Regenerate it after schema changes.
11. **Email rate limits:** Supabase's default sender is limited to a few emails per hour.

---

## K. Manual setup required

1. **Environment variables** (local `.env` already contains these; add them in Vercel too):
   - `VITE_SUPABASE_URL=https://ivnovvdpkxrqsmsiqhid.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` (from Supabase → Project Settings → API Keys)
2. **Supabase → Authentication → URL Configuration:**
   - Site URL: your production URL (until deployed, `http://localhost:3000`).
   - Redirect URLs: `http://localhost:3000/**` and `https://<prod-domain>/**`.
3. **Custom SMTP** (Authentication → Emails → SMTP), recommended before inviting everyone.
4. **Google OAuth** (full steps in README):
   1. Create a Web OAuth client in Google Cloud.
   2. Authorised redirect URI: `https://ivnovvdpkxrqsmsiqhid.supabase.co/auth/v1/callback`.
   3. JavaScript origins: localhost:3000 and the production origin.
   4. Add the four flatmates as test users, or publish the consent screen.
   5. Paste the Client ID and Secret into Supabase → Sign In / Providers → Google.

   The button appears automatically once enabled.
5. **Deploy to Vercel:** import `JayJett/Flat-Quest`, choose the Vite preset, add the env vars, then add the domain to steps 2 and 4.
6. **Run the RLS suite:** paste `supabase/tests/rls_verification.sql` into the SQL editor (or approve the connector prompt) and confirm all rows read PASS.
7. **First use:**
   1. Jarden signs up and creates "9 Rua Kai Wai" with the checklist on.
   2. In Flatmates → Invite, create a link and share it with Madi, Emily and Dan.
   3. Mark the landlord appliances *Not needed / Landlord*.

---

## L. Recommended Phase 2 (not implemented)

1. **Collaborative wishlist:** ideas with photos and links, per-member votes (`wishlist_items` and `wishlist_votes`, unique per member), "Chosen" promotes an idea to a checklist item. Seed it from `data/wishlist.csv`.
2. **Production hardening:** run and keep the RLS suite as a CI check (Supabase CLI with a local stack), service worker with network-first data and offline shell, route code-splitting, Sentry or similar error reporting.
3. **Household management:** owner can remove members and transfer ownership; members can leave.
4. **Playful polish:** room-complete and house-complete celebration moments, a shared activity line on each item ("Madi ticked this off"), drag-to-reorder items.
5. **Personalisation:** room theme presets and household branding using the existing `settings` / `preferences` JSONB.
6. **Collaboration safety:** item-level `updated_at` conflict detection in the edit sheet ("Dan changed this while you were editing").

Phase 1 stops here, pending your review.
