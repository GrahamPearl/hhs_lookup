

## Change: Teacher Email File Format

**Current format:** `Teacher Name email@school.edu` (whitespace-separated)
**New format:** `Teacher Name, email@school.edu` (comma-separated)

### Changes

**File: `public/app.js` (~line 604)**
- Update the regex from `/^(.+?)\s+(\S+@\S+)$/` to `/^(.+?),\s*(\S+@\S+)$/`
- This splits on the first comma instead of whitespace, allowing teacher names with spaces to work naturally.

That's the only change needed — one regex update.

