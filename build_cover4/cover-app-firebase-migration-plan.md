# Cover Management App → Firebase Migration Plan

**Purpose of this file:** paste the relevant section into a *new* Claude.ai chat when
you start each build session, instead of re-uploading the whole current app. This
keeps token usage low and lets each session focus on one module only.

Current app (reference, do not re-upload): `index.html`, `script.js`, `reports.js`,
`styles.css` — a Bootstrap + localStorage single-page app for allocating teacher
cover, tracked over a rolling 10-week fairness period.

---

## 1. What the Current App Already Does (baseline to preserve)

- **Teacher data**: one localStorage key per teacher (`teacher_<name>`) holding a
  timetable `entries[]` of `{row (day 0-4), col (period 0-5), type: lesson|free|meeting,
  subject, className, venue, doNotDisturb, lastResort}`.
- **Absences**: full-day (`absentTeachers[]`) and partial (`partialAbsentTeachers{name: [periods]}`),
  each with a per-teacher reason (`absentTeacherReasons{}`).
- **Cover assignment**: manual drag-drop, or auto-assign via 3 strategies (Fair,
  Round-Robin, Day-Balancing), with a **preview-then-apply** step and undo.
- **Fairness constraints** (soft, auto-assign only): exclude DND teachers, free-periods-only
  option, max covers/day, max covers/week, "last resort" teachers used only when no one else
  is available.
- **History**: every applied cover is logged (`coverHistory[]`) with date/week/period/subject/
  reason — this is the source of truth for fairness scoring (`(max-min)/avg` ratio → 0-100 score).
- **10-week rolling period**: a start date defines "Week 1"; everything resets when reset.
- **Reports**: daily cover sheet, daily absence summary, weekly cover load, 10-week fairness
  overview, auto-assign effectiveness, audit log, per-teacher cover history.
- **Export**: Excel (xlsx), PDF, print, email (mailto), full JSON backup/restore.
- **Settings**: fairness rules, custom absence reasons list, period management.

## 2. Migration Goals

1. Move storage from `localStorage` → **Firestore**, so data is shared/synced, not per-browser.
2. Keep the same functional feature set; modernize the UI.
3. Add the new soft-constraint: **a cover teacher should not repeat within the same
   Mon–Fri week, and preferably not on consecutive days**, when an alternative exists.
4. Ship as a **Firebase Hosting** static site.

## 3. Tech Stack Decision

| Layer | Choice | Why |
|---|---|---|
| Hosting | Firebase Hosting | Free tier, matches your ask, trivial `firebase deploy`. |
| Data | Firestore (NoSQL) | Realtime, works well with Hosting, generous free tier. |
| Auth | Firebase Auth — **Email link sign-in only**, single "staff" role to start. Add custom claims (admin vs viewer) later if needed. | Passwordless, low setup, no PII left world-readable once wired up. |
| UI | **Tailwind CSS + DaisyUI, fully adopting DaisyUI's default theme/components** (via CDN, no build step needed for a static Firebase site) — not a Bootstrap-lookalike restyle | Fastest path to a clean modern look; components (modal, drawer, table, badge, tabs) map directly onto the current layout without hand-tuning Bootstrap-style overrides. |
| App logic | Plain JS modules (ES modules), no framework required — the existing app is already vanilla JS event-driven; a full SPA framework is not needed for this scope. | Keeps it lightweight; easiest 1:1 port from `script.js`. |

## 4. Firestore Schema

```
teachers/{teacherId}
  name: string
  dnd: bool                  // do-not-disturb (from old doNotDisturb flags)
  lastResort: bool
  timetable: [                // embed — max 30 entries (5 days x 6 periods), well under 1MB doc limit
    { day: 0-4, period: 0-5, type: "lesson"|"free"|"meeting",
      subject, className, venue }
  ]

teacherMetrics/{teacherId}      // DENORMALIZED — updated on every cover write, avoids
  totalCovers: number           // scanning full coverHistory for fairness score each time
  coversThisWeek: number
  daySlotsCoveredThisWeek: [0-4]   // simple array, reset when tenWeekPeriod week rolls over —
                                    // powers the "review first" flag in the cover-grid module (§7 Session 5),
                                    // NOT a filter/constraint used by the auto-assign engine
  lastCoverDate: string
  coversByWeek: { "1": n, "2": n, ... "10": n }   // cheap 10-week lookups

coverHistory/{entryId}
  date: string (YYYY-MM-DD)
  week: number (1-10)
  daySlot: number (0-4)             // the rotation day (Day 1-5 dropdown) — NOT necessarily
                                     // the real weekday, since the rotation can shift/skip
  period: number (0-5)
  coveredTeacherId, coverTeacherId
  subject, className, venue
  absentReason: string
  timestamp: server timestamp

dailyPlans/{date}                 // doc id = real calendar date (YYYY-MM-DD), needed for
                                   // week-number math; the "which rotation day is this"
                                   // choice stays a manual 0-4 dropdown since rotation days
                                   // don't always line up with the calendar weekday
  daySlot: number (0-4)             // set from the existing Day 1-5 select
  absentTeacherIds: []
  partialAbsences: { teacherId: [periods] }
  absenceReasons: { teacherId: reason }
  coverAssignments: { "teacherId-period": coverTeacherId }
  noCoverNeeded: { "teacherId-period": true }

settings/fairness
  excludeDnd, freePeriodsOnly, maxCoversPerDay, maxCoversPerWeek, useLastResort

settings/absenceReasons
  reasons: [string]

settings/tenWeekPeriod
  startDate: string

auditLog/{entryId}
  timestamp, action, details, actorUid
```

**Why this shape:** Firestore has no server-side GROUP BY, so fairness ranking is kept
cheap by maintaining `teacherMetrics` as a running tally (updated in the same batch/
transaction that writes a `coverHistory` doc) rather than re-aggregating the full
history collection on every page load — mirrors what `script.js` already does with its
`teacherMetrics` localStorage cache, just moved server-side.

## 5. Security Rules (starting point)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;   // any signed-in staff member
    }
  }
}
```
Tighten later with role-based claims (e.g. only admins can edit `settings/*`).

## 6. Core Logic to Port (condensed reference — no need to re-paste `script.js`)

**Fairness score:** `ratio = (max-min)/avg` over `teacherMetrics.totalCovers`;
`score = round(max(0, min(100, 100 - ratio*10)))`.

**Candidate filter for a period** (in order): not absent that period → has `free` or
(if allowed) `meeting` slot → not DND (if excludeDnd) → under `maxCoversPerDay` →
under `maxCoversPerWeek`. That's it — the auto-assign engine does **not** need to know
about repeat/consecutive-day usage (see below).

**"Review first" simplification (moved out of auto-assign, into the cover-grid module):**
rather than the engine tracking and filtering on prior-day/prior-week usage, the
**cover-grid module (Session 5)** simply reads each candidate's
`teacherMetrics.daySlotsCoveredThisWeek` and, if it's non-empty (or includes the
adjacent day slot), renders a **"⚠ Already covered this week — review" badge** next
to that teacher in both the manual drag-drop panel and the auto-assign preview list.
The human makes the final call; no extra query, no sort penalty, no history scan —
just one array already sitting on `teacherMetrics`.

**Three strategies**, all operate on the filtered/sorted candidate list per period:
- *Fair*: sort by `totalCovers` ascending.
- *Round-Robin*: cycle a flat list of all available teachers in index order.
- *Day-Balancing*: sort by covers-assigned-so-far-today, then `totalCovers`.

**Preview → Apply pattern**: compute assignments into a temp object, render for
confirmation, only write to `coverHistory`/`teacherMetrics` on Apply. Keep this —
it's a good UX safeguard worth preserving as-is.

## 7. Session Plan (build one module per Claude.ai chat)

| # | Session | Scope | Depends on | Output |
|---|---|---|---|---|
| 1 | Project scaffold | `firebase init hosting+firestore`, folder structure, Tailwind/DaisyUI CDN shell, security rules from §5 | — | `index.html`, `firebase.json`, `firestore.rules` |
| 2 | Auth | Firebase Auth email-link sign-in, auth guard on app shell | 1 | `auth.js` |
| 3 | Teacher/timetable module | Firestore CRUD for `teachers/{id}`, JSON import (reuse old bulk-import format) | 1 | `teachers.js` |
| 4 | Absence entry module | Add-absence modal (full/partial + reason), writes to `dailyPlans/{date}` | 1, 3 | `absences.js` |
| 5 | Cover grid module | Render grid for a day, manual drag-drop assign, "no cover needed", **"already covered this week" review-first badges from `teacherMetrics.daySlotsCoveredThisWeek`** | 1, 3, 4 | `coverGrid.js` |
| 6 | Auto-assign engine | Port §6 candidate filter + 3 strategies, preview modal (badges from Session 5 carry over into the preview list, no new logic needed here) | 1, 3, 4, 5 | `autoAssign.js` |
| 7 | Fairness metrics & dashboard | `teacherMetrics` write-through on Apply, dashboard summary widget | 6 | `fairness.js` |
| 8 | Reports module | Daily/weekly/10-week/audit reports (port `reports.js` logic to Firestore queries) | 6, 7 | `reports.js` |
| 9 | Settings module | Fairness rules, absence reasons, 10-week period management UI | 1 | `settings.js` |
| 10 | Export/print | Excel/PDF/print/email (reuse existing jsPDF/xlsx code, just swap data source) | 5, 6 | `exports.js` |
| 11 | Migration script | One-off Node/browser script: read old `localStorage` JSON backup → write to Firestore | 1, 3, 4 | `migrate.js` |
| 12 | Deploy & polish | `firebase deploy`, mobile check, final theming pass | all above | live site |

Each row is intentionally small enough to build, test, and deploy independently.

## 8. How to Prompt Each Session

At the start of a new chat, paste **only**:
- This file (or the relevant §4/§6/§7 row).
- The specific module file(s) you're extending, if any already exist.

Don't re-paste the whole legacy app each time — the schema and logic summary above
is enough context for Claude to generate a compatible module.

## 9. Decisions Locked In

- **Auth:** email-link sign-in only.
- **UI:** fully adopt Tailwind/DaisyUI default theming — no Bootstrap-lookalike styling.
- **dailyPlans key:** real calendar `{date}` (for week-number math), with a manual
  `daySlot` (0-4) field carried over from the existing Day 1-5 dropdown, since the
  rotation doesn't always match the calendar weekday.
- **Same-week/consecutive-day repeat check:** simplified to a read-only "review first"
  badge in the cover-grid module (Session 5), sourced from `teacherMetrics.daySlotsCoveredThisWeek`
  — not a filter or sort penalty in the auto-assign engine.
