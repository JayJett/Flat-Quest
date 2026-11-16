# Phase 9 design audit

Baseline captured on 16 November 2026, before any Phase 9 change, from the deployed `main` (`9c502d9`).

**How the baseline was captured**
- Spec: `tests/browser/phase9-screenshots.spec.ts` with `SHOT_PREFIX=p9-before`.
- 14 screens × 3 sizes: 320 × 568, 390 × 844 and 1440 × 1000.
- Synthetic fixture data, with generated illustrations instead of photos.
- Files: `reports/screenshots/p9-before-*`.
- Screens: Home, Rooms, a room (header and checklist), Shopping, Wishlist, Visual Home, Essentials, Things to do, the notification drawer, Search and Settings, plus Essentials empty and Shopping with product data unavailable.

Only issues actually observed in those captures, or measured, are listed. Screens that already work well are noted so they are deliberately **not** changed.

## Findings (prioritised)

| # | Priority | Observed | Evidence | Intended correction | How it will be verified |
|---|---|---|---|---|---|
| 1 | High | On a small iPhone the room screen shows **no checklist items in the first screen**. The coloured header tile (~185px), Checklist/Visual switch, filter row and a separate "Sort by" row fill the 568px viewport; "Kettle" starts below the tab bar. | `p9-before-small-room.png` | A more compact room header; filter and sort share one row. | Browser test: the first checklist row is fully visible at 320 × 568, with and without a cover. |
| 2 | High | The room screen header has **four icon actions** (edit, add, search, bell) beside Back. Room personalisation would make a fifth. | `p9-before-iphone-room.png` | Personalising the room moves into a labelled button inside the room header; the header keeps add, search and bell. | Screenshot comparison; test counts header buttons. |
| 3 | Medium | Disabled primary buttons (e.g. "+ Add" in Essentials and Things to do quick add) are a **washed-out accent with white text, 1.85:1**. They read as a broken brand colour rather than "not yet". | `p9-before-iphone-essentials.png`, `…-tasks.png`; measured | Disabled buttons use the neutral grey surface with muted ink, for every accent theme. | Unit/visual check on all five accents. |
| 4 | Medium | **Essentials suggestion chips flash on every visit.** They render from an empty list, then are swapped out when essentials load (chips for items already on the list appear, then fade away). | `p9-before-*-essentials.png` captured mid-swap; a probe confirmed the final state is correct | Don't show suggestions until essentials have loaded. | Browser test: no chip for an item already on the list is ever rendered. |
| 5 | Medium | At 320px the **five accent swatches wrap**, leaving "Sunshine" alone on a second row. | `p9-before-small-settings.png` | Swatches sized to fit five across at 320px. | Screenshot at 320 × 568; test that all swatches share one row. |
| 6 | Medium | **Loading states are inconsistent**: centred spinners on some screens, plain "Loading…" text on Home's activity and the essential history, and nothing on others. | Code: 15 different loading renderings | A shared, quiet skeleton row for lists (Home activity, Essentials, Things to do); keep spinners only for full-screen waits. | Visual check of loading states; no layout jump when data arrives. |
| 7 | Low | Horizontal chip rows (task who/when, essential suggestions) are **cut off at the screen edge** with no hint that they scroll. | `p9-before-iphone-tasks.png` ("This weekend" touches the edge), small Essentials | A short fade at the trailing edge of scrollable chip rows. | Screenshot comparison. |
| 8 | Low | Room tiles and headers use only colour and icon; there's no way to make a room feel like *ours* (the main Phase 9 feature). | All room screenshots | Optional shared cover photo (from the room's Visual Home) and short description. | Phase 9 room personality tests. |

## Checked and deliberately left alone

- **Home:** Furnishing progress first; sections are clear at every size. Only the loading text (finding 6) changes.
- **Notification drawer, Search and Wishlist:** consistent spacing, clear hierarchy and correct contrast. They are used daily and stay unchanged.
- **Bottom navigation:** four tabs with 64px-tall targets, labels and safe-area padding. The selected state follows the accent (a dot plus heavier icon) and is stable when navigating. No change needed.
- **Visual Home:** headings, add buttons and cards are consistent. No change.
- **Shopping:** the layout is clear. With product data unavailable it falls back to the plain list. I couldn't reproduce a confusing state, so no change.
- **PWA:** see below.

## PWA baseline

**Already in place (Phase 3)**
- `manifest.webmanifest` with the name, `standalone` display, theme and background colours, and 192px, 512px and maskable icons.
- An apple-touch-icon and the iOS web-app meta tags.
- Paths are correct under `/Flat-Quest/`.
- A service worker that caches **only** a generic offline page. Navigations are network-first, so deployments can't leave a stale app.

**Gaps observed**
- No `id`, so an install's identity depends on `start_url`. No `lang`, and no shortcuts.
- The service worker never takes over until every tab is closed. Harmless, because it caches nothing that goes stale, but it keeps an old worker around.
- No hint anywhere about adding the app to the iPhone Home Screen.

**The icon** (four room-colour tiles) is original, clean and on-brand, so it is kept.

## Design-quality checklist used for "after"

1. Primary content is visible in the first screen at 320 × 568.
2. At most three icon actions in any header.
3. Every interactive element is at least 44px.
4. Text contrast is ≥ 4.5:1, and disabled states are clearly neutral.
5. No content swap or flash after load.
6. Consistent section-heading style and spacing.
7. No horizontal overflow at 320px.
8. Motion respects Playful, Balanced and Minimal, and the operating system's reduce-motion setting.
