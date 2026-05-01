# Teacher Print Queue System – Project Summary (AI Restart Context)

## Project Purpose
The **Teacher Print Queue System** is a browser-based application designed to manage, prioritise, and analyse print requests submitted by teachers. It provides accurate print-time estimation, transparent queue tracking, and admin-only analytics, all without server-side dependencies.

---

## Technology Stack
- **JavaScript:** Vanilla (no frameworks)
- **UI Framework:** Bootstrap 4
- **Persistence:** `localStorage`
- **State Structure:** `Map` object for O(1) job access
- **Charts:** Chart.js (ADMIN only)

---

## Core Architecture

### 1. State Management
- Jobs are stored in a `Map<number, Job>` called `jobs`
- Data is persisted via `localStorage`
- `AppState` manages loading/saving settings and jobs

### 2. Rendering Model
- A unified `rerenderAll()` function handles:
  - Sorting (FIFO / Due Time / Size)
  - Searching by teacher
  - Pagination
  - Queue rendering
  - Weekly Summary rendering
  - ADMIN-only chart updates

This ensures a **single source of truth for UI updates**.

---

## Job Lifecycle

1. **Queued** – Newly submitted job
2. **In process** – Actively being printed
3. **Completed** – Finished; moved to Weekly Summary

Global methods:
- `updateStatus(id, status)`
- `deleteJob(id)`

---

## Job Estimation Logic

Estimates account for:
- Page count
- Copies
- Single / Double sided
- 2-in-1 printing
- Additional tasks (trimming, stapling)
- Machine load & check times

Displayed live during job creation.

---

## User Roles

### Teacher (default)
- Submit print jobs
- View active queue

### Admin
- Secure login via `admin.env`
- Change job statuses
- Delete jobs
- Import teacher lists
- Import/export job logs
- View Weekly Summary
- View charts

---

## Weekly Summary (ADMIN)

- Displays completed jobs using the **same card layout** as the active queue
- Each completed job shows:
  - Requested time
  - Completed time
  - Due time

This supports auditing and turnaround analysis.

---

## Analytics & Charts (ADMIN-only)

### Teacher Pages Chart
- Bar chart
- Total pages printed per teacher

### Job Timeline Chart
- Bar chart by hour of day (0–23)
- **Only whole numbers** (job counts)
- Two datasets:
  - Completed on time (blue)
  - Completed late (red)

Late jobs are determined by comparing `completedAt` vs `scheduledFor`.

Charts are:
- Created only after ADMIN login
- Updated automatically on job completion
- Destroyed on logout

---

## File Imports

### Teacher Import (.txt)
- One name per line
- Populates both:
  - Requesting Teacher dropdown
  - Authoriser dropdown

### Todo / Legacy Job Import (.txt)
- One JSON object per line
- Normalises:
  - Legacy field names
  - Missing properties
- Automatically refreshes UI

---

## Persistence

Stored in `localStorage`:
- Jobs
- Settings
- Teachers
- ID counter

Reload-safe across browser sessions.

---

## Design Principles
- No backend dependency
- Predictable state changes
- Single render pipeline
- ADMIN-only access enforced in logic (not just UI)
- Extensible analytics layer

---

## When Restarting With an AI

Key files to provide:
- `index.html`
- `app.js`
- This summary file

Key instruction for the AI:
> Preserve Map-based state, unified rerenderAll(), job lifecycle, and ADMIN-only analytics.

---

End of summary.
