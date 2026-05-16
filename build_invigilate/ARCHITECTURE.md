# Technical Documentation - Exam Invigilation Scheduler

## Architecture Overview

### Single-File Design
The entire application is contained in one `index.html` file with:
- **HTML**: Semantic structure with Bootstrap 5
- **CSS**: Custom variables system for theming (embedded `<style>`)
- **JavaScript**: Vanilla JS class-based architecture (no frameworks)

### Design Pattern: Object-Oriented
```javascript
class ExamSchedulerApp {
  - Data management
  - DOM manipulation
  - Event handling
  - Storage operations
}
```

---

## Directory Structure Explanation

```
index.html          ← Complete application (all-in-one)
README.md           ← Full feature documentation
QUICKSTART.md       ← User guide
ARCHITECTURE.md     ← This file (technical reference)
```

Why single file?
- No build process required
- No deployment complexity
- Offline-first capable
- Easy to version control
- Simple to share via email/USB
- Fast loading

---

## Core Components

### 1. HTML Structure
```html
<div class="sidebar">          <!-- Fixed navigation -->
<div class="main-container">  <!-- Content area -->
  <div class="top-bar">       <!-- Section header -->
  <div class="content">        <!-- Dynamic sections -->
```

### 2. CSS System (Custom Properties)
```css
:root {
  --primary: #1e3a5f;         /* Main brand color -->
  --accent: #0d9488;          /* Action highlights -->
  --text-dark: #1e293b;       <!-- Text color -->
  --light-bg: #f8fafc;        <!-- Backgrounds -->
}
```

### 3. JavaScript Classes

#### ExamSchedulerApp
Main application class handling:

```javascript
constructor()        // Initialize app
init()              // Set up event listeners
setupEventListeners() // Register click handlers
showSection()       // Switch between views
processUpload()     // Parse Excel files
populateScheduleTable() // Render schedule
autoAllocate()      // Assign teachers
saveToStorage()     // Persist data
loadFromStorage()   // Retrieve data
```

---

## Data Flow Diagram

```
User Uploads Excel Files
        ↓
XLSX.js parses files
        ↓
Data stored in:
  - this.scheduleData []
  - this.teachersData []
  - this.allocationMap Map()
        ↓
All data persisted to localStorage
        ↓
DOM renders based on current section
        ↓
User interactions update data
        ↓
Changes saved back to localStorage
```

---

## Key Methods Reference

### File Upload & Processing

```javascript
processUpload()
├── Read Assignments file with FileReader
├── Parse with XLSX.read()
├── Read Teachers file with FileReader
├── Store in this.scheduleData / this.teachersData
└── Save to localStorage

setupEventListeners()
├── Navigation clicks → showSection()
├── File inputs → drag-drop setup
├── Modal interactions
└── Filter buttons
```

### Data Display & Filtering

```javascript
populateScheduleTable()
├── Get current section's data
├── Filter based on user selections
├── Generate HTML table rows
├── Insert into DOM

filterSchedule()
├── Read filter select values
├── Filter scheduleData array
├── Call populateScheduleTable()
└── Update display
```

### Teacher Allocation

```javascript
autoAllocate()
├── Find unassigned slots
├── Get available teachers
├── Randomly assign teachers
├── Store in allocationMap
└── Save to localStorage

openAllocationModal()
├── Create form UI with teacher options
├── Display current slot details
└── Show modal with form

saveAllocation()
├── Update scheduleData
├── Update allocationMap
├── Save to localStorage
└── Refresh display
```

### Data Persistence

```javascript
saveToStorage()
├── JSON.stringify(scheduleData)
├── localStorage.setItem('scheduleData', ...)
├── JSON.stringify(teachersData)
├── localStorage.setItem('teachersData', ...)
├── JSON.stringify(allocationMap)
└── localStorage.setItem('allocationMap', ...)

loadFromStorage()
├── Get 'scheduleData' from localStorage
├── JSON.parse() → this.scheduleData
├── Get 'teachersData' from localStorage
├── JSON.parse() → this.teachersData
├── Get 'allocationMap' from localStorage
└── new Map(JSON.parse(...))
```

---

## Data Structures

### scheduleData Array
```javascript
[
  {
    Date: Date object,           // Exam date
    Session: 1 | 2,             // Session number
    Grade: "8" | "9" | "10" | "11" | "12" | "SUPP",
    TimeShift: number,          // Duration in hours
    Exam: string,               // Subject name
    "Venue Number": number | string, // Venue ID
    Educator: string            // Teacher name (assigned)
  },
  // ... more entries
]
```

### teachersData Array
```javascript
[
  {
    "Register class": string,   // Grade or ROTATE
    "Educator": string,         // Teacher name
    "Learners": number,         // Student count
    "Zulu": string | null       // Language (optional)
  },
  // ... more entries
]
```

### allocationMap Map
```javascript
new Map([
  [0, "Smith"],        // Index 0 → Teacher "Smith"
  [1, "Stow"],         // Index 1 → Teacher "Stow"
  [5, "Jones"],        // Index 5 → Teacher "Jones"
  // ... more mappings
])
```

---

## Customization Guide

### 1. Change Colors

Edit `:root` variables in `<style>`:
```css
:root {
  --primary: #1e3a5f;    /* Change to your brand color */
  --accent: #0d9488;     /* Change to highlight color */
  --danger: #dc2626;     /* Change warning color */
  /* ... update all colors */
}
```

### 2. Add New Section

```html
<!-- 1. Add navigation link -->
<a class="nav-link" href="#" data-section="newsection">
  <i class="fas fa-icon"></i> New Section
</a>

<!-- 2. Add section content -->
<section id="newsection" class="section hidden">
  <div class="card">
    <div class="card-header">
      <h3>My New Section</h3>
    </div>
    <div class="card-body">
      <!-- Your content here -->
    </div>
  </div>
</section>

<!-- 3. Update showSection() titles -->
const titles = {
  dashboard: 'Dashboard',
  newsection: 'My New Section'  // Add here
};
```

### 3. Add New Function

```javascript
// Add to ExamSchedulerApp class
myNewFunction() {
  // Your code here
  const data = this.scheduleData; // Access data
  this.saveToStorage();           // Persist changes
  this.updateDashboard();         // Refresh display
}

// Call from UI:
// <button onclick="app.myNewFunction()">Click Me</button>
```

### 4. Modify Export Format

```javascript
exportSchedule() {
  // Current: exports everything
  // Customize which columns:
  const filtered = this.scheduleData.map(row => ({
    Date: row.Date,
    Exam: row.Exam,
    Teacher: row.Educator
    // Remove: TimeShift, Session, etc.
  }));
  
  const ws = XLSX.utils.json_to_sheet(filtered);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
  XLSX.writeFile(wb, 'schedule.xlsx');
}
```

### 5. Add Validation Rules

```javascript
processUpload() {
  // ... existing code ...
  
  // Add validation:
  const hasErrors = this.scheduleData.some(row => {
    return !row.Date || !row.Exam || !row.Grade;
  });
  
  if (hasErrors) {
    alert('Error: Some required fields are empty');
    return;
  }
  
  // Continue processing...
}
```

---

## Performance Optimization

### Current Limits
- Safe for ~500 schedule entries
- Safe for ~200 teachers
- ~10MB Excel file size max

### Optimization Strategies

**For large datasets (1000+ entries):**

```javascript
// Use pagination instead of showing all rows
const ROWS_PER_PAGE = 50;
let currentPage = 1;

displayPage(page) {
  const start = (page - 1) * ROWS_PER_PAGE;
  const end = start + ROWS_PER_PAGE;
  const pageData = this.scheduleData.slice(start, end);
  // Render only pageData
}
```

**For slow file uploads:**

```javascript
// Add progress indicator
reader.onprogress = (event) => {
  const progress = (event.loaded / event.total) * 100;
  document.getElementById('progress').value = progress;
};
```

**For large table rendering:**

```javascript
// Use virtual scrolling (render only visible rows)
// Or use server-side pagination
// Or export and open in Excel for analysis
```

---

## Firebase Integration Code

### Setup
```javascript
// Add to <head>
<script src="https://www.gstatic.com/firebaseapp/11.0.1/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebaseapp/11.0.1/firebase-firestore.js"></script>

<script>
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-bucket.appspot.com",
  messagingSenderId: "YOUR_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
</script>
```

### Add to ExamSchedulerApp class
```javascript
async syncToFirebase() {
  try {
    // Sync schedules
    const scheduleBatch = db.batch();
    this.scheduleData.forEach((doc, idx) => {
      const ref = db.collection('schedules').doc(idx.toString());
      scheduleBatch.set(ref, {
        ...doc,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await scheduleBatch.commit();
    
    // Sync teachers
    const teacherBatch = db.batch();
    this.teachersData.forEach((doc, idx) => {
      const ref = db.collection('teachers').doc(idx.toString());
      teacherBatch.set(ref, doc);
    });
    await teacherBatch.commit();
    
    console.log('✓ Synced to Firebase');
  } catch (error) {
    console.error('✗ Sync failed:', error);
  }
}

async loadFromFirebase() {
  try {
    const schedQuery = await db.collection('schedules').get();
    this.scheduleData = schedQuery.docs.map(d => d.data());
    
    const teachQuery = await db.collection('teachers').get();
    this.teachersData = teachQuery.docs.map(d => d.data());
    
    console.log('✓ Loaded from Firebase');
    this.updateDashboard();
  } catch (error) {
    console.error('✗ Load failed:', error);
  }
}
```

### Call after save:
```javascript
saveToStorage() {
  // ... existing save code ...
  if (navigator.onLine) {
    this.syncToFirebase(); // Optional cloud sync
  }
}
```

---

## Browser APIs Used

| API | Purpose |
|-----|---------|
| `localStorage` | Data persistence |
| `FileReader` | Parse uploaded files |
| `JSON` | Data serialization |
| `Date` | Date handling |
| `Map` | Teacher allocations |
| `fetch` | Potential future API calls |

---

## Debugging Tips

### Enable Console Logging
```javascript
// Add to init()
window.debugApp = this; // Access app in console as window.debugApp

// Or add logging to methods:
console.log('Schedule data:', this.scheduleData);
console.log('Teachers:', this.teachersData);
console.log('Allocations:', this.allocationMap);
```

### Check Browser Storage
```javascript
// In browser console:
localStorage.getItem('scheduleData')
localStorage.getItem('teachersData')
localStorage.getItem('allocationMap')

// Clear storage if needed:
localStorage.clear()
```

### Monitor Events
```javascript
// Add to setupEventListeners():
document.addEventListener('click', (e) => {
  console.log('Clicked:', e.target);
});
```

---

## Security Considerations

### Current Implementation
- ✅ Data stored locally (no server transmission)
- ✅ No authentication required (for offline use)
- ✅ No database vulnerabilities
- ✅ XSS protection via innerText for user data

### When Adding Features
- ❌ Don't send raw data to untrusted APIs
- ❌ Don't store sensitive passwords in localStorage
- ❌ Always validate user inputs
- ❌ Don't execute eval() on user data
- ✅ Use CORS headers if calling APIs
- ✅ Implement CSRF tokens for forms

### Privacy Best Practices
- Inform users data is stored locally
- Provide data export option
- Provide data deletion option
- Don't collect unnecessary data
- Respect user privacy settings

---

## Deployment Options

### Option 1: Static Host (Recommended)
- GitHub Pages: Free, version controlled
- Netlify: Free, with CI/CD
- Vercel: Free, fast CDN
- Amazon S3: Low cost, scalable

### Option 2: School Server
- Copy index.html to web server
- No backend required
- Works over HTTP or HTTPS

### Option 3: Intranet
- Deploy on school's internal server
- Users access via school network
- No internet required

### Option 4: USB/Portable
- Copy index.html to USB drive
- Run directly from USB
- Works on any computer with browser

---

## Testing Checklist

- [ ] File upload works with both file types
- [ ] Data persists after page refresh
- [ ] Auto-allocate assigns all unassigned slots
- [ ] Manual allocation updates display
- [ ] Filters work correctly (date, grade)
- [ ] Exports create proper Excel files
- [ ] Works offline (disconnect internet, refresh)
- [ ] Works on mobile (test on phone/tablet)
- [ ] All sections load without errors (F12 console)
- [ ] Navigation between sections works
- [ ] Online/offline indicator shows correct status

---

## Troubleshooting Guide for Developers

| Issue | Debug Steps |
|-------|------------|
| Data not saving | Check localStorage enabled, console for errors |
| Upload fails | Verify Excel format, check file size, test parser |
| Table not updating | Check DOM selectors, console for errors, refresh |
| Auto-allocate not working | Verify teachers loaded, check allocation logic |
| Export broken | Check XLSX.js loaded, verify data format |
| Offline not working | Check manifest, service worker, storage API |

---

## Future Enhancement Ideas

### Phase 2
- [ ] User authentication (email/password)
- [ ] Multi-user real-time sync (Firebase)
- [ ] Conflict detection (same teacher, overlapping times)
- [ ] Workload balancing algorithm

### Phase 3
- [ ] Dark mode toggle
- [ ] Internationalization (multiple languages)
- [ ] Calendar view (instead of table)
- [ ] Email notifications
- [ ] Mobile app (React Native/Flutter)

### Phase 4
- [ ] Advanced reporting (PDF generation)
- [ ] Automated scheduling algorithm
- [ ] Teacher preferences/constraints
- [ ] Room/venue management
- [ ] Mobile check-in/sign-out

---

## Code Style Guide

### Naming Conventions
```javascript
// Variables: camelCase
const scheduleData = [];
let currentPage = 1;

// Functions: camelCase
function populateScheduleTable() {}
async function syncToFirebase() {}

// Classes: PascalCase
class ExamSchedulerApp {}

// Constants: UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 10485760; // 10MB
const ROWS_PER_PAGE = 50;

// Private methods: prefix with _
_parseExcelFile() {}
```

### HTML Classes
```html
<!-- Meaningful names -->
<div class="schedule-table">    ✅ Good
<div class="table-schedule">    ✅ Also OK
<div class="t1">               ❌ Avoid

<!-- Avoid presentational -->
<div class="red-text">         ❌ Use semantic instead
<div class="bold-large">       ❌ Use semantic instead
<div class="error-message">    ✅ Semantic
```

### CSS Organization
```css
/* 1. Variables */
:root { /* colors */ }

/* 2. Base styles */
body { }
button { }

/* 3. Layout */
.sidebar { }
.main-container { }

/* 4. Components */
.card { }
.button { }

/* 5. Utilities */
.hidden { }
.mt-4 { }

/* 6. Responsive */
@media (max-width: 768px) { }
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | May 2026 | Initial release |
| 1.1.0 | TBD | Firebase integration |
| 2.0.0 | TBD | Multi-user support |

---

**Document Version**: 1.0.0
**Last Updated**: May 2026
