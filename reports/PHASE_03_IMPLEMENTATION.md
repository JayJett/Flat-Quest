# Flat Quest — Phase 3 Implementation

Report date: 11 November 2026 (Pacific/Auckland).
Implemented on `phase-3-polish`, merged through [PR #1](https://github.com/JayJett/Flat-Quest/pull/1). Base: `0bfa577c648963892e8dea9e57274cf251aa7a2a`.

## Scope and design

Reviewed the Phase 2 report, current source/migrations, and the agreed planning conversation. This phase keeps the existing typography, colours, rounded tiles, navigation and animation language. No Claude Code was used.

## Implemented

- **Room milestones:** a restrained existing-style success toast at 25%, 50%, 75% and 100%; room completion says “Nice work, team!”. Only successful new completion writes trigger it. Initial load, undo, failed saves, moves and changes to which items count do not. Only the highest crossed milestone is announced, once per room/milestone per signed-in session. Pending optimistic writes are excluded from the calculation. Checkbox feedback and haptics wait for success; reduced motion disables the pulse/haptic.
- **Around the flat:** Home shows up to five recent saved completions and personally added wishlist ideas, with actor, date/time and destination links. Original sheet imports are excluded. This is a view of current records, not a permanent audit log: undone/deleted items disappear and edited titles reflect current titles. No database table or historical backfill was needed. Wishlist activity is bounded to five rows and refreshes on realtime changes, reconnect and returning to the app.
- **Conflict-aware item editing:** forms preserve their opening version; stale/deleted items or changed assignments produce a warning while retaining the draft. An `updated_at` equality filter protects the item write atomically. Only changed fields are submitted. Assignment changes still use the existing separate atomic RPC, so the entire item-plus-assignment save is not one transaction. Concurrent assignment races remain last-write-wins at the RPC boundary.
- **Partial-save recovery:** when creation succeeds but assignment fails, retry updates the same new item instead of creating a duplicate.
- **Native interaction fixes:** nested dialogs handle Escape/focus only in the topmost dialog; body scroll remains locked until the final dialog closes. Keyboard checkbox/claim interactions no longer bubble into opening details. Item sheets and confirmation dialogs resist dismissal during writes. Repeated pending item/assignment writes are rejected.
- **Connection handling:** an inline offline/refresh-failure message, retry control, and immediate offline rejection for item edits and assignments. Wishlist refreshes when returning online/visible. Item and room DELETE subscriptions explicitly handle unfilterable deletion events.
- **Conservative offline support:** a scoped service worker caches only a generic offline HTML page. It does not cache user data, photos, API responses, auth callback pages, or queue mutations. Reloading offline shows a useful retry screen. Already-open data is explicitly labelled potentially stale.
- **Performance:** page-level lazy loading across all routes, a loading fallback and recoverable route error screen. Checklist import, wishlist editor and image cropper code load with relevant screens rather than the initial route. Font families/subsets and visual tokens remain unchanged.
- **Repeatable verification:** committed Playwright fixture suites covering desktop Chromium, 320×568 iPhone-like WebKit and reduced-motion mobile Chromium. Browser fixtures block service workers to keep Supabase requests intercepted; the offline-worker test runs separately without authentication or real API access. Added milestone/activity unit tests. The existing Pages workflow now tests pull requests, runs browser tests, and gates publication on an isolated local Supabase/RLS job.

## Phase 2 findings resolved/investigated

- Verified the live `rls_check` schema contained only `results`, `ctx`, and `rec`/`try`/`val`; its 80 stored results were all PASS. Removed these test-only objects using explicit RESTRICT drops, without CASCADE. Script: `supabase/tests/cleanup_phase2_helpers.sql`.
- Updated `rls_verification.sql` to run in a transaction and roll back after emitting results; helper functions have fixed search paths. CI raises an error if any assertion fails or the count is not 80. This prevents helpers/test users surviving future successful runs (and disconnect rolls back a failed transaction).
- Compared original wishlist import keys with the live database. The absent idea is **Living room — Warm floor lighting**. There is no deletion audit proving why it is absent, so it was not restored. The other 19 imported ideas remain intact.

## Data preservation

No application schema migration, household import, user modification or Storage operation was performed. The only live mutation was removal of verified Phase 2 test helpers. Read-only before/after checks matched both row counts and complete-row fingerprints:

| Records | Before | After | Fingerprint unchanged |
| --- | ---: | ---: | --- |
| Items | 107 | 107 | Yes |
| Rooms | 10 | 10 | Yes |
| Wishlist ideas | 19 | 19 | Yes |
| Assignments | 15 | 15 | Yes |

`to_regnamespace('rls_check')` is now null. Application RLS and privileged RPC definitions were not changed.

## Verification

- Baseline: 45 unit tests passed; original build had one 870.07 kB JS chunk (258.86 kB gzip).
- Current local lint, TypeScript/production build and 57 unit tests pass.
- Desktop browser regression checks pass; small iPhone WebKit checks pass (11, including all six tour steps; offline-worker integration is reserved for Chromium).
- Final PR and production CI: **35 browser tests passed, 1 explicitly skipped** (WebKit offline-worker integration; Chromium covers it). **57 unit tests passed**, lint and production build passed, and the disposable local database passed **all 80 access assertions**. Final PR verification: [run 42969310270](https://github.com/JayJett/Flat-Quest/actions/runs/42969310270). Production verification: [run 42969809257](https://github.com/JayJett/Flat-Quest/actions/runs/42969809257).
- Split build entry plus shared preload: 750.37 kB raw / 229.73 kB gzip, about **11.3% less compressed shell JS** than the baseline. Including Home and its static dependencies, the first Home view is approximately **242.7 kB gzip**, about **6.2% below** the original 258.86 kB single bundle. Other routes load on demand. These are build-size measurements, not real-device speed claims.
- Production build uses `/Flat-Quest/`, matching GitHub Pages; tests cover direct route loads with this sub-path.
- No physical iPhone, Add to Home Screen installation, actual pinch gestures or two real household devices were used. Browser tests use invented “Our Flat”/“Alex” records and never intentional writes to live household data.

## Deployment

**Successfully deployed on 11 November 2026, at approximately 7:07 pm NZDT.**

- Feature head: `769640a9d142eb14bc75ec4d414adb4df616d225`.
- Merge/release commit: `be26e02f771d844aa371d03c228b18f32394ed13`.
- Existing Pages workflow: [production run 42969809257](https://github.com/JayJett/Flat-Quest/actions/runs/42969809257). Check/build, local database tests and Publish all concluded **success**.
- Live app: https://jayjett.github.io/Flat-Quest/.
- Post-deploy HTTP checks returned 200 for the homepage, service worker and offline fallback. The homepage references the exact production bundle names; `sw.js` and `offline.html` match the locally tested content. Entry, household-provider and Home JavaScript were additionally compared with the tested build.
- The last live-data check after merge still matched all four original row fingerprints, and the test-only schema remained absent. The security advisor no longer reports its three mutable-search-path helper warnings.
- This final deployment-record update changes documentation only and uses `[skip ci]`; it does not replace the verified deployed application or require another application build.

## Deliberate limits / follow-up

- Offline viewing of private data and offline edits are not implemented; no silent mutation queue or persistent private cache was introduced.
- Activity is a lightweight current-record view, not a durable event log. Milestones are local to the successful actor’s session, not broadcast celebration events.
- Membership removal/transfer/limit controls, wishlist comments/multiple photos, Google OAuth/SMTP configuration and public Git history rewriting are outside the agreed focused Phase 3 scope.
- Leaked-password protection remains an account configuration finding. Existing signed-in SECURITY DEFINER RPC warnings need contextual review; they were not weakened or blindly removed.
- Physical-device onboarding, storage uploads and real-device realtime remain manual follow-up checks.

## Reference documentation checked

- Supabase changelog: https://supabase.com/changelog.md (no relevant client-breaking change requires upgrading the pinned client).
- Supabase query filters: https://supabase.com/docs/reference/javascript/using-filters.
