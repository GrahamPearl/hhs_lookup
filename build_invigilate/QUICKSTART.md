# Quick Start Guide - Exam Invigilation Scheduler

## 🚀 Getting Started (5 Minutes)

### Step 1: Open the App
1. Open `index.html` in your web browser
2. You'll see the Dashboard with empty statistics
3. Notice the sidebar on the left with navigation sections

### Step 2: Upload Your Data
1. Click **"Upload Data"** in the sidebar
2. You'll see two upload areas for Excel files
3. **Upload Area 1**: Drag your `Invigilator_Assignment_To_Venues.xlsx` file
   - Or click the area and select the file
4. **Upload Area 2**: Drag your `Teachers.xlsx` file
5. Click **"Process Files"** button
6. Wait for success messages to appear

### Step 3: View Your Schedule
1. Click **"Exam Schedule"** in the sidebar
2. All your exam slots will appear in a table
3. Use the filters at the top to:
   - Filter by specific date
   - Filter by grade (8, 9, 10, 11, or 12)

### Step 4: Assign Teachers
You have two options:

#### Option A: Auto-Allocate (Fastest)
1. Go to **"Teacher Allocation"**
2. Click **"Auto Allocate"** button
3. The app will automatically assign available teachers to unassigned slots
4. You'll see a success message with the number allocated

#### Option B: Manual Assignment
1. Go to **"Exam Schedule"**
2. Find a slot you want to assign
3. Click the **Edit** button (pencil icon)
4. Select a teacher from the dropdown
5. Click **"Save"**
6. The table will update immediately

### Step 5: View Dashboard
1. Click **"Dashboard"** to return to the main overview
2. You'll see updated statistics:
   - Total Slots
   - Assigned (slots with teachers)
   - Unassigned (slots without teachers)
   - Available Teachers

### Step 6: Export Your Results
1. Go to **"Reports"** section
2. Click any export button:
   - **Export Schedule** - All exam slots in Excel
   - **Export Allocations** - Assignments with teacher names
   - **Teacher List** - List of all teachers
   - **Print Schedule** - Print-friendly format

---

## 📋 What Each Section Does

| Section | Purpose |
|---------|---------|
| **Dashboard** | Overview with key statistics and recent assignments |
| **Upload Data** | Load your Excel files into the app |
| **Exam Schedule** | View, filter, and manage all exam slots |
| **Teacher Allocation** | Auto-allocate or manually assign teachers |
| **Reports** | Generate and export data in various formats |

---

## 💡 Pro Tips

### Tip 1: Keyboard Navigation
- Tab between fields for faster input
- Enter to submit forms
- Esc to close modals

### Tip 2: Filters
- Use multiple filters for precise searching
- Date filter shows all unique dates in your data
- Grade filter helps organize by level

### Tip 3: Bulk Operations
- Use **Auto Allocate** to quickly assign many teachers
- Refine manually after bulk assignment
- This saves time for large schedules

### Tip 4: Offline Work
- The app works completely offline
- Data automatically saves to your browser
- The status indicator (top right) shows connection status
- Green dot = Online, Red dot = Offline

### Tip 5: Exporting Data
- Exports are in Excel format (XLSX)
- Perfect for further analysis or sharing
- Includes all your assignments
- Can be reimported if needed

---

## ⚙️ System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection (for initial setup, not required after)
- ~50MB of free storage on your computer (if saving exports)

---

## 🔧 Troubleshooting

### Problem: "No data loaded" message
**Solution**: 
- Make sure you've uploaded both Excel files
- Click Process Files button
- Check the files have the correct format

### Problem: Upload button doesn't work
**Solution**:
- Try a different browser
- Ensure files are .xlsx or .xls format
- Check file isn't corrupted (try opening in Excel)

### Problem: Data disappeared after closing browser
**Solution**:
- This shouldn't happen - data is stored locally
- Try refreshing the page
- Check browser allows localStorage
- In Chrome: Settings > Privacy > Cookies > Allow all

### Problem: Auto-allocate not working
**Solution**:
- Ensure teachers are loaded (check dashboard shows teacher count > 0)
- Try allocating one teacher manually first
- Refresh page and try again

---

## 📊 Understanding the Status Indicators

| Badge | Meaning |
|-------|---------|
| 🟢 Assigned | A teacher has been assigned to this slot |
| 🔴 Unassigned | No teacher assigned yet (needs allocation) |
| 🟡 Pending | Data is being processed |

---

## 🎯 Workflow Examples

### Example 1: Basic Scheduling (15 minutes)
1. Upload files → Process → Auto-allocate → Done!
2. View results in Dashboard
3. Export to share with coordinators

### Example 2: Custom Assignments (30 minutes)
1. Upload files
2. Use Schedule view to find specific exams
3. Manually assign preferred teachers
4. Check Dashboard to verify coverage
5. Export final schedule

### Example 3: Conflict Resolution
1. View Schedule table
2. Look for conflicts (same teacher, multiple slots at same time)
3. Manually reassign one teacher to avoid conflict
4. Verify in Dashboard
5. Export corrected schedule

---

## 📱 Mobile Usage

The app is mobile-responsive:
- Sidebar adapts to screen size
- Tables are scrollable on small screens
- All buttons work on touch devices
- Recommended: Use on tablets for best experience

---

## 🔐 Data Privacy

Your data:
- ✅ Stays in your browser (localStorage)
- ✅ Never sent to external servers (unless you enable Firebase)
- ✅ Persists locally even after closing browser
- ✅ Can be manually cleared (browser settings)
- ✅ Is fully under your control

---

## 🚀 Next Steps

1. **Immediate**: Open the app and upload your data
2. **Short-term**: Use auto-allocate and review assignments
3. **Medium-term**: Fine-tune allocations as needed
4. **Final**: Export and distribute schedules

---

## ❓ Common Questions

**Q: Can multiple people use this app at the same time?**
A: Currently, data is local to each browser. For collaboration, consider setting up Firebase (see README for details).

**Q: How do I backup my data?**
A: Use the Export function to save Excel files. These are your backups.

**Q: Can I import data from other systems?**
A: Yes, if you can convert it to the Excel format matching the expected columns.

**Q: Is my data secure?**
A: Data stays on your computer in browser storage. More secure than cloud for private data.

**Q: Can I print the schedule directly?**
A: Yes! Use Reports > Print Schedule. Your browser's print dialog will appear.

---

## 🎓 Educational Use

This app is designed for schools/institutions to:
- Manage large exam schedules efficiently
- Allocate teacher invigilators fairly
- Generate official documents
- Track all assignments
- Support offline operation in areas with limited connectivity

---

## 📞 Support

If you encounter issues:
1. Check this guide for solutions
2. Try clearing browser cache
3. Try a different browser
4. Ensure Excel files are properly formatted
5. Check browser console for error messages (F12)

---

**Version**: 1.0.0 | **Last Updated**: May 2026
