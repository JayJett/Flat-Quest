# Flat Quest — Phase 2 Implementation Report

| | |
| --- | --- |
| Repository | `JayJett/Flat-Quest`, branch `main` |
| Live app | https://jayjett.github.io/Flat-Quest/ (GitHub Pages, deployed by `.github/workflows/deploy.yml`) |
| Supabase project | `flat-quest` (`ivnovvdpkxrqsmsiqhid`) |
| Last feature deploy | `98ff3e1`. GitHub Actions run succeeded (lint, unit tests, build, publish). |
| Report date | 11 November 2026 |

> **Testing labels used in this report.** **Live DB** = executed against the real Supabase database. **Browser (mocked)** = Playwright/Chromium against the production build, with Supabase HTTP intercepted by fixtures, because this sandbox cannot reach `*.supabase.co`. **Unit** = Vitest. **Not tested** = not exercised. Nothing here was tested on a physical iPhone.

---

## 1. Executive summary

Phase 2 is implemented and deployed, and the live household's data was preserved:

- **One invite link per household.** The link is stored encrypted in Supabase Vault, so members can copy or share it again.
  - The panel shows how many people can still join (a 4-person limit) and the link's expiry, with a cancel option.
  - Links created before this phase are kept working until they expire, and the app offers an explicit "replace" path for them.
- **Responsibility shared between any combination of members** via a new `item_assignees` table.
  - It is shown as overlapping avatar groups, and selected with a native-feeling avatar picker.
  - The 15 live one-person assignments were migrated with zero loss.
- **A first-run spotlight tour** (6 steps), stored per person and replayable from the menu.
- **A household photo** beside the Home headline, with a crop/zoom editor. The same cropper is now used for profile photos.
- **A collaborative Wishlist:**
  - Ideas with room, price, link and photo.
  - One vote per member, synced in realtime.
  - Popular, Newest and Chosen views.
  - Converting a chosen idea into exactly one checklist item.
  - Importing the sheet's 20 ideas.
- **"Provided with flat" status.** The live fridge, microwave and washing machine were switched to it, and the dishwasher and dryer were added.
- **Motion and visual fixes:**
  - The sticky header is now fully opaque, so content no longer shows through.
  - Progress numbers count up when they change.
  - Item lists animate additions and removals, and filter changes cross-fade.
- **Security:**
  - The membership helper functions moved out of the public API.
  - Invite codes are encrypted at rest.
  - The street address was removed from the source and docs, and every screenshot was regenerated with a neutral flat name.

**Verification:**

| Area | Result | How |
| --- | --- | --- |
| Unit tests | 45/45 | Unit |
| Browser checks | 120/120 across three suites | Browser (mocked) |
| Invite system | 21 checks, plus full-house checks in the RLS suite | Live DB |
| Data migrations | Verified | Live DB |
| Phase 2 RLS suite | **80/80 pass** (run 11 Nov in the SQL Editor; cleanup confirmed) | Live DB |

---

## 2. Features implemented (with source references)

| Feature | Main files |
| --- | --- |
| Invite panel | `src/components/InvitePanel.tsx`, `src/pages/Flatmates.tsx`, `src/pages/Welcome.tsx` (join page shows "flat is full") |
| Shared responsibility | `src/components/ItemRow.tsx` (`assigneeMembers`, `responsibilityLabel`), `src/components/ItemSheet.tsx` (`PersonToggle`), `src/components/Avatar.tsx` (`AvatarGroup`), `src/household/HouseholdProvider.tsx` (`setAssignees`), `src/lib/stats.ts` |
| Tour | `src/components/Tour.tsx`, `data-tour` targets in `AppShell.tsx`, `Home.tsx`, `ItemRow.tsx` |
| Household photo | `src/components/HouseholdPhoto.tsx`, `src/components/ImageCropper.tsx`, `HouseholdProvider.setHouseholdPhoto` |
| Wishlist | `src/wishlist/WishlistProvider.tsx`, `IdeaCard.tsx`, `IdeaSheet.tsx`, `wishlistData.ts`, `src/pages/Wishlist.tsx` |
| Provided with flat | `src/lib/domain.ts`, `src/lib/stats.ts` (`isUnclaimed`), `src/household/importChecklist.ts` (`withLandlordAppliances`), `src/lib/csv.ts` |
| Motion | `src/components/ui.tsx` (`AnimatedNumber`, `EmptyState`), `ItemRow.tsx`, `RoomDetail.tsx`, `Home.tsx`, `Avatar.tsx` |
| Opaque header | `src/components/AppShell.tsx` (`PageHeader` now `bg-surface`, no transparency) |
| Sub-path hosting | `src/lib/urls.ts`, `vite.config.ts` (`BASE_PATH`) |

---

## 3. Invitation changes and existing-link migration

**Design:**
- **Size limit.** `households.member_limit` (default 4). "People who can join" = the smaller of the uses left on the link and the free places in the flat.
- **Creating a link.** `create_household_invite`:
  1. Locks the household row (`for update`), so simultaneous requests queue up.
  2. Retires links that can no longer be used (expired, used up, or the flat is full) and deletes their stored codes.
  3. Refuses if any usable link exists (`23505`) or the flat is full (`54000`).
  4. Stores the plain code with `vault.create_secret` and keeps only its SHA-256 hash in the table.
- **Database guarantee.** A partial unique index (`household_invites_one_current`) allows at most one current link per household, even if the lock were bypassed.
- **Re-sharing.** `get_household_invites` (members only) returns the usable links. The current link's code comes from `vault.decrypted_secrets`; legacy links return `code = null`.
- **Cancelling.** Cancelling (`revoke_household_invite`) deletes that link's encrypted code.
- **Joining.** `accept_household_invite` locks the household row, re-checks the size limit, and retires links once the last place is taken (migration 03).
- **Not in realtime.** Invite changes are deliberately left out of realtime updates, because the change events would carry `token_hash`. The panel refreshes when the member count changes and when the app regains focus.

**Existing links.** The live database had two active links (one used once, one unused), both expiring 18 Nov.
- They were marked `is_legacy` and still work. Nothing that had already been sent was invalidated.
- While either is usable, no new link can be created. The panel explains this and offers **"Cancel and make a new link"**, with a confirmation that the old link stops working.
- Verified on the live DB: both legacy links listed with "2 can join", and creating a new link was refused while they're active.

**Live checks (Live DB, temporary household, cleaned up):**
- Re-read code matches the created code; a second link was blocked; hashes are unreadable.
- An outsider can't list or cancel links.
- Joining works, and repeat joins are no-ops.
- Cancelling invalidates the code and deletes its Vault entry; a new link can then be created.
- **One finding fixed:** when the flat was full, the old link still showed as active and blocked new ones. Migration `20261111000003_invite_full_house.sql` now retires links when the last place is taken. Re-verified on the live DB: the RLS suite's full-house checks pass.

---

## 4. Shared responsibility: data model and migration

- **`item_assignees(item_id, household_id, user_id)`** is the single source of truth:
  - 0 rows = unclaimed, 1 = individual, 2 or more = shared.
  - Composite foreign keys guarantee the assignee is a member of that item's own household. Assigning a non-member or another household's item fails at the database.
  - When a member leaves, their assignments are removed automatically.
- **RLS:** members can read, add and remove.
- **`set_item_assignees(item, users[])`** replaces the list atomically. It runs as SECURITY INVOKER, so RLS applies.
- **Phase 1 "Shared" items without names** get `items.needs_assignees = true`. They show "Choose who" and never silently become "everyone". There were none in the live data.

**Migration (expand, then contract):**
1. **Expand (`20261111000004`).** Created the table and copied over all 15 live one-person assignments (verified: 15 rows, 0 missed). Archived the Phase 1 values to `private.items_responsibility_phase1`.
2. **Deploy** the app that reads `item_assignees` (`d8d0fe4`, verified successful).
3. **Contract (`20261111000008`).** Caught up any changes made by the old app in between, took a second archive snapshot, and dropped `responsibility` / `responsible_user_id`. `items_guard` and `import_checklist` were rewritten without them; the importer now writes to `item_assignees`. Verified: 107 items, 15 assignments, 0 old columns left, 212 archive rows (2 snapshots).

**App behaviour:**
- **Quick Claim** only appears when nobody is on the item, so it can't replace anyone.
- **Joining an existing assignment:** open the item, tick yourself, save.
- **Personal lists, the Mine filter and Flatmates counts** all include shared items. Unclaimed counts exclude assigned items, provided items and items waiting for names.
- **Ownership is unchanged.** Responsibility and ownership remain separate fields.
- **Saving:** changes show immediately and roll back on failure. Realtime updates for an item are ignored while that item is being saved. Deletions are matched by primary key.

---

## 5. Tour: architecture, persistence and replay

- **Persistence.** `profiles.tour_completed_at` (null means not seen yet). It's set on Finish or Skip, so the tour shows once per person across devices. You and Madi have null, so you'll both see it once.
- **Starting.** It only exists inside the main app shell (never over sign-in, onboarding, join or loading), and starts 0.7 s after household data is ready.
- **Steps:**
  1. Welcome.
  2. Progress (Home).
  3. Rooms nav.
  4. Claim and share. It opens the first room and prefers an *unclaimed* row so the Claim button is visible.
  5. Wishlist nav.
  6. Your account (returns Home, where the avatar is shown).
- **Targeting.** Targets are found by `data-tour` attributes, picking the visible one (bottom bar on phones, side rail on desktop). Missing targets are skipped.
- **Spotlight.** An SVG mask with an animated cut-out. Off-screen targets are scrolled into view, and targets are re-measured after 450 ms to allow for list entrance animations.
- **Card placement.**
  - It's measured and placed below the target, above it, or pinned to an edge, whichever fits.
  - On short screens the page is nudged so the card doesn't cover the target.
  - It always stays inside the viewport and clear of the bottom bar.
- **Controls.** Next, Back, Skip, "Start exploring", and progress dots. Esc skips; arrow keys move between steps; focus is trapped in the card and screen-reader labelled.
- **Reduced motion.** All transitions are instant.
- **Replay.** "Show me around" in the left drawer.
- **Verified (Browser, mocked).** iPhone SE (320×568), iPhone 14 Pro and 1280×800 desktop:
  - It starts automatically.
  - All 6 steps are aligned to their targets within 3 px, with every card on screen and no step's card covering its target.
  - Completion is saved and the tour doesn't reappear; Escape and Skip are saved too.
  - Replay, Back and Skip all work.
  - It doesn't run on onboarding screens.

---

## 6. Household photo: storage and permissions

- **Storage location.** A private bucket, `household-media` (3 MB limit, JPEG/PNG/WebP), with one folder per household: `<household-id>/photo-<ts>.webp`. Wishlist photos go under `<household-id>/wishlist/…`. Personal avatar storage is separate.
- **Storage policies.** Select, insert, update and delete are allowed only if `private.is_household_member(private.path_household(name))`.
- **`households.photo_path`** has a check constraint keeping it inside that household's folder.
- **`set_household_photo(household, path)`** (any member; household name and address stay owner-only):
  - It validates the path pattern and returns the old path, so the client deletes the old file.
  - On a failed save, the newly uploaded file is deleted, so no orphaned files are left.
- **Editing.** Tap the photo on Home → Choose → crop (drag, pinch, slider or keys) → Save; Replace and Remove are also available. The image is re-encoded to WebP at up to 640 px, which also strips EXIF/location data.
- **Realtime.** `households` updates are published, so other open sessions update their photo.
- **Layout.** Rounded square beside the headline, sized `clamp(68px, 21vw, 96px)`. The headline uses a fluid size so the flat name stays on one line beside the photo on iPhone SE (Browser, mocked).
- **Verified:**
  - **Browser (mocked):** upload, crop, replace (old file deleted), remove, and the photo position on Home.
  - **Live DB (pending suite):** RPC permissions and storage-rule expressions.
  - **Not tested:** an actual upload to Supabase Storage.

---

## 7. Animation refinements and visual corrections

- **Sticky header:** fully opaque. Previously `bg-surface/95`, which let content show through. Verified `rgb(255,255,255)` on Home, Rooms and Room detail after scrolling (Browser, mocked).
- **Counting numbers:** `AnimatedNumber` on the Home percentage and the Ready / To sort / Unclaimed counts (spring, about 0.5 s).
- **Item rows:** enter with a fade-up and exit by collapsing (`AnimatePresence`) on room lists and "On your list".
- **Filters:** room filter and sort changes cross-fade (180 ms); empty states fade in.
- **Avatar picker and groups:** ring, check badge and opacity transitions (160 ms); avatar groups animate people joining and leaving.
- **Wishlist:** the vote heart pops (spring) only when you add a vote; cards animate in and out.
- **Sheets and drawer:** spring in, 220 ms out (unchanged from Phase 1). Tour cards and spotlight move over 260–420 ms.
- **Reduced motion:** honoured throughout (`MotionConfig reducedMotion="user"` plus the CSS media query; verified transitions collapse to about 0 s).
- **Bottom-bar clearance:** on iPhone SE the last list action ends 23 px above the bottom bar, and sheet Save buttons stay visible (Browser, mocked).

---

## 8. Wishlist: functionality, import and voting

- **`wishlist_items`:**
  - Fields: title, room (optional, same-household check), price, link, notes, photo, `is_chosen` (with `chosen_at` / `chosen_by` set by the database), `checklist_item_id` (unique), `created_by` (set by the database), and `import_key`.
  - Any member can add, edit or remove ideas.
  - The link to the checklist item can only be written by the RPC (column-level grants).
- **`wishlist_votes(idea_id, user_id)` primary key:**
  - One vote per member per idea; votes can be withdrawn.
  - Members can only insert or delete their own votes.
  - Votes mean interest only; there's no vote allowance.
- **`add_wishlist_to_checklist(idea, room?)`:**
  - Locks the idea, and returns the existing item if it was already converted, so there are no duplicates.
  - The new item keeps the title, room, link, price and notes.
  - It's created unclaimed, with ownership "To decide" and priority "Nice to have", and is linked back to the idea.
  - The idea then shows "On the checklist in {room}".
- **`import_wishlist`:**
  - Idempotent: each idea is keyed by room + title.
  - Imported ideas show "From your Google Sheet", not the person who ran the import.
  - The page offers "Bring them across" until the 20 ideas exist.
  - **Not yet run for the live household** (see §14).
- **UI:**
  - Cards lead with the photo when there is one; otherwise a compact room-colour icon.
  - Each card shows the voters' avatar group and a heart button with the count.
  - Popular / Newest / Chosen views, and a prominent "Add an idea" button.
- **Realtime:** ideas and votes sync live, with a full refetch after a reconnect.
- **Verified (Browser, mocked):**
  - Import of 20 ideas, then voting and unvoting, with popular ordering.
  - Adding an idea with room, price, link and photo.
  - Choose → convert → shown on the checklist; converting twice is impossible.
  - The Chosen filter.

---

## 9. Landlord appliance corrections

- **The new `provided` status** ("Provided with flat") is separate from Not needed:
  - It counts towards the total, and is ready once ticked as present.
  - It is never counted as unclaimed or suggested for claiming.
- **Live data (`20261111000005`):** only rows still at their imported defaults were changed (To decide or Not needed, nobody assigned, not complete). Your edits were never overwritten.
  - Switched to provided / landlord: Fridge / freezer, Microwave and Washing machine.
  - Added as provided: Dishwasher (Kitchen) and Dryer (Laundry & cleaning).
- **Matching** is by exact import key or name, so "Dishwashing liquid" and "Clothes drying rack" are untouched (unit-tested).
- **New households** get the same setup via `withLandlordAppliances`. CSV imports accept "Provided with flat".

---

## 10. Supabase migrations and RLS changes

| Migration | Purpose |
| --- | --- |
| `20261111000001_private_helpers.sql` | Moves `is_household_member`, `is_household_owner`, `shares_household_with`, `user_in_household` and `avatar_owner` to a non-exposed `private` schema. Policies keep working because they reference functions internally, not by name. |
| `…0002_single_invite.sql` | `member_limit`, Vault-backed invites, one-current-invite index, `get_household_invites`, legacy marking |
| `…0003_invite_full_house.sql` | Links retire when the flat is full |
| `…0004_item_assignees.sql` | Assignment table, RLS, `set_item_assignees`, backfill, archive |
| `…0005_provided_status.sql` | Status rule plus safe appliance data changes |
| `…0006_tour_and_household_photo.sql` | `tour_completed_at`, `photo_path`, `household-media` bucket and policies, `set_household_photo`, households realtime |
| `…0007_wishlist.sql` | Wishlist tables, guards, RLS, grants, conversion and import RPCs, realtime |
| `…0008_drop_phase1_responsibility.sql` | Contract step (see §4) |
| `…0009_phase2_indexes.sql` | Covering indexes and an archive primary key (performance advisor) |

**Advisors after Phase 2:**
- **Security:** 10 warnings for callable SECURITY DEFINER functions. All are intended user actions, and each checks membership itself. The four membership helpers no longer appear.
- **Leaked-password protection** is still off; it's a dashboard setting (§14).
- **Performance:** the remaining notices are "unused index", only because the new tables have no traffic yet.

**RLS suite:** `supabase/tests/rls_verification.sql` was rewritten for Phase 2. It has 80 checks across owner, joiner, leaver, outsider and anon roles, covering:
- Assignments.
- Invites, including the database race guard and the full-house rules.
- Photo RPC and storage-rule expressions.
- Wishlist and votes.
- Tour field, provided status and imports.

**Status:** the Phase 2 suite passed **80/80** on the live database. Jarden ran it in the Supabase SQL Editor on 11 Nov 2026. I then confirmed 80 results recorded, all passing, 0 test users or test flats left, and the real data intact (1 flat, 2 members, 107 items). The first attempt failed with `relation "rls_results" does not exist`, because the editor doesn't keep temporary tables between statements; the suite now runs as a single block and stores results in a private `rls_check` schema. The bucket policies' membership checks are tested by evaluating the same expressions, not by uploading real objects through SQL.

---

## 11. Automated test results

| Suite | Result | Type |
| --- | --- | --- |
| `npm run lint` / `typecheck` / `build` | Pass. JS 870 kB (259 kB gzip), CSS 36 kB. | Local + GitHub Actions |
| Vitest (`tests/*.test.ts`) | **45/45** (stats incl. shared and provided rules, CSV and appliances, wishlist CSV and sorting, colour tokens) | Unit |
| Phase 1 regression (`interactions`) | **39/39**. Two expectations were updated, because provided items now count towards the kitchen total (26). | Browser (mocked) |
| Phase 2 assignments and invites (`p2`) | **22/22**: shared avatar groups, provided labels, Claim, multi-select save, Mine filter, failed claim rolls back, full house, create / re-show / cancel invite | Browser (mocked) |
| Tour, photo, wishlist, visual (`p2b`) | **59/59**: tour on 3 sizes, Escape/Skip/replay, photo upload/crop/replace/remove, iPhone SE headline fit, wishlist flows, header opacity, bottom clearance, reduced motion | Browser (mocked) |
| Invite system, live | 21 checks (one finding fixed, see §3) | Live DB |
| Data migrations, live | 15/15 assignments, 5 provided appliances, columns dropped, archive present | Live DB |
| Phase 2 RLS suite | **80/80** | Live DB |

Bugs found and fixed through these tests:
- **Tour:** the last step was skipped on sub-pages, the card height was measured while switching steps, cards were placed off-screen, and the spotlight measured an item still animating in.
- **Avatar groups:** overlapping faces cropped each other's initials, with no separating ring.
- **Invites:** a full flat left a link that blocked new links.

The browser-test scripts live outside the repo (the scratchpad); adding them to the repo as a CI suite is recommended (§15).

---

## 12. Screenshots

All screenshots in `reports/screenshots/` use **test fixtures** and the neutral name "Our Flat". Every screenshot was regenerated in Phase 2, so none show the real address. Members, claims and votes are invented for QA.

| Screen | File |
| --- | --- |
| Multi-person picker / room with shared avatars | `p2-picker.png`, `p2-room.png` |
| Invite panel (active link) | `p2-invite.png` |
| Tour steps (welcome, progress, claim, account) | `p2-tour-1.png`, `p2-tour-2.png`, `p2-tour-4.png`, `p2-tour-6.png` |
| Photo cropper / Home with photo / iPhone SE Home | `p2-crop.png`, `p2-home-photo.png`, `p2-home-se.png` |
| Wishlist / idea sheet (on checklist) | `p2-wishlist.png`, `p2-idea-sheet.png` |
| Room end of list on iPhone SE | `p2-room-bottom-se.png` |
| Phase 1 screens (regenerated) | `m*.png`, `d*.png` |

---

## 13. Known limitations

1. **RLS storage tests are indirect.** The storage rules are verified by evaluating their membership expressions, not by uploading real files through the Storage API.
2. **Not tested on a real iPhone.** All UI testing was Chromium emulation with mocked network, including the tour on iOS Safari, file pickers, pinch-zoom and realtime between two real devices.
3. **The street address is still in Git history** (Phase 1 commits and screenshots). It's removed from the current files only. Free GitHub Pages requires a public repo, so making the repo private would stop hosting unless you upgrade to GitHub Pro. Rewriting history would need your go-ahead, because it rewrites shared history.
4. **Older links can't be shown again** (by design: only their hash exists). The UI offers replace instead.
5. **Upload progress is a spinner, not a percentage.** supabase-js doesn't report upload progress.
6. **No UI for the member limit or removing members.** The limit (4) can only be changed in the database, and the owner can't remove members.
7. **Wishlist photos aren't cropped.** They keep their shape and are downscaled to 1280 px.
8. **Concurrent edits are last write wins**, field by field. Assignment changes are atomic per item.
9. **Larger bundle:** 259 kB gzip, single chunk. Route-level code splitting is still pending.
10. **Brief window after deploy.** Phones with the old app open until they reload may briefly show stale data.

---

## 14. Manual configuration still required

1. **(Done)** RLS suite: 80/80 PASS. Re-run it after future schema changes by pasting `supabase/tests/rls_verification.sql` into the SQL Editor.
2. **Bring the 20 wishlist ideas across.** On the Wishlist tab, tap **Bring them across** (one tap, idempotent). I didn't run it myself: it needs the same database approval, and it's better done by a member so it's attributed to the flat.
3. **Leaked-password protection.** Supabase → Authentication → (Sign In / Providers or Attack Protection) → enable *Prevent use of leaked passwords*. This may require a paid plan; if it's unavailable, keep the 8+ character minimum.
4. **Custom SMTP** (recommended before inviting Emily and Dan), or keep "Confirm email" off (`SETUP_GUIDE.md` Part 3).
5. **Google sign-in** is still optional and not configured (`SETUP_GUIDE.md` Part 6). Its JavaScript origin is now `https://jayjett.github.io`.
6. **Old invite links.** If you've already shared a pre-Phase-2 link, keep using it until 18 Nov. Otherwise use **Cancel and make a new link** to get one you can re-share.
7. **Optional:** decide about Git history (see §13, item 3).

---

## 15. Recommended Phase 3 priorities

1. **Commit the browser test suites** to the repo and run them, plus the RLS suite against a local Supabase stack, in CI.
2. **Real-device pass on iPhone.** Safe-area insets, pinch-crop, Add to Home Screen, and realtime between two phones.
3. **Household management:** owner can remove members, transfer ownership and change the member limit; members can leave.
4. **Offline-friendly service worker** and route code splitting.
5. **Activity and celebrations:** "Madi ticked off the kettle", and room-complete moments, using the existing animation tokens.
6. **Wishlist extras:** multiple photos per idea, and comments or reactions.
7. **Conflict-aware item editing:** warn if someone else changed the item while the sheet was open.

---

## 16. Commit and deployment status

| Commit | Contents |
| --- | --- |
| `cf62ff5`, `750fbe7` | Phase 2 migrations |
| `d8d0fe4` | Shared responsibility, invites, provided status (deployed) |
| `25e61f9` | Tour, household photo, cropper, opaque header |
| `98ff3e1` | Wishlist, tour fixes, motion (deployed; Actions run succeeded) |
| Final commit | Privacy redaction, indexes migration, RLS suite v2, screenshots, this report. Hash is in the git log after this report. |
