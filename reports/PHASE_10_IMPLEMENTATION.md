# Phase 10: the shared week

**Implementation report.** Developed on `phase-10-shared-week` from `79f0cb3`. **Status: released on 18 November 2026** with the owner's approval at each step (§12). PR https://github.com/JayJett/Flat-Quest/pull/11 was merged as `651cead`. Production migration `20261118004453_shared_week`. Deployed to https://jayjett.github.io/Flat-Quest/.

Companion documents:
- `reports/PHASE_10_BASELINE.md`
- `reports/PHASE_10_HOSTING_AND_APP_STORE.md`

## 1. Executive summary and scope completed

| Part | Delivered |
|---|---|
| A. Discovery and baseline | Baseline report; two-flat fixture layer; 15 baseline screenshots; 3 reproductions of the gaps (all confirmed) |
| B. Accounts and multiple flats | "Your flats" switcher (menu and desktop rail); chooser; per-account remembered flat with one-time legacy migration; add or join another flat; the invite opens exactly the invited flat; `?flat=` links resolved after sign-in and membership checks; generic "not available" state; Back across a switch; access loss handled; unsaved-draft guard |
| B. Isolation | Each flat is a remount boundary (data, subscriptions, providers, sheets, caches); media and cover caches cleared; late answers discarded; the database rejects cross-flat references |
| C. Shared week | `/calendar` (from Home and the menu): Monday–Sunday in the flat's zone; week in the URL; tasks, deliveries, pickups and appointments; overdue marking; partial-failure, empty and loading states; source links |
| C. Time zones | A validated IANA zone per flat (owner setting plus a suggestion at creation); flat-local "today" and week; reminders hardened against bad zones |
| D. Appointments and coverage | Additive migration; guarded RPCs with revisions; idempotent create; claim and release; reschedule reopens coverage (with confirmation); cancel is recorded; cleanup on host or room removal; live updates |
| E. Mobile and accessibility | 320 × 568 checks, 44px targets, labelled controls, text-based status, reduced motion |
| F. Hosting and App Store | Environment plan, abuse audit, costs at three sizes, data and support decisions, recovery, iOS path and checklist |
| G. Data preservation | Populated-database rehearsal: no existing row changed; rollback guarded by export, restores exactly, re-apply passes |
| H. Verification | Database suite (61), race script (8 new checks), unit tests (21), browser tests (34 × 2 projects), full regression, screenshots |

## 2. Reviewed baseline and the multi-flat issues found

The baseline at `79f0cb3` was green: lint, typecheck, 140 unit tests, the build, 194 browser tests (2 opt-in skips), and every database suite. Issues confirmed, each with a reproduction (`tests/browser/phase10-baseline.spec.ts`, `BASELINE=1`):
1. **The active flat was one device-wide key** (`flatquest.activeHousehold`), shared by every account on the device.
2. **No switcher or chooser:** a second flat could only be reached through an invite.
3. **An already-member invite opened the last-used flat**, not the invited one (`p10-before-repro-invite.png`).
4. **Switching mutated one provider instance**, so nothing guaranteed that every household-scoped cache and subscription reset.
5. **Links couldn't name a flat.**
6. **An unvalidated `settings.timezone`:** one bad value would have made every run of the reminder job fail, for every flat. Production currently has no stored zones, so nothing was affected.

## 3. Selection, onboarding, invite and link behaviour

Design: `src/household/MembershipProvider.tsx` (account level), `src/household/activeFlat.ts` (pure resolution) and `src/auth/guards.tsx` (`RequireHousehold`).

**How the open flat is chosen, in order**
1. The flat chosen in this session (switcher, invite, new flat, link).
2. The account's remembered flat, `flatquest.activeHousehold.<userId>`.
3. The legacy device-wide key, **only if it names one of this account's flats**. It is then copied to the account key and removed.
4. The only flat.
5. Otherwise the chooser (`/flats`).

All storage access is optional: if storage is blocked, the person simply chooses again. A choice is never trusted on its own; it must match a current server-backed membership.

**Creating, joining, and the menu**
- **No flats:** the create-or-join screen (unchanged).
- **One flat:** straight to Home.
- **New flat** (`/welcome?add=1` from the menu):
  - The form suggests the device's zone (editable).
  - Creating selects the new flat; its data loads before Home renders.
- **The 5-membership creation cap** (existing) shows a clear message. Joining is limited only by the flat's member limit (unchanged).
- **Invites:** joining or "You're already in. Open it" both call `accept_household_invite`. For an existing member it returns the flat without using up the invite, and the app then opens **that** flat. No database change was needed.
- **Switching** (`FlatSwitcher`):
  - The current flat is marked by text and a check, with `aria-current`.
  - Another flat opens its Home. Sheets, drawers and route parameters from the old flat disappear with the remount.
  - If something typed is unsaved (quick add, flat details), a confirmation offers **Stay here** (back to the draft) or **Discard and switch**.
  - On phones the menu is reached from the top-level screens (sub-screens show Back), the same as the existing navigation.
- **Back across a switch:**
  - Each history entry records its flat in place (`history.replaceState`, so the URL never changes).
  - Back to an entry from the other flat reopens that flat, still only while you're a member.
  - A remembered flat you've since lost is ignored, and the entry shows your current flat.

**Links**
- `flatLink(path, flatId)` adds `?flat=<id>` to any route. The calendar uses it for every source link and for "Copy link" on an appointment.
- On load, the guard:
  - waits for authentication and memberships;
  - opens the named flat if you're a member;
  - otherwise shows "This flat isn't available", which never names the flat (malformed ids included);
  - only then renders content.
- `?flat=` survives `RequireAuth`'s `?next=` round trip and `safeNext` (internal paths only).
- Bookmarks without `?flat=` behave as before.
- Pages' `404.html` (unchanged) restores the full path and query.

## 4. Household isolation and access revocation

- **A remount boundary per flat:** `UserScopedHouseholdProvider` = `MembershipProvider key={user}` → `HouseholdProvider key={activeFlatId}`. Everything household-specific lives inside it, so a switch unmounts it all and drops its subscriptions:
  - household data and the `household:<id>` channel;
  - `NotificationProvider` (inbox and badge per flat);
  - `LivingProvider`;
  - `ShoppingProvider`;
  - search;
  - calendar data and the `calendar:<id>` channel;
  - the tour, open sheets and drafts.
- **Late answers** to requests from the previous flat land in unmounted components and are dropped. Tested: Flat B's responses held, switched back to Flat A, then released. Flat A showed none of Flat B's tasks or its unread badge.
- **Media:**
  - On leaving a flat, the signed-URL cache and the room-cover cache are cleared.
  - Requests already in flight are discarded by the cache's generation check.
  - **Residual risk:** signed URLs already issued stay valid for up to their 1-hour lifetime. Storage RLS refuses new ones (a real Storage check is in the CI script, §8).
- **Revocation:**
  - A Realtime removal event, an access error on load (`PGRST116` / `42501`), returning to the app, or coming back online all re-check memberships.
  - If the open flat is gone, the person sees "You no longer have access to <name>" (the name was already theirs to see) and moves to their other flat, the chooser, or onboarding.
  - A network failure shows "Try again", not a removal.
  - The server enforces access regardless (RLS).
- **Database:**
  - Appointment rooms and hosts use household-scoped composite foreign keys.
  - `save_appointment` checks the room's flat, derives the actor from `auth.uid()`, checks membership inside the transaction, and refuses moving an appointment between flats.
  - Tested in SQL across two flats, including a person in both.

## 5. Calendar interactions and source rules

- **Route:** `/calendar?week=<any date in the week>` (normalised to Monday; invalid values mean this week).
- **Navigation:** Previous, This week and Next, as URL entries so Back steps through weeks.
- **Days:** grouped Monday–Sunday, with "Today" in the flat's zone.
- **Ordering:** date-only entries come first, labelled **Due** for tasks, **Expected** for deliveries and pickups, and **All day** for appointments. Timed entries follow, by start. Ties sort by kind, then title, then a stable key.
- **Labels:** each entry carries a kind label (Task, Delivery, Pickup, Appointment). Overdue open entries say **Overdue** in text.

| Entry | Included when | Opens | Key |
|---|---|---|---|
| Task | `due_on` in the week, status `todo`/`doing`, not archived | `/tasks?task=<id>&flat=<flat>` | `task:<id>` |
| Delivery / pickup | `expected_on` in the week, not arrived, item incomplete and `ordered`/`on_the_way`/`ready_to_collect`. **Pickup** if the method is pickup or the item is ready to collect. Shows "Sorted by <coordinator>" | `/rooms/<room>?item=<id>&flat=<flat>` | `purchase:<itemId>` |
| Appointment | Active (not cancelled), and its local day (all-day date, or start in the flat's zone) in the week | Appointment sheet | `appointment:<id>` |

- **Data** (`src/calendar/useWeek.ts`):
  - Week-bounded, household-scoped queries, paged in 500s (max 2,000 per source), so the API's 1,000-row cap can't hide records.
  - Appointments are read with a ±2-day margin, so a flat zone change can't lose one.
- **Freshness:**
  - Source changes reach the agenda through the existing providers' live subscriptions, which trigger a refetch.
  - Appointments have their own channel.
  - A reconnect, or coming back online, refetches.
- **Failures:** each source reports its own failure ("Appointments couldn't load. The rest of the week is shown." with Try again).
- **Empty week:** "A quiet week", with Add an appointment.

## 6. Appointment schema, RLS, grants, indexing and concurrency

Migration: `supabase/migrations/20261118004453_shared_week.sql` (the version recorded in production). Rollback: `supabase/rollback/20261118004453_shared_week_down.sql`.

**`calendar_appointments`**
- `id` is the client's per-draft UUID.
- Other columns: `household_id`, `title` (1–80 characters, trimmed), `notes` (≤500), `room_id`, `all_day`, `scheduled_on`, `starts_at`/`ends_at` (end after start, ≤24 h), `needs_cover`, `host_id`, `created_by`, `cancelled_at`/`cancelled_by`, `revision`, and timestamps.
- Rules:
  - `host_id` requires `needs_cover` and no cancellation.
  - Room: composite FK to `rooms(id, household_id)`, `on delete set null (room_id)`.
  - Host: composite FK to `household_members(household_id, user_id)`, `on delete set null (host_id)`.
- Indexes:
  - `(household_id, scheduled_on) where cancelled_at is null`;
  - room;
  - `(household_id, host_id)`;
  - `created_by`;
  - `cancelled_by`.

**Access and writes**
- **RLS:** members read. `revoke all` from `anon` and `authenticated`, then `grant select`. **No direct insert, update or delete** (tested).
- **Revision trigger:** every effective change bumps `revision` and `updated_at`, including the database's own cleanup when a host leaves or a room is deleted (tested).
- **`save_appointment`** (SECURITY DEFINER, `search_path=''`):
  - Validates title, notes, day, time pair, room and flat.
  - Resolves times in the flat's zone (`private.local_instant` refuses non-existent and ambiguous times).
  - **Create:** `insert … on conflict (id) do nothing`. A retry returns the original; someone else can't reuse the id.
  - **Edit:** row lock, creator-or-owner check, then the expected-revision check. A change of slot, or no longer needing cover, clears the host in the same statement.
- **`set_appointment_cover(id, expected_revision, 'claim'|'release')`:**
  - Row lock. Exactly one host.
  - A repeated tap by the host is harmless. A claim against an older revision is refused.
  - Only the host can release.
- **`cancel_appointment`:** recorded (`cancelled_at`, `cancelled_by`), and clears the host. Requires the current revision; repeating it is harmless.
- **Realtime:** the table is published to `supabase_realtime`; members receive changes under RLS.

**Concurrency** (separate connections, `coordinator_race.sh`, all passing):
- 8 simultaneous submissions of one draft: 1 row.
- 12 simultaneous claims by two people: only the winner's 6 taps succeed, one host.
- Claim racing a reschedule over 6 rounds: exactly one wins, and no one covers a slot they didn't see (both orders were exercised: the move won 2, the claim won 4).
- Claim racing removal from the flat: the removal succeeds, and the removed member neither covers nor sees the appointment.

**Client behaviour**
- "I can be home" waits for the server's confirmation before saying the slot is yours.
- **On a conflict**, the form shows the other version and offers "Use their version" or "Keep my changes" (a fresh review before retrying).
- **On an unclear network failure**, it checks the server by id before reporting failure. A lost create response is confirmed, never duplicated.
- **Offline**, it refuses locally and keeps the draft.

## 7. Dates, time zones and compatibility with reminders

- Each flat has `settings.timezone`, validated on every write (`households_settings_guard`, `set_household_timezone`, owner only).
  - Other settings keys are preserved (tested).
  - Flats without a valid zone behave as **Pacific/Auckland**.
- **Civil dates** (task due, delivery expected, all-day appointment) are never converted: "Friday" is Friday everywhere.
- **Timed appointments** store real instants, resolved in the flat's zone. They display in the flat's current zone, with the zone shown in the form and details.
- **Changing the zone** keeps booked instants and the volunteer (tested). Local times follow, with an end date shown if an appointment then crosses midnight.
- **"Today" and "this week"** use the flat's zone, refreshed every minute and on focus or visibility. A device in Los Angeles sees the Auckland flat's week and times (browser test with `timezoneId: America/Los_Angeles`).
- **Daylight saving:** unit tests cover Auckland and Los Angeles transitions (non-existent and ambiguous times), and the same rule is enforced server-side.
- **Reminders:** `private.send_reminders` is unchanged except that it now reads `private.household_zone(settings)`, which can't throw. A legacy invalid value can no longer stop reminders for every flat (tested). Phase 8 (30) and Phase 9 (27) reminder suites pass on the new schema.

## 8. Mobile, accessibility and Realtime evidence

**Mobile and accessibility**
- **320 × 568:** no horizontal overflow on the calendar or the form. Previous, Next and Add are at least 44px. A long title wraps. The form's submit button is reachable (browser test).
- **Standard iPhone (390 × 844):** every Phase 10 browser test runs at this size.
- **Labels and status:** form controls have visible labels. Switches use `role=switch` with names. Status is always written ("Needs someone home", "Overdue", "Current flat"), never colour alone. The "needs someone" surface uses the existing accent-soft token (no new colours).
- **Reduced motion:** the whole Phase 10 spec also passes in the reduced-motion project.
- **Real devices:** **no physical-device testing was possible in this environment.** All mobile evidence is emulated (Chromium viewport). WebKit (small-iPhone project) isn't installed locally and runs in CI.

**Realtime and Storage, not yet run.** Real Realtime and Storage checks were written in `scripts/verify-connected-living.mjs`. They cover:
- a new appointment arriving live;
- a retried create not duplicating;
- a volunteer reaching the other session;
- a second volunteer being refused;
- a reschedule reopening coverage live;
- a claim against the old slot being refused;
- an outsider neither seeing nor claiming;
- a direct write being refused;
- a flatmate's other flat never leaking;
- after removal, the old session getting no further changes and no new signed photo links.

**They have not run yet:**
- This container could start Docker and the Supabase CLI (2.81.3, as in CI), but the network policy blocks the stack's container images (403).
- They will run in CI's "Local database access tests" job once a push is approved.

## 9. Data preservation, environment isolation and recovery rehearsal

`supabase/tests/rehearse_phase10.sh` builds a **populated** Phase 9 database (synthetic data: 2 flats, members, 41 items, assignees, options, preferences, coordinator, purchase, wishlist and votes, a comment with a mention, an essential being fetched, tasks, preferences, an invite, a Visual Home photo used as a room cover, reminders and notifications). It then:
1. Fingerprints **26 tables** in `public` and `private` (row count + md5 of all rows).
2. Applies Phase 10. **Result: identical fingerprints. No existing row changed.**
3. Checks that a legacy flat without a zone reads as Auckland, and that the reminder job runs on the new schema.
4. Runs the earlier suites on the same populated data, before and after the migration. **The results are identical:**
   - Phase 6: 71 checks pass, before and after.
   - Phase 7: 61 checks pass, before and after.
   - Phase 9: 27 checks pass, before and after.
   - Phase 8: stops after its 20th check, at the same point before and after. That suite assumes an otherwise empty database, and counts reminders across all flats. It passes 30/30 on the empty CI and local databases.
5. Runs the Phase 10 suite: **61 checks** pass on the populated data.
6. Rollback without a confirmed export: **refused**. After an export to CSV, rollback: **the exact Phase 9 data is restored**. Re-apply: passes.

**Environment isolation**
- Local, CI and browser tests never contact the hosted project:
  - fixtures route every `*.supabase.co` request;
  - the scripts refuse non-local hosts.
- The only hosted access in Phase 10 was one read-only query (database and media size, zone validity) for the cost estimate.

**Recovery procedure**
- **Preferred:** revert the frontend and keep the additive schema and any appointments.
- **Only if the schema itself must go:** export `calendar_appointments`, then run the rollback with the confirmation flag (tested).

## 10. Automated results, visual evidence and checks still outstanding

Final local run on the finished diff:

| Suite | Result |
|---|---|
| Lint, app typecheck, test typecheck | Clean |
| Vitest | 12 files, **161 passed** (140 existing + 21 Phase 10) |
| Playwright desktop-chromium + reduced-motion | **262 passed**, 8 skipped (opt-in screenshot and baseline specs), 0 failed. Includes `phase10.spec.ts`: 34 tests × 2 projects |
| SQL (`run_local.sh`) | RLS 163 rows; Phase 5 complete; Phase 6 71, Phase 7 61, Phase 8 30, Phase 9 27, **Phase 10 61** |
| Races (`coordinator_race.sh`) | **22/22**, including 8 new Phase 10 checks |
| Rollback round trip, populated rehearsal | Passed (§9) |

**Regressions found and fixed during Phase 10**
1. Recording the flat on a history entry by navigating re-added a one-off `?item=` that the page had just consumed. It now writes the entry's state in place. Five earlier deep-link tests caught this, and all pass now.
2. After losing access, the entry's remembered flat produced "not available" instead of falling back. Remembered flats are now ignored once you've left them.
3. "Stay here" on the draft confirmation left the menu covering the draft. It now closes the menu.

**Visual evidence** (`reports/screenshots/`, synthetic data, Chromium emulation)
- **Before:** `p10-before-{iphone,small,desktop}-{home,menu,tasks,shopping,invite}` and `p10-before-repro-invite`.
- **After:**
  - The same screens.
  - `calendar`, `calendar-full` (every entry type), `calendar-empty`.
  - `appointment-form`, `appointment-covered`, `appointment-reopen-confirm`, `appointment-rescheduled`.
  - `flat-chooser`, `menu-flats`, `new-flat`.

  Each is captured at 320 × 568, 390 × 844 and desktop (the menu at phone sizes only).
- **Compared with the baseline:**
  - Home is unchanged, apart from a "This week" link below Furnishing progress, which stays first.
  - The menu gains "Your flats" and "Calendar".
  - Shopping and Things to do are unchanged.

**Still outstanding (needs CI or hardware)**
1. Small-iPhone WebKit browser project (CI).
2. Real Realtime and Storage checks (CI, §8).
3. Physical iPhone testing (none done).
4. A production read-only verification after an approved migration.

## 11. Hosting and App Store milestones, dependencies, costs and owner decisions

See `PHASE_10_HOSTING_AND_APP_STORE.md`.

**Milestones**
1. Staging project.
2. Production SMTP and abuse controls.
3. Account-deletion policy, then an in-app flow.
4. Custom domain and Universal-Link invite URLs.
5. Capacitor proof of concept on a physical iPhone.
6. App Store checklist and TestFlight.

Each is a separately approved milestone. Native packaging, Apple provider setup, push, public account deletion, monetisation and store submission are explicitly out of Phase 10.

**Costs:** about US$35/month for a private beta, US$45–65 at 100 flats, and US$75–95 at 1,000 flats. Assumptions and pricing caveats are in the report; confirm on the vendors' pages.

**Owner decisions:** staging tier; email provider and domain; custom domain; deletion policy and the sole-owner rule; per-person membership cap and per-flat storage quota; Apple account holder; media backup destination.

**Known limitations kept for later**
- No notifications yet when an appointment needs someone or coverage changes.
- A toast from a save still in flight in the previous flat can appear after switching (it describes the original action).
- On phones, the flat switcher is reached from top-level screens.

## 12. Proposed release steps (approval needed for each)

| # | Action | Hosted? | Approval |
|---|---|---|---|
| 1 | Review this diff and the evidence | No | **Your review** |
| 2 | Commit to `phase-10-shared-week`, push, open a draft PR. CI runs WebKit and the real Realtime and Storage checks | GitHub only | **Approve commit and push** |
| 3 | Fix anything CI finds; re-run | GitHub only | Covered by step 2 |
| 4 | Read-only "before" snapshot of production (counts and fingerprints, as in Phase 9) | Read-only | **Approve** |
| 5 | Apply the migration to production via the Supabase connector (additive: a validation trigger, 2 RPCs plus the time-zone RPC, a new table, and a reminder function using the validated zone). Then a read-only verification and the security advisor | **Yes** | **Approve the hosted migration** |
| 6 | Rename the migration and rollback to the recorded production version; push; CI | GitHub only | Covered by step 2 |
| 7 | Mark the PR ready and merge to `main`, which publishes the web app to GitHub Pages | **Yes (web release)** | **Approve the merge / web release** |
| 8 | Verify the Pages deployment status; write the final report entry | Read-only | — |
| 9 | Any iOS or TestFlight work | — | **A separate decision and milestone** |

The backend goes first, and the frontend second: the Phase 9 web app ignores the new table and functions, so step 5 is safe before step 7. To undo step 7, revert the merge (Pages republishes the previous build) and keep the schema and any appointments.

## 13. Release record (18 November 2026)

| Step | Evidence |
|---|---|
| Commit and push (approved) | `6bfbe1a` on `phase-10-shared-week`; draft PR https://github.com/JayJett/Flat-Quest/pull/11 |
| First CI run | The real Realtime and Storage job **passed: 42 checks**, including every Phase 10 one (live appointment sync, single volunteer, a reschedule reopening coverage, flats kept separate, a removed member receiving no further changes and no new signed photo links). The small-iPhone WebKit project passed except for one older Phase 6 test |
| CI fix | `0b149cb`. The Phase 6 drawer test seeded "today" notifications 30 minutes back, so it failed in the half hour after midnight UTC. Reproduced at a simulated 00:10 UTC (expected 2, got 1), fixed and re-verified. CI then went fully green |
| Production snapshot (read-only) | 1 flat, 3 members, 11 rooms, 108 items, 24 photos, 65 events, 54 notifications; md5 fingerprints of households, members, rooms, items and photos; 3 active scheduled jobs |
| Production migration (approved) | Applied through the Supabase connector and recorded as `20261118004453` |
| Post-migration verification (read-only) | Every count and fingerprint identical. The appointments table has RLS and is in the Realtime publication, with no direct insert or update by signed-in users and no anonymous access. Private helpers are not executable by signed-in users. 3 jobs active. The flat reads as Pacific/Auckland. The advisor adds only the 4 intended member-checked RPCs |
| Rename | `17c6eee`: migration and rollback renamed to `20261118004453`; CI green |
| Merge (approved) | PR #11 merged as `651cead` |
| Deploy | Main run 44211928634: Check and build, Local database access tests and Publish all succeeded. Pages deployment for `651cead` at 01:06 UTC: **success** |

**Not done.** No physical-iPhone testing was possible. The live site can't be opened from this environment (its network policy blocks `jayjett.github.io`), so the release is verified through GitHub's deployment status.

