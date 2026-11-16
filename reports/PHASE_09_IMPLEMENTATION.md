# Phase 9 — Feels like home: implementation report

Delivered on 16 November 2026.
- PR: https://github.com/JayJett/Flat-Quest/pull/10, merged as `f791f9f`.
- Production: https://jayjett.github.io/Flat-Quest/
- Production migration: `20261116093718_feels_like_home`.

Phase 9 stops here. Nothing from Phase 10 was started.

## 1. Executive summary

- **Room personality.** Every room can now have a shared cover photo and a short description (120 characters or fewer).
  - The cover is chosen from that room's own Visual Home. No upload system was added and no file is copied.
  - The database guarantees that a cover belongs to the same room in the same flat. Deleting the photo quietly returns the room to its colour.
- **Design audit.** All seven issues observed in the before-screenshot audit (`PHASE_09_DESIGN_AUDIT.md`) are fixed and verified. The most important fix: on a 320 × 568 phone the first checklist item is fully visible, with or without a cover.
- **Motion.** Progress bars and image fades follow Playful, Balanced and Minimal. The OS reduced-motion setting always wins.
- **PWA.** The manifest gains an identity and shortcuts. The service worker updates promptly. iPhone users get a quiet how-to in Settings.
- **Reminders.** The Phase 8 edge case is fixed: a task never receives two reminders in one run.
- **Bug fix.** A scroll-timing bug that CI exposed in WebKit was also fixed (§8).

## 2. Design audit and outcome

The baseline was captured before any change: 14 screens at 3 sizes, using synthetic data. It is recorded in `reports/PHASE_09_DESIGN_AUDIT.md`. That file lists only observed issues; its new **Result** column records how each was fixed and verified.

| # | Finding | Result |
|---|---|---|
| 1 | No checklist item in the first screen at 320 × 568 | Fixed, with a browser test |
| 2 | Four icon actions in the room header | Fixed: Back plus three icons. Personalise is a labelled button |
| 3 | Disabled primary buttons were a washed-out accent (1.85:1) | Neutral grey with muted ink; tested in all five accents |
| 4 | Essentials suggestion chips flashed on load | Suggestions wait for data; tested with a held request |
| 5 | Accent swatches wrapped at 320px | Five fit on one row; tested |
| 6 | 15 different loading renderings | Shared static skeleton rows on list screens |
| 7 | Chip rows cut off with no hint they scroll | Trailing-edge fade |
| 8 | No room personality | Delivered (§3–4) |

Deliberately unchanged: Home (Furnishing progress is still first, and Room by Room is still absent), the notification drawer, Search, Wishlist, Visual Home, Shopping and the bottom navigation (still exactly four tabs).

## 3. Room personality — user experience

**Room header (`src/rooms/RoomHeader.tsx`)**
- **With a cover:** the photo sits in a band above the room's colour, and the name, description and progress sit on the colour. Text never sits over the photo, so contrast doesn't depend on the image and no scrim or gradient is needed.
- **Without a cover:** a refined, more compact version of the familiar colour tile.
- The band is 60px on small phones and up to 208px on desktop.
- If the image can't load (deleted, offline or expired), the header falls back to the colour layout. It never shows a broken image.
- A labelled **Personalise** button (accessible name "Personalise room") replaces the old pencil icon.

**Personalise sheet (`src/rooms/PersonaliseRoomSheet.tsx`)**
- A live preview.
- A grid of the room's Visual Home images (photos first, then inspiration), plus a "No cover" choice.
- A description field with a counter.
- Save states: Save → Saving… → ✓ Saved. On error the sheet stays open with a clear message.
- Only changed fields are sent, so a stale sheet can't undo a flatmate's edit.
- **No photos yet:** a friendly explanation and an "Open Visual Home" link.
- "Name, colour and measurements" opens the existing room editor.

**Rooms tab:** tiles with a cover show it in their upper half. Tiles without a cover are unchanged.

## 4. Data model and backend design

**Migration:** `supabase/migrations/20261116093718_feels_like_home.sql`. It is additive.

| Change | Detail |
|---|---|
| `rooms.description` | `text`, `check (char_length(description) <= 120)`. Trimmed, whitespace collapsed, empty → null |
| `rooms.cover_visual_id` | `uuid` |
| Foreign key `rooms_cover_same_room` | `(cover_visual_id, id, household_id)` → `room_visuals (id, room_id, household_id)`, `on delete set null (cover_visual_id)`. The database itself enforces same room and same flat |
| Trigger `rooms_personality_guard` | SECURITY DEFINER, `search_path=''`, execute revoked. Rejects link-only ideas that have no image, and returns a friendly 23514 error for a cover from another room or flat |
| Index | Partial index on `cover_visual_id` |

**Behaviour of the reference**
- Covers reference Visual Home rows, so the media-cleanup worker is untouched: the files are still referenced by their Visual Home rows.
- Deleting a room still cascades as before. This was tested with a cover set.

**Realtime and signed URLs**
- Rooms were already in the Realtime publication, with table-level UPDATE for members under the existing RLS policies.
- Images use the existing private signed-URL path (`useSignedUrl`), which refreshes every 50 minutes and on return or reconnect.
- Cover lookups are batched and cached by visual id, and the cache is cleared on sign-in and sign-out.

## 5. Reminder reliability fix

**The edge case.** In Phase 8, a task already 3 or more days overdue when it first became eligible got both stage 1 and stage 2 in the same run.

**The fix.** `private.send_reminders` now picks one stage per task per run, based on age.
- Choosing stage 2 records stage 1 as handled, so the first nudge can never arrive afterwards.
- Idempotency is unchanged: the `reminders_sent` primary key plus `on conflict do nothing`.
- The essentials loop is unchanged.

**Tested, all in `phase9_verification.sql`:**
- 1 day overdue → stage 1.
- 4 days overdue with no prior reminder → exactly one reminder, stage 2, and stage 1 is never sent later.
- First reminder already sent → one follow-up later.
- Changed due date → a fresh cycle with one nudge.
- Unassigned, done or archived tasks → none.
- A repeated run → 0.
- Muted reminders are respected.
- Only the scheduler can execute the function.

**Concurrency** (`coordinator_race.sh`): 8 simultaneous runs → none fail, and exactly one reminder per overdue task.

## 6. Polish details

- `Button` primary and ink variants, and the discussion send button: `disabled:bg-surface-3 disabled:text-ink-3`.
- `EssentialQuickAdd`:
  - Suggestions render only when `useLiving().status === 'ready'`.
  - Their height is reserved meanwhile, so nothing jumps.
- Accent swatches:
  - A five-column grid, with 44px circles below 380px.
  - Long names ("Electric Blue") wrap instead of truncating.
- `.chip-scroll`: a 28px trailing mask on the Essentials suggestions and the task who/when rows.
- `SkeletonRows` (`ui.tsx`):
  - Static, with no shimmer and no perpetual animation.
  - `role="status"` with a label.
  - Used on Essentials, Things to do, Activity, Home's "Around the flat" and restock history.
  - Spinners remain only inside sheets and for full-screen waits.
- Room screen:
  - Filter and sort share one row. Sort is a 48px control that shows when it isn't the default.
  - Spacing was tightened for small phones.

## 7. Motion

- New level-aware transitions in `src/motion/motion.ts`:
  - `PROGRESS` (0.8s, 0.7s and 0.3s, or instant with reduced motion).
  - `IMAGE_FADE` (0.35s, 0.35s and 0.2s, or instant).
- They are used by `ProgressBar` (Home's Furnishing progress), the room header bar and cover images.
- The OS reduced-motion setting maps to `reduced` before the personal preference is consulted, so the OS always wins.
- A completed room shows a quiet check next to "All set".
- The existing 100% confetti still fires only from your own save (`updateItem`). Changes arriving by Realtime never celebrate.
- Save states in the Personalise sheet cross-fade.
- Nothing loops.

## 8. Bug found and fixed during CI

**Symptom.** WebKit CI showed two "Activity" headings after opening Activity from far down Home.

**Root cause.** `PageHeader`'s scroll check runs as a child effect, before `AppShell`'s scroll-to-top effect. So for a moment a new screen believed it was scrolled and showed its compact title too.

**Why it surfaced now.** It existed before, but Activity's old spinner page was short enough that the browser clamped the scroll. The new skeleton exposed it.

**The fix.** New screens now reset the scroll in a layout effect, before any effect reads it. Back navigation still restores the previous position (the Phase 6 and Phase 8 tests pass), and a regression test was added.

## 9. PWA and mobile

**Manifest**
- `id: "./"`, `lang: "en-NZ"`, `dir` and `categories`.
- Shortcuts to Essentials, Things to do and Rooms.

**Service worker**
- Calls `skipWaiting()` after caching, so an update takes over without waiting for every tab to close.
- The cache name was bumped to `flatquest-offline-v2`; the old cache is deleted on activate.
- It still caches **only** the generic offline page. Navigations are network-first. No private data, signed photo URLs or API responses are cached.

**Not added:** push notifications, background sync and install pop-ups.

**iOS hint** (`src/components/InstallHint.tsx`)
- A short "Add to Home Screen" how-to inside Settings.
- Shown only in iPhone or iPad Safari, and never once installed or in other browsers.
- Unit tested.

**The icon** is unchanged; the audit found it on-brand.

## 10. Security and privacy

- **RLS:** `rooms` RLS is unchanged and still on. No new table was needed. Room updates remain household-scoped by the existing policies.
- **Cover references** are validated server-side twice: by the composite foreign key, and by the guard trigger, which runs even for the table owner.
- **Cross-household media:**
  - Outsiders can't see another flat's `room_visuals`, so they can't learn a cover's path.
  - A cover can't point at another flat's image (database test and real Realtime test).
- **Private images stay private:** short-lived signed URLs from the private bucket, with no public URLs.
- **Least privilege:** `room_personality_guard` and `send_reminders` have execute revoked from `public`, `anon` and `authenticated` (verified in production).
- **Account switching:** the cover-path cache and the signed-URL cache clear on sign-in and sign-out. Member removal is unchanged and still verified by the Realtime suite.
- **Secrets:** no service-role key in the frontend. No credentials were committed.
- **Advisors:** the production security advisor after the migration lists only the same notices as before Phase 9: intended RPCs, policy-less private tables, `pg_net` in public, and leaked-password protection. Nothing new.

## 11. Data preservation (production)

A read-only snapshot was taken before and after the migration:

| | Before | After |
|---|---|---|
| Households / members | 1 / 3 | 1 / 3 |
| Rooms / items | 11 / 108 | 11 / 108 |
| Visual Home images | 24 | 24 |
| Rooms fingerprint (md5 of id, name, icon, colour, order) | `a8e1ab87…` | `a8e1ab87…` (identical) |
| Rooms with a cover or description | n/a | 0 (new columns start empty) |
| Scheduled jobs active (media cleanup, retention, reminders) | 3 | 3 |

- No production data was reset, reseeded, overwritten or deleted.
- No photos were touched.
- Recovery snapshots (`private.phase4_pre_*`, `phase6_pre_*`) were left in place.
- The media-cleanup and notification-retention systems were not modified.
- No destructive operation was run against real members or records. All destructive tests used synthetic fixtures in disposable databases.

## 12. Rollback

- **Script:** `supabase/rollback/20261116093718_feels_like_home_down.sql`.
  - Drops the trigger, function, constraint, index and both columns.
  - Restores the Phase 8 `send_reminders` exactly as shipped.
  - Photos remain in Visual Home.
- **Round trip tested locally:** rollback → Phase 8 suite 30/30; re-apply → Phase 9 suite 27/27.
- It is not run in production.

## 13. Realtime and concurrency testing

**Real Realtime with independent signed-in sessions** on a local Supabase stack in CI (`scripts/verify-connected-living.mjs`). Seven Phase 9 checks were added:
- A cover and description reach a flatmate live.
- A photo from another room is refused (23514).
- A photo from another flat is refused.
- An outsider cannot change the room.
- Deleting the cover photo clears the cover live and keeps the description.
- The outsider receives no room changes from the flat.

**Concurrency:** simultaneous reminder runs (§5), alongside the existing claim, selection, preference and essentials races.

## 14. Test results

**Local**
- Lint and typecheck: clean.
- Unit (Vitest): 11 files, **140 passed**, including 5 new install-hint tests.
- Browser (Playwright, desktop-chromium and reduced-motion): **192 passed**, 2 skipped (opt-in screenshot specs). The suites touched by the scroll fix were re-run after it (Phases 3, 6, 8 and 9): 105 passed.
- Database (Postgres 16, `run_local.sh`):
  - RLS: 163 rows.
  - Races: 14/14, including the 2 new reminder checks.
  - Phase 5: complete. Phase 6: 71, Phase 7: 61, Phase 8: 30, **Phase 9: 27**.
- Rollback round trip: passed.

**CI on the final head `550f425`:** "Check and build" (lint, unit, build, Playwright in all three projects, including small-iPhone WebKit) **success**, and "Local database access tests" (local Supabase stack: all SQL suites, races, storage isolation and Realtime) **success**.

**CI on main `f791f9f`:** all three jobs succeeded, including Publish.

One CI failure occurred along the way, on `19fc0a4`: the WebKit heading test. It was root-caused and fixed (§8), not retried.

**New browser tests** (`tests/browser/phase9.spec.ts`, 15):
- Choosing a cover and description sends only those fields.
- Changing or removing a cover, and nothing is sent when nothing changed.
- A room with no photos links to Visual Home.
- A refused save explains itself.
- An image that can't load falls back to the colour.
- A flatmate's change appears after sync, and a deleted photo clears the cover.
- The room editor stays reachable.
- The first row is visible at 320 × 568, with and without a cover.
- The header has three icon actions, with filter and sort on one row.
- Disabled buttons in all five accents.
- No suggestion flash.
- Swatches on one row.
- Manifest identity and shortcuts, with no install pop-up.
- New screens open at the top.

## 15. Screenshots

- **Before:** `reports/screenshots/p9-before-*`, 42 files.
- **After:** `reports/screenshots/p9-after-*`, 51 files: the same screens and sizes, plus room-cover, rooms-cover and room-personalise.
- Both sets were generated by `tests/browser/phase9-screenshots.spec.ts` with synthetic data and generated illustrations. No real household photos were used.

**Comparison, before → after**
- `small-room`: the header shrinks, and the Kettle row moves into the first screen.
- `iphone-room`: the pencil icon is gone and a labelled Personalise button is in the header.
- `*-essentials` and `*-tasks`: grey disabled Add buttons; chip rows fade at the edge.
- `small-settings`: the swatches sit on one row.
- `*-home`: unchanged in structure, with Furnishing progress first.

## 16. Accessibility and performance

**Accessibility**
- Personalise uses a visible label ("Personalise") whose accessible name contains it.
- The cover choices are a radio group with names, and selection is shown with a ring plus a check, not by colour alone.
- The description has a label and a live counter.
- The save result is announced.
- Every new control is at least 44px.
- Header text sits on the room colour, so the existing room-colour contrast guarantees apply.
- The skeleton is announced once.

**Performance**
- Cover lookups are one batched query per screen, cached by id.
- Tiles use thumbnails; the header uses the full image.
- Images decode asynchronously.
- No new dependencies.

## 17. Known limitations

- Covers are chosen from existing Visual Home images. To use a new photo, add it in Visual Home first (the sheet links there). This is intentional: there is no second upload system.
- Inspiration images that have a picture can be covers. Link-only ideas cannot.
- Description edits are last-write-wins between two people editing the same field at the same moment. Only the changed field is sent, so edits to different fields never clash.
- The live site can't be opened from this build container: its network policy blocks `jayjett.github.io`. Deployment is verified through GitHub's Pages deployment status (§18), and behaviour through the browser and Realtime suites.

## 18. Deployment evidence and commits

| Step | Evidence |
|---|---|
| Production migration | Applied via the Supabase connector. Recorded as version `20261116093718`; repo files renamed to match |
| Post-migration checks | Read-only SQL (§11) and the security advisor (§10) |
| PR | https://github.com/JayJett/Flat-Quest/pull/10. CI green on `550f425`; merged as `f791f9f` |
| Main CI and deploy | Run 43842836384: Check and build, Local database access tests and Publish all succeeded |
| GitHub Pages | Deployment for `f791f9f` created 2026-11-16 09:54 UTC; status **success**; https://jayjett.github.io/Flat-Quest/ |

**Commits**

| Commit | Change |
|---|---|
| `0c8c475` | Baseline design audit and before screenshots |
| `a00cbcc` | Database: covers, descriptions, one reminder per run, tests, rollback |
| `f20e655` | Room personality UI |
| `29e8277` | Polish, motion and PWA |
| `273e558` | Wrapping accent names; after screenshots |
| `19fc0a4` | Audit results column |
| `bc088c3` | Scroll timing fix |
| `550f425` | Migration named after its production version |
| `f791f9f` | Merge |

Phase 9 is complete. As instructed, work stops here and Phase 10 has not been started.
