# Phase 10: hosting and App Store readiness plan

Written on 17 November 2026. Nothing here has been provisioned or changed. Every hosted step below needs its own explicit approval.

**Decisions for the owner are marked ⚑.**

## 0. Recommendation in one paragraph

Keep one managed Supabase backend for the web app and a future iOS client. Each flat stays isolated in the database, using row-level security keyed on membership. The schema already works this way, and Phase 10 added verification for it.

- Add a separate **staging** project with synthetic accounts.
- Keep local and CI stacks disposable.
- Leave the current flat on project `ivnovvdpkxrqsmsiqhid` (production) throughout.
- Before any public sign-up: production SMTP, abuse limits, and in-app account deletion.
- For iOS: prove a Capacitor-packaged build on a physical iPhone first, and decide on a native client only if that proof of concept fails its acceptance criteria.

## 1. Environments and releases

| Environment | Backend | Frontend | Data | Who can deploy |
|---|---|---|---|---|
| Local | `supabase/tests/run_local.sh` (plain Postgres 16) or `supabase start` | `npm run dev` | Synthetic, discarded | Developer |
| CI | Local Supabase stack inside GitHub Actions (`deploy.yml`, CLI 2.81.3) | Pages-base build plus Playwright fixtures | Synthetic, discarded per run | Automatic on every PR |
| Preview build | **No backend credentials** (browser fixtures only) or staging | Built per PR, not published | Never live data | Automatic |
| Staging ⚑ | New Supabase project `flatquest-staging` (Free or Pro) | A non-Pages host or a separate Pages repo | Synthetic accounts only (`*@example.invalid`), reset at will | Owner approval for each migration |
| Production | `ivnovvdpkxrqsmsiqhid` | `https://jayjett.github.io/Flat-Quest/` | Real flats | Owner approval for each migration and each merge to `main` |

**Build settings**
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable) are build-time variables.
- `BASE_PATH=/Flat-Quest/` is for Pages.
- The service-role key never reaches a frontend build. It is only used by the media-cleanup worker, through scoped credentials.

**Isolation from live data**
- Today, CI and preview builds only ever talk to `127.0.0.1` (the scripts refuse other hosts), and browser tests route every `*.supabase.co` request to fixtures.
- Keep that rule. Staging gets its own URL and keys, stored as GitHub *environment* secrets that only a staging workflow can read.

**Auth settings per project**
- Site URL, allowed redirect URLs, email templates and OAuth client IDs all differ between staging and production.
- Production redirect allow-list:
  - `https://jayjett.github.io/Flat-Quest/**`
  - the future custom domain
  - the iOS Universal Link domain

**Ownership and secrets** ⚑
- The Supabase organisation, the GitHub repo and the Apple account should belong to the same accountable owner, with at least one backup admin.
- Rotate keys and the media-worker token yearly, and immediately if anyone with access leaves.
- Rotate the JWT secret only in a planned window, because it signs out every session.

**Hosted change review gate:** one PR per change, which must include:
1. a migration that has been tested in CI;
2. a written rollback;
3. a read-only "before" snapshot (counts and fingerprints);
4. explicit approval;
5. apply to staging, then verify;
6. apply to production, then verify read-only;
7. merge the frontend last.

**Custom domain (later)** ⚑
- Buy a domain such as `flatquest.app` and serve the same build over HTTPS on it.
- Keep `jayjett.github.io/Flat-Quest/` working throughout the transition, either by keeping both deployments or by redirecting with path and query preserved. `?flat=` and invite codes must survive the redirect.
- Invite links then become `https://<domain>/join?code=…`, and those are the URLs that iOS Universal Links claim.

## 2. Public onboarding and abuse controls

**What exists today (audited)**

| Area | Current state | Gap before public sign-up |
|---|---|---|
| Sign-up / sign-in | Email + password, password reset via `/auth/reset`, optional Google, safe `next` return | Turn on email confirmation for production. Add CAPTCHA (Turnstile or hCaptcha) on sign-up and reset |
| Email delivery | Supabase built-in mailer (heavily rate-limited, not for production) | **Production SMTP is required** (§3 costs), with SPF, DKIM and DMARC on the sending domain and a bounce/complaint webhook |
| Invites | One active link per flat, hashed tokens, 7-day lifetime, max uses, retired when the flat is full | Per-account rate limit on invite creation and acceptance attempts (brute force is already infeasible: ≥16-character random codes) |
| Flat creation | `create_household` refuses beyond 5 memberships per person | Add a per-account daily creation limit; monitor creation bursts |
| Joining | Only the flat's member limit (default 4) applies; no per-person cap | Decide whether to cap memberships per person ⚑ (suggest 10) |
| Uploads | Reserved paths, type/extension allow-list, cleanup worker for abandoned files | Per-flat storage quota (e.g. 500 MB) and per-day upload count; server-side size limit on the bucket |
| Text content | Length limits on every text field | Report flow for comments and photos (§5), plus a support route |
| Support | None | ⚑ A support email address (in-app link) and a documented response time |

## 3. Reliability and costs

**Measured from the live flat (read-only, 17 Nov 2026)**
- 1 flat, 3 members.
- Database 16 MB in total, mostly platform overhead.
- 50 media objects totalling 7.6 MB (about 150 kB each, thumbnails included).
- 65 history events, 54 notifications.
- No flat has a stored time zone, and none has an invalid one.

**Assumptions per active flat:**
- 3 members.
- 120 photos in the first year (about 18 MB with thumbnails), and 2 MB of rows.
- Each member opens the app daily: about 40 MB of signed-image egress per member per month, 120 MB per flat.
- 1 Realtime connection per open session.

**Pricing used.** Supabase Pro is about US$25/organisation/month. It includes:
- 100k MAU, 8 GB database disk, 100 GB file storage, 250 GB uncached egress.
- A US$10 compute credit, which covers one Micro instance.

Overages are about US$0.09/GB egress, US$0.0213/GB storage, US$0.125/GB disk and about US$0.00325/MAU. The Small compute add-on is about US$15/month. These figures come from 2026 third-party summaries ([uibakery](https://uibakery.io/blog/supabase-pricing), [activepieces](https://www.activepieces.com/blog/supabase-pricing-free-tier-limits-pro-costs-egress), [brandexponents](https://brandexponents.com/supabase-pricing/)), because Supabase's own page didn't appear in the search. **Confirm on supabase.com/pricing before budgeting.**

**Other costs**
- Transactional email: Resend free tier is about 3,000/month (100/day); paid is about US$20/month for 50k. Postmark is about US$15/month for 10k ([costbench](https://www.costbench.com/compare/postmark-vs-resend/), [automationatlas](https://automationatlas.io/answers/postmark-pricing-explained-2026/)).
- Apple Developer Program: US$99/year ([ambsandigital](https://ambsandigital.com/?p=11104)). Commission doesn't apply to a free app.

| Scenario | MAU | DB | Media | Egress / month | Supabase | Email | Fixed extras | Estimated total / month |
|---|---|---|---|---|---|---|---|---|
| Private beta (10 flats) | ~30 | < 0.1 GB | ~0.2 GB | ~1.2 GB | Pro $25 (Free is possible, but it pauses and has no backups) | Free tier | Domain ~$1.5, Apple ~$8.3 | **≈ US$35** |
| 100 flats | ~300 | ~0.3 GB | ~2 GB | ~12 GB | Pro $25 (all within quota; Micro covered) | Free tier, or $15–20 | Same, plus staging project ~$10 | **≈ US$45–65** |
| 1,000 flats | ~3,000 | ~2–3 GB | ~20 GB | ~120 GB | Pro $25 + Small compute ~$15 (recommended for Realtime and connection headroom) | $15–20 | Same, plus staging ~$10 | **≈ US$75–95** |

- **Fixed:** the plan fee, compute, staging, domain and Apple fee.
- **Usage:** egress beyond 250 GB, storage beyond 100 GB, MAU beyond 100k, and email volume.
- **Biggest uncertainty:** photo egress. Signed thumbnails are cached in the browser for each URL's 1-hour lifetime. A CDN cache, or a longer lifetime for thumbnails only, would lower egress if it ever grows.

**Signals to watch (owner, with alerts)** ⚑

| Signal | Source | Alert when |
|---|---|---|
| Database CPU, connections, disk | Supabase reports / advisors | > 70% sustained, disk > 6 GB |
| Storage size, egress | Usage page | 70% of the included quota |
| Realtime concurrent connections and messages | Realtime report | 70% of the plan limit |
| Auth email failures, bounces | SMTP provider webhooks | Bounce rate > 2%, any provider suspension |
| Cron failures | `cron.job_run_details` (cleanup, retention, reminders) | Any failure, or no successful run for 2 hours |
| Runaway usage | Flats created per hour, uploads per flat per day | 10× the trailing average |

**Ownership.** The owner (or a named delegate) owns quota alerts, backups and restore tests. Restore testing is quarterly: restore into staging and verify counts and fingerprints.

## 4. Data and support

| Data | Who sees it | Notes |
|---|---|---|
| Email, password hash, sign-in metadata | The person only (Supabase Auth) | Never shown to flatmates |
| Profile (display name, colour, avatar) | Flatmates in shared flats | Avatars are in a private bucket; signed links expire after 1 hour |
| Preferences (accent, motion, greeting, mutes, Home layout) | The person only | Personal across flats |
| Flat name, address, time zone, photo | Members of that flat | Address is optional |
| Rooms, items, wishlist, shopping, purchases, deliveries, Visual Home photos, comments, tasks, essentials, appointments, activity | Members of that flat | Authored records keep `created_by` and similar fields; when someone leaves, their assignments are cleared and history keeps a display name |
| Notifications | Recipient only, per flat | Retention job prunes them |

**Decisions needed before public launch** ⚑
1. **Account deletion:** what happens to authored comments (anonymise to "Former flatmate" or delete), photos they uploaded (keep for the flat or delete), and their history entries.
2. **A sole owner deleting their account:**
   - If the flat has other members, require a transfer first (the transfer RPC already exists) or transfer automatically to the longest-standing member.
   - If they're the only member, close the flat and delete its data and media after a grace period.
3. **Flat closure:** an owner-initiated "close this flat", with an export first.
4. **Storage cleanup:** deleted rows already release media through the cleanup worker. Account deletion must enqueue the user's avatar and any media it deletes.
5. **Support access:** no routine access to private flat data. Support works from IDs and counts. Any data access needs the member's written consent, and is logged.

**Operational logging rules**
- Log IDs, counts, error codes and timings.
- Never log notes, comments, addresses, photo paths or signed URLs, invite codes, tokens or email bodies.
- The existing worker and RPC errors already follow this; keep it as a review checklist item.

## 5. Recovery

- **Database:**
  - Rely on Pro daily backups (7-day retention), and consider point-in-time recovery once real users depend on it ⚑.
  - Restore drills restore into staging, never over production.
- **Media:**
  - Storage objects are not covered by database backups.
  - ⚑ Schedule a periodic copy of the `household-media` bucket to separate storage (e.g. a nightly sync to an S3-compatible bucket owned by the same organisation).
- **A failed migration:**
  - Migrations run in one transaction, so a failure leaves nothing half-applied.
  - Diagnose with `supabase_migrations.schema_migrations`, the advisors and the error.
  - Fix forward in a new migration.
- **Reverting the frontend:**
  - Revert the merge on `main`; Pages republishes the previous build.
  - Additive schema (Phase 10's included) stays, and the previous build ignores it.
  - Records created while the feature was live (appointments, time zones) are kept.
- **Removing schema** (rare):
  - Export first. The Phase 10 rollback refuses to drop appointments until an export has been confirmed.
  - It was tested locally: refusal without confirmation, an export to CSV, rollback, then re-apply.

## 6. The first iOS client

| | Capacitor (package the existing React app) | Dedicated native client (SwiftUI) |
|---|---|---|
| Code reuse | ~95%: same UI, providers, tests | UI rewritten; only backend reused |
| Auth and credential storage | Supabase JS with a Keychain-backed storage adapter (e.g. a secure-storage plugin) instead of `localStorage` | supabase-swift with Keychain |
| Universal Links / invite fallback | Associated domains plus app URL-open handling routed to `/join?code=…`; the web fallback stays | Native |
| Camera and photos | Capacitor Camera / photo picker; the existing compression pipeline is reused | Native PhotosPicker |
| Navigation and accessibility | Web semantics already tested (roles, labels, 44px targets); needs VoiceOver testing in WKWebView | Native, but rebuilt from scratch |
| CI and signing | Xcode project generated by Capacitor; Fastlane/Xcode Cloud for signing | Same |
| Maintenance | One codebase | Two UIs to keep in step |

**Recommendation:** run a Capacitor proof of concept. On a **physical iPhone**, it must demonstrate:
1. Sign-in, with the session in the Keychain surviving an app restart.
2. Opening an invite Universal Link cold and warm, landing on the invited flat.
3. Adding a photo with the camera and with the photo picker.
4. Switching flats.
5. Using the calendar, including the appointment sheet with the keyboard open and correct safe areas.
6. Realtime updates while the app is in the foreground, and a correct refresh after returning from the background.
7. A VoiceOver pass over Home, a room, the calendar and a sheet.
8. A cold start of under 2 s on a mid-range device.

**Minimum-functionality expectations** (App Review Guideline 4.2, "beyond a repackaged website"): Flat Quest already has app-like features — camera and photo capture, a shared live calendar, and offline handling with clear states. Native polish to add for the store build: haptics on ticks and claims, the native share sheet for invites, and Universal Links. Push notifications would strengthen the case, but they are a separate milestone.

## 7. App Store checklist

| Item | Owner | Evidence required | Status |
|---|---|---|---|
| In-app account deletion (Guideline 5.1.1(v)), including the sole-owner path (§4) | Owner + developer | Settings → Delete account flow, tested with synthetic accounts | **Not started** ⚑ |
| Sign in with Apple, if Google sign-in is offered on iOS (Guideline 4.8 equivalent login option) | Developer | Apple provider configured on staging, then production; or Google hidden in the iOS build | Not started ⚑ |
| Privacy policy URL and App Store privacy "nutrition label" (contact info, user content, identifiers; no tracking) | Owner | Published page; App Store Connect form | Not started |
| Supported territories and age rating | Owner | App Store Connect | Not started |
| Support URL / contact | Owner | Page with an email address | Not started |
| Reporting and abuse controls for photos and comments (user-generated content) | Developer | "Report" action → support queue; owner can remove; a block or leave-flat path | Not started |
| Reviewer access: a synthetic demo account in a seeded demo flat, plus invite instructions | Developer | Demo credentials in review notes; demo data reset script | Not started |
| Reachable production backend during review | Owner | Status checks | — |
| Screenshots (6.7″, 6.1″, iPad if supported) | Developer | Generated from synthetic data | Not started |
| Developer account, bundle ID, signing certificates, provisioning | Owner | Apple Developer Program membership | Not started ⚑ |
| Device testing and TestFlight (internal, then external) | Developer | Test matrix: physical iPhone SE-size and Pro-size | Not started |
| Phased rollout and operational support | Owner | Rollout plan, on-call contact | Not started |

Out of scope until separately approved milestones: native packaging, Apple provider configuration, push notifications, public account deletion, monetisation, and store submission.

## 8. Open questions for the owner ⚑

1. A staging project: Free (pauses when idle) or Pro?
2. The email provider (Resend or Postmark) and the sending domain.
3. A custom domain, and when.
4. The account-deletion policy for shared history and photos, and the sole-owner rule (§4).
5. Whether to cap memberships per person (suggested 10), and a per-flat storage quota (suggested 500 MB).
6. Who holds the Apple Developer account, and which entity (individual or organisation) publishes the app.
7. Media backup destination and budget.
