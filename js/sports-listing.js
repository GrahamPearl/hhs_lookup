/* =========================
   Team Manager (Activity + Age Group)
   ========================= */

const STORAGE_KEY = "activityTeams";
const DATA_URL = "./students.json";
const LIST_URL_AGEGROUP = "list_of_teams.txt";
const LIST_URL_ACTIVITY = "list_of_sports.txt";

let students = [];
let activities = [];
let age_groups = [];
let team = {};

/* ---------- Data Loaders ---------- */

async function loadStudents() {
  const res = await fetch(DATA_URL);
  students = await res.json(); // expects [{ adminNo, firstName, lastName, registrationClass, photo }, ...]
}

async function loadActivities() {
  const res = await fetch(LIST_URL_ACTIVITY);
  const text = await res.text();
  const lines = text.split("\n");
  lines.forEach((line) => {
    if (!line.trim()) return;
    const parts = line.split(";");
    const name = (parts[1] || "").replace(/"/g, "").trim();
    if (name) activities.push(name);
  });
}

async function loadAgeGroups() {
  const res = await fetch(LIST_URL_AGEGROUP);
  const text = await res.text();
  const lines = text.split("\n");
  lines.forEach((line) => {
    if (!line.trim()) return;
    const parts = line.split(";");
    const name = (parts[1] || "").replace(/"/g, "").trim();
    if (name) age_groups.push(name);
  });
}

/* ---------- UI Helpers ---------- */

function populateDropdownActivities() {
  const select = document.getElementById("activitySelect");
  select.innerHTML = '<option value="">-- Select Activity --</option>';
  activities.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    select.appendChild(opt);
  });
}

function populateDropdownAgeGroup() {
  const select = document.getElementById("agegroupSelect");
  select.innerHTML = '<option value="">-- Select Age Group --</option>';
  age_groups.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    select.appendChild(opt);
  });
}

/* ---------- Local Storage ---------- */

function loadTeamStorage() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (data) {
    try {
      team = JSON.parse(data);
    } catch {
      team = {};
    }
  }
}

function saveTeamStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
}

/* ---------- Selection Helpers ---------- */

function currentActivity() {
  return document.getElementById("activitySelect").value;
}

function currentAgeGroup() {
  return document.getElementById("agegroupSelect").value;
}

function currentKey() {
  const act = currentActivity();
  const age = currentAgeGroup();
  return act && age ? `${act}|${age}` : "";
}

/* ---------- Domain Helpers ---------- */

function findStudent(admin) {
  return students.find((s) => s.adminNo === admin);
}

/* ---------- CRUD ---------- */

function addStudent() {
  const admin = document.getElementById("adminInput").value.trim();
  const key = currentKey();

  if (!admin || !key) return;

  if (!team[key]) team[key] = [];
  if (team[key].includes(admin)) return;

  const student = findStudent(admin);
  if (!student) {
    alert("Student not found");
    return;
  }

  team[key].push(admin);
  saveTeamStorage();
  render();
}

function removeStudent() {
  const admin = document.getElementById("adminInput").value.trim();
  const key = currentKey();
  if (!admin || !key || !team[key]) return;

  team[key] = team[key].filter((a) => a !== admin);
  saveTeamStorage();
  render();
}

/* ---------- Render ---------- */

function render() {
  const container = document.getElementById("team");
  const act = currentActivity();
  const age = currentAgeGroup();
  const key = currentKey();

  document.getElementById("teamTitle").innerText =
    act && age ? `${act} – ${age} Team` : "";

  container.innerHTML = "";
  if (!key || !team[key] || team[key].length === 0) return;

  // sort by first+last name
  const list = [...team[key]];
  list.sort((a, b) => {
    const sa = findStudent(a);
    const sb = findStudent(b);
    const na = ((sa?.firstName) || "") + " " + ((sa?.lastName) || "");
    const nb = ((sb?.firstName) || "") + " " + ((sb?.lastName) || "");
    return na.localeCompare(nb);
  });

  list.forEach((admin) => {
    const s = findStudent(admin);
    if (!s) return;
    const div = document.createElement("div");
    div.className = "student";
    div.innerHTML = `
      <img src="../photos/${s.photo}" alt="${s.firstName} ${s.lastName}">
      <div class="name">${s.firstName} ${s.lastName}</div>
      <div class="admin">${s.adminNo}</div>
      <div class="class">${s.registrationClass || ""}</div>
    `;
    container.appendChild(div);
  });
}

/* ---------- Export / Import ---------- */

// JSON (scoped to Activity+Age)
function exportTeam() {
  const act = currentActivity();
  const age = currentAgeGroup();
  const key = currentKey();
  const data = (key && team[key]) ? team[key] : [];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(act || "Activity").replace(/\s/g, "_")}_${(age || "Age").replace(/\s/g, "_")}_team.json`;
  a.click();
}

// Excel (.xlsx) for current Activity+Age
function exportTeamExcel() {
  const act = currentActivity();
  const age = currentAgeGroup();
  const key = currentKey();

  if (!act || !age) {
    alert("Please select an Activity and Age Group first.");
    return;
  }

  const adminList = (key && team[key]) ? team[key] : [];
  if (adminList.length === 0) {
    alert("No students in this team to export.");
    return;
  }

  // Expand admin numbers -> row objects using students.json schema
  const rows = adminList
    .map((admin) => findStudent(admin))
    .filter(Boolean)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    .map((s, i) => ({
      "#": i + 1,
      "First Name": s.firstName || "",
      "Last Name": s.lastName || "",
      "Admin No": s.adminNo || "",
      "Registration Class": s.registrationClass || "",
      "Activity": act,
      "Age Group": age,
    }));

  const ws = XLSX.utils.json_to_sheet(rows, { origin: 0 });

  // Optional column widths
  ws["!cols"] = [
    { wch: 4 },   // #
    { wch: 16 },  // First Name
    { wch: 18 },  // Last Name
    { wch: 12 },  // Admin No
    { wch: 18 },  // Registration Class
    { wch: 18 },  // Activity
    { wch: 12 },  // Age Group
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${act} ${age}`.slice(0, 31));
  const filename = `${act.replace(/\s/g, "_")}_${age.replace(/\s/g, "_")}_team.xlsx`;
  XLSX.writeFile(wb, filename);
}

function importTeam() {
  const file = document.getElementById("importFile").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const key = currentKey();
    if (!key) {
      alert("Please select an Activity and Age Group before importing.");
      return;
    }
    try {
      team[key] = JSON.parse(e.target.result);
    } catch {
      alert("Invalid JSON file.");
      return;
    }
    saveTeamStorage();
    render();
  };
  reader.readAsText(file);
}

function printTeam() {
  window.print();
}

/* ---------- Wiring ---------- */

document.getElementById("activitySelect").addEventListener("change", render);
document.getElementById("agegroupSelect").addEventListener("change", render);

async function init() {
  await loadStudents();
  await loadActivities();
  await loadAgeGroups();
  populateDropdownActivities();
  populateDropdownAgeGroup();
  loadTeamStorage();
  render();
}

init();