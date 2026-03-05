const STORAGE_KEY = "activityTeams";
const DATA_URL = "../students.json";
const LIST_URL = "list_of_sports.txt";

let students = [];
let activities = [];
let team = {};

async function loadStudents() {
  const res = await fetch(DATA_URL);
  students = await res.json();
}

async function loadActivities() {
  const res = await fetch(LIST_URL);

  const text = await res.text();

  const lines = text.split("\n");

  lines.forEach((line) => {
    if (!line.trim()) return;

    const parts = line.split(";");

    const name = parts[1].replace(/"/g, "").trim();

    activities.push(name);
  });
}

function populateDropdown() {
  const select = document.getElementById("activitySelect");

  activities.forEach((a) => {
    const opt = document.createElement("option");

    opt.value = a;
    opt.textContent = a;

    select.appendChild(opt);
  });
}

function loadTeamStorage() {
  const data = localStorage.getItem(STORAGE_KEY);

  if (data) {
    team = JSON.parse(data);
  }
}

function saveTeamStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
}

function currentActivity() {
  return document.getElementById("activitySelect").value;
}

function findStudent(admin) {
  return students.find((s) => s.adminNo === admin);
}

function addStudent() {
  const admin = document.getElementById("adminInput").value.trim();

  const activity = currentActivity();

  if (!team[activity]) team[activity] = [];

  if (team[activity].includes(admin)) return;

  const student = findStudent(admin);

  if (!student) {
    alert("Student not found");
    return;
  }

  team[activity].push(admin);

  saveTeamStorage();

  render();
}

function removeStudent() {
  const admin = document.getElementById("adminInput").value.trim();

  const activity = currentActivity();

  if (!team[activity]) return;

  team[activity] = team[activity].filter((a) => a !== admin);

  saveTeamStorage();

  render();
}

function render() {
  const container = document.getElementById("team");

  const activity = currentActivity();

  document.getElementById("teamTitle").innerText = activity + " Team";

  container.innerHTML = "";

  if (!team[activity]) return;

  const list = [...team[activity]];

  list.sort((a, b) => {
    const sa = findStudent(a);
    const sb = findStudent(b);

    const na = sa.firstName + " " + sa.lastName;
    const nb = sb.firstName + " " + sb.lastName;

    return na.localeCompare(nb);
  });

  list.forEach((admin) => {
    const s = findStudent(admin);

    if (!s) return;

    const div = document.createElement("div");

    div.className = "student";

    div.innerHTML = `
        <img src="../photos/${s.photo}">
        <div class="name">${s.firstName} ${s.lastName}</div>
        <div class="admin">${s.adminNo}</div>
        `;

    container.appendChild(div);
  });
}

function exportTeam() {
  const activity = currentActivity();

  const data = team[activity] || [];

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");

  a.href = url;
  a.download = activity.replace(/\s/g, "_") + "_team.json";

  a.click();
}

function importTeam() {
  const file = document.getElementById("importFile").files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    const activity = currentActivity();

    team[activity] = JSON.parse(e.target.result);

    saveTeamStorage();

    render();
  };

  reader.readAsText(file);
}

function printTeam() {
  window.print();
}

document.getElementById("activitySelect").addEventListener("change", render);

async function init() {
  await loadStudents();

  await loadActivities();

  populateDropdown();

  loadTeamStorage();

  render();
}

init();
