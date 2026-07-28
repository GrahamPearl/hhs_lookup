# Session Log

Tracks what's built so a new Claude.ai chat can pick up a session with minimal
context. Full architecture reference: `cover-app-firebase-migration-plan.md`
(keep that file in your project notes, not in every chat).

## Status

| # | Session | Status | Notes |
|---|---|---|---|
| 1 | Project scaffold | ✅ Done | Hosting + Firestore config, DaisyUI shell, module stubs |
| 2 | Auth (email-link) | ⬜ Not started | Fill in `public/js/modules/auth.js` |
| 3 | Teacher/timetable module | ⬜ Not started | |
| 4 | Absence entry module | ⬜ Not started | |
| 5 | Cover grid module | ⬜ Not started | |
| 6 | Auto-assign engine | ⬜ Not started | |
| 7 | Fairness metrics & dashboard | ⬜ Not started | |
| 8 | Reports module | ⬜ Not started | |
| 9 | Settings module | ⬜ Not started | |
| 10 | Export/print | ⬜ Not started | |
| 11 | Migration script | ⬜ Not started | |
| 12 | Deploy & polish | ⬜ Not started | |

## What Session 1 built

```
cover-app-firebase/
├── firebase.json              # Hosting (public/) + Firestore config
├── .firebaserc                # ⚠️ replace REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID
├── firestore.rules            # signed-in-only, tighten later
├── firestore.indexes.json     # empty — sessions add compound indexes here
└── public/
    ├── index.html             # Tailwind (CDN) + DaisyUI (default theme "corporate")
    │                           # drawer + navbar shell, empty containers/modals
    │                           # with stable IDs for later sessions to render into
    ├── css/app.css             # intentionally minimal, print rule only
    └── js/
        ├── firebase-config.js  # ⚠️ replace REPLACE_ME values from Firebase console
        ├── app.js               # modal-open wiring only; auth toggle stubbed
        └── modules/
            ├── auth.js          # Session 2
            ├── teachers.js      # Session 3
            ├── absences.js      # Session 4
            ├── coverGrid.js     # Session 5
            ├── autoAssign.js    # Session 6
            ├── fairness.js      # Session 7
            ├── reports.js       # Session 8
            ├── settings.js      # Session 9
            ├── exports.js       # Session 10
            └── migrate.js       # Session 11
```

## Before Session 2

1. Create a Firebase project (console.firebase.google.com), enable
   **Firestore** and **Authentication → Email link (passwordless sign-in)**.
2. Fill in `.firebaserc` with your project ID.
3. Fill in `public/js/firebase-config.js` with your web app's SDK config.
4. `firebase login && firebase deploy --only hosting,firestore:rules` to
   confirm the scaffold deploys before building on top of it.

## How to start the next session

Paste into a new chat:
- This file (`SESSION-LOG.md`)
- The one module file you're extending (e.g. `auth.js`)
- The relevant row from `cover-app-firebase-migration-plan.md` §7, if you want
  the fuller schema/logic context

Update the status table above once a session is complete, so the next chat
knows what already exists.
