# SYSTEM PROMPT FOR AI RESTART
# You are loading this file to understand, maintain, and extend an existing vanilla-JS school print queue system. Preserve architecture, data model, and behaviour unless explicitly instructed otherwise.

---

# Teacher Print Queue System – Restart Summary (Canonical)

## 1. Project Purpose
A browser-based **Teacher Print & Photocopy Queue System** used in a school environment. Teachers submit print jobs; admins manage, prioritise, and complete them. The system emphasises fairness, deadline awareness, and minimal friction for staff.

The app runs **entirely client-side** (HTML, CSS, JS) using `localStorage`, with optional email notifications via `mailto:` (future SMTP hybrid planned).

---

## 2. Technology Stack
- **Frontend:** Vanilla JavaScript (no frameworks)
- **UI:** Bootstrap 4 + custom `styles.css`
- **Charts:** Chart.js (admin only)
- **Persistence:** `localStorage`
- **Environment:** Laragon (local PHP server; JS app is static)

---

## 3. Core Architecture & Design Rules (MUST PRESERVE)

### 3.1 State & Persistence
- All jobs are stored in a `Map` named `jobs`
- Persisted via `localStorage`
- `AppState` object handles:
  - loading
  - saving
  - admin settings
- No server-side database

### 3.2 Single Render Pipeline
- **`rerenderAll()` is the ONLY function that updates the UI**
- All UI changes are derived from state
- No direct DOM mutation outside render

---

## 4. Job Model (Canonical)
Each job object may contain:
```js
{
  id,
  teacher,
  authoriser,
  pages,
  copies,
  printType,
  sides,
  additionalTask,
  scheduledFor,
  status,               // Queued | In process | Completed
  requestedAt,
  completedAt,
  notificationStatus    // sent | skipped | disabled (completed jobs only)
}
```

---

## 5. Job Lifecycle
1. **Queued** – job submitted
2. **In process** – admin started printing
3. **Completed** – printing finished

State transition handled by:
```js
window.updateStatus(id, status)
```

---

## 6. Roles

### Teacher (default)
- Submit jobs
- View active queue

### Admin
- Login via `admin.env`
- Change status
- Delete / Clear jobs
- Import teacher lists
- Configure priority and settings
- View Weekly Summary & analytics

---

## 7. Priority & Sorting System
Sorting applies **only to active (incomplete) jobs**.

Supported `priorityMode` values:
- `fifo` – first submitted
- `due` – earliest due date
- `overdue` – overdue first
- `estimate` – shortest estimated print time
- `quick` – very fast jobs first
- `size` – pages × copies

Sorting logic lives **inside `rerenderAll()`**.

---

## 8. Quick Due-Date Filters (Active Queue)
Independent from sorting.

Supported filters:
- All
- Today
- Tomorrow
- This Week
- Overdue

State variable:
```js
let dueDateFilter = "all";
```
Filtering is applied **after search, before pagination**.

---

## 9. Search
- Single search box filters:
  - Active Queue
  - Completed (Weekly Summary)
- Matches teacher name

Variable:
```js
let searchQuery = "";
```

---

## 10. Urgency & Overdue Logic

### Active Queue
- `isUrgent(job)` → due within 3 hours
- `isOverdue(job)` → past due now

Applied ONLY to active jobs.

CSS classes applied during render:
- `.job-urgent`
- `.job-overdue`

### Completed Queue
- `wasOverdue(job)` → completed after due date

Never use `isOverdue` on completed jobs.

---

## 11. Styling Rules (IMPORTANT)

- Wrapper element **must have class `.job`**
- Modifiers applied to wrapper:
  - `.job-urgent`
  - `.job-overdue`
- Never apply urgency classes to `.card-body`

---

## 12. Weekly Summary (Admin)

- Shows completed jobs only
- Paginated (10 per page)
- Includes:
  - Requested time
  - Completed time
  - Due time
  - Notification status badge

### Late Job Reporting

Derived metric:
- % completed on time

Uses:
```js
wasOverdue(job)
```

---

## 13. Charts (Admin Only)

### Pages by Teacher
- Total pages printed

### Job Timeline
- By hour of completion
- Two datasets:
  - Completed on time
  - Completed late
- Whole numbers only

Charts:
- Initialise after admin login
- Destroy on logout

---

## 14. Email Notification System (Current + Future)

### Current Implementation
- Uses `mailto:`
- Triggered on job completion
- Controlled by admin toggle:
```js
emailNotificationsEnabled
```

### Teacher Email Mapping
- Imported via file:
```
Teacher Name; email@example.com
```

Stored as object in `localStorage`.

### Notification Status
Set when completing a job:
- `sent`
- `skipped` (no email on file)
- `disabled` (toggle off)

### ✅ Do not send email if toggle is OFF
Must check at send time using:
```js
isEmailNotificationEnabled()
```

### Future
- Planned SMTP + mailto hybrid (do not refactor yet)

---

## 15. Clear All
- Admin only
- Clears active + completed jobs
- Resets ID counter
- Calls `rerenderAll()`

---

## 16. Non-Negotiable Guardrails

❌ Do NOT:
- Introduce frameworks
- Mutate DOM outside `rerenderAll()`
- Mix completed & active urgency logic
- Break `Map`-based state

✅ ALWAYS:
- Derive UI from state
- Keep logic pure
- Add features incrementally

---

## 17. When Continuing Development
Start by restating:
> "Preserve existing architecture, state model, and render pipeline. Extend only as requested."

Then name the feature to implement.

---

End of canonical restart summary.
