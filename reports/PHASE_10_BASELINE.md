# Phase 10 baseline

Recorded on 17 November 2026, before any Phase 10 application change.
- Commit: `79f0cb3` (`main`: Phase 9 report on top of merge `f791f9f`).
- Work branch: local `phase-10-shared-week`. Nothing committed or pushed.

## 1. Checks run at baseline

| Check | Result |
|---|---|
| `npm run lint`, `tsc -b` | Clean |
| Vitest | 11 files, 140 passed |
| `BASE_PATH=/Flat-Quest/ npm run build` | Built |
| Playwright, desktop-chromium and reduced-motion | 194 passed, 2 skipped (opt-in screenshot specs) |
| Small-iPhone WebKit | Not installed in this container; it runs in CI. Last CI run (`f791f9f`) passed |
| `supabase/tests/run_local.sh` (Postgres 16) | RLS 163 rows; races 14/14; Phase 5 complete; Phase 6 71, Phase 7 61, Phase 8 30, Phase 9 27 |

No failures existed before Phase 10, so any later failure is a Phase 10 regression.

## 2. How a flat is chosen today

- **Accounts already support several flats.** `household_members` allows any number of rows per user.
  - `create_household` refuses once a person has 5 memberships (owned or joined).
  - `accept_household_invite` has no per-person cap; only the flat's own member limit applies (`household_spaces`, default 4).
- **One browser-wide key picks the flat.** `HouseholdProvider.load()` reads `localStorage['flatquest.activeHousehold']`.
  - If the stored id is one of the person's memberships, that flat opens. Otherwise the earliest-joined flat opens.
  - The key is not tied to an account, so every account on the device shares it (reproduced in the baseline spec).
  - Read and write failures are caught. With storage unavailable, the earliest flat opens.
- **There is no switcher.** The menu shows the current flat's name only (`p10-before-*-menu.png`).
  - Today the only way to change flats is to accept an invite or create a flat. Both write the key and reload.
- **Finding confirmed: the already-member invite opens the wrong flat.**
  - `JoinPage` navigates to `/` for an existing member without selecting the invited flat.
  - Repro (`tests/browser/phase10-baseline.spec.ts`, run with `BASELINE=1`): last used flat is "Our Flat"; open an invite to "Harbour Street" (already a member); tap "You're already in. Open it"; **Home shows Our Flat** (`p10-before-repro-invite.png`).
  - `accept_household_invite` already returns the flat id for existing members without consuming the invite, so the fix needs no database change.
- **Losing access.** A realtime `household_members` DELETE for yourself triggers a full reload, which falls back to another flat or onboarding.
  - If the event is missed, the next refresh (foreground after 30s, or `online`) reloads memberships.
  - A load that fails mid-session keeps the previous data on screen and only shows a toast.

## 3. Household-specific state that a switch must reset

All of the following are keyed, directly or indirectly, by the active household id.

| Layer | Where | Today |
|---|---|---|
| Household data (household, members, rooms, items, assignees), Realtime channel `household:<id>` | `HouseholdProvider` | Keyed by **user** only; household changes happen inside one instance via `load()` |
| Notifications and the unread badge, channel `notifications:<uid>:<hid>` | `NotificationProvider` (in `AppShell`) | Queries filter by `household_id` and recipient; badge already per flat |
| Essentials, tasks and their channels | `LivingProvider` (in `AppShell`) | Filtered by household |
| Product options, preferences, coordinators, purchases | `ShoppingProvider` (in `AppShell`) | Filtered by household |
| Search index sources | `SearchOverlay` | Queries by household id when opened |
| Signed media URLs and in-flight requests | `Avatar.tsx` module cache | Cleared when the shell's household id changes; generation counter discards late results |
| Room cover lookups | `useRoomCover` module cache | Keyed by visual id (unique); cleared on sign-in and sign-out only |
| Tour, open sheets, route params, scroll positions | `AppShell` / pages | Not reset on a household change |

**Personal (follow the person across flats):** `user_preferences` (accent, motion, greeting, Home layout, notification mutes) and `profiles`. They are cached per user id (`flatquest.prefs.<uid>`).

**Shareable links:** none carry a flat. `/rooms/<id>?item=…`, `/tasks?task=…` and `/essentials?essential=…` resolve against whatever flat is active, so for a different flat they show "removed".

**Auth return:** `RequireAuth` keeps `pathname + search` in `?next=`. OAuth and magic links store it under `flatquest.next`, checked by `safeNext` (internal paths only). Query parameters survive the round trip, so `?flat=` will too.

## 4. Dates and time zones

- Task due dates (`household_tasks.due_on`) and purchase dates (`item_purchases.expected_on`, `arrived_on`) are **civil `date`s**. They need no conversion.
- The client computes "today" from the **device's** local date (`TaskParts`, `Home`). A person travelling sees a different "today" from their flat.
- The reminder job uses `settings->>'timezone'`, falling back to `Pacific/Auckland`. **Nothing validates that value:**
  - Owners can write `settings` directly (`grant update (name, address, settings)`).
  - One invalid zone string makes `at time zone` throw. Because the job loops over all flats in one transaction, every flat's reminders would stop.
  - Reproduced in `phase10_verification.sql` by bypassing the new guard. Fixed in Phase 10 (validation on write, plus a reader that can't fail).
- No UI shows or sets a flat's time zone. All production flats currently fall back to Auckland.

## 5. Data-scope findings (database)

- **Room references are validated:**
  - Task rooms: trigger `household_tasks_guard`.
  - Room covers: composite foreign key (Phase 9).
  - Item rooms: composite foreign key.
- **Host and assignee references:** composite keys to `household_members`.
- **Calendar sources:** both date sources live in household-scoped tables under RLS, which `rls_verification.sql` already covers.
- **Row limits:** `LivingProvider` loads open tasks without a limit, and `ShoppingProvider` loads every purchase for the flat. PostgREST's default 1,000-row cap could silently truncate either in a very large flat. Phase 10's calendar therefore runs its own week-bounded queries rather than relying on those reads.

## 6. Baseline evidence

- **Screenshots:** `reports/screenshots/p10-before-{iphone,small,desktop}-{home,menu,tasks,shopping,invite}.png` (the menu at phone sizes only; desktop shows the sidebar).
  - Data: Flat A "Our Flat" and Flat B "Harbour Street", both with a "Kitchen", different items and tasks.
  - Generated by `tests/browser/phase10-screenshots.spec.ts` with `SHOT_PREFIX=p10-before`. All data is synthetic.
- **Reproductions:** `tests/browser/phase10-baseline.spec.ts` (`BASELINE=1`), all 3 reproducing at baseline:
  1. An already-member invite opens the last-used flat.
  2. The flat choice is one browser-wide key.
  3. The menu offers no way to see or switch flats.
- **Two-flat fixture layer:** `tests/browser/multiFlat.ts` serves Flat B (and the invite RPCs) on top of the single-flat fixture.

## 7. Issues to fix in Phase 10

1. The active flat is a device-wide preference. Make it per account, migrate the legacy key once, and validate against memberships.
2. There is no flat switcher, and no chooser when there is no valid preference.
3. An already-member invite opens the wrong flat.
4. Switching relies on mutating one provider instance. Remount all household-scoped state per flat, and clear module caches.
5. Links can't name a flat. Add `?flat=<id>` resolution after login and membership validation, with a generic "not available" state.
6. Unvalidated flat time zone (reminder job fragility). There is also no per-flat "today".
