/* =========================
   Team Manager (Activity + Age Group)
   With Firestore Cloud Sync
   ========================= */

const STORAGE_KEY   = "activityTeams";
const DATA_URL      = "../students.json";
const LIST_URL_AGEGROUP  = "list_of_teams.txt";
const LIST_URL_ACTIVITY  = "list_of_sports.txt";
const FIRESTORE_CONFIG_URL = "./firestore.config";
const FS_COLLECTION = "teamPlayers";

let students    = [];
let activities  = [];
let age_groups  = [];
let team        = {};

/* ── Firestore state ─────────────────────────────────────── */
let db          = null;          // Firestore instance (set after config load)
let fsReady     = false;         // true once Firebase initialised
let fsError     = null;          // holds error message if init failed

/* ══════════════════════════════════════════════════════════
   SYNC INDICATOR
   States: idle | syncing | synced | error
   ══════════════════════════════════════════════════════════ */

const INDICATOR_STATES = {
  idle:    { cls: "sync-idle",    icon: "☁",  text: "Cloud sync ready"   },
  syncing: { cls: "sync-syncing", icon: "↻",  text: "Syncing…"           },
  synced:  { cls: "sync-synced",  icon: "✓",  text: "Saved to cloud"     },
  error:   { cls: "sync-error",   icon: "⚠",  text: "Sync unavailable"   },
  offline: { cls: "sync-offline", icon: "✗",  text: "Cloud not connected" },
};

function setSyncState(state, detail) {
  const el = document.getElementById("syncIndicator");
  if (!el) return;
  const cfg = INDICATOR_STATES[state] || INDICATOR_STATES.idle;

  // Remove all state classes then apply the new one
  Object.values(INDICATOR_STATES).forEach(s => el.classList.remove(s.cls));
  el.classList.add(cfg.cls);

  const iconEl   = el.querySelector(".sync-icon");
  const labelEl  = el.querySelector(".sync-label");
  if (iconEl)  iconEl.textContent  = cfg.icon;
  if (labelEl) labelEl.textContent = detail ? `${cfg.text} — ${detail}` : cfg.text;

  // Spinning animation only while syncing
  if (iconEl) iconEl.classList.toggle("spinning", state === "syncing");
}

/* ══════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   Lightweight, non-blocking confirmation/error messages.
   Used by addStudent / removeStudent instead of alert().
   ══════════════════════════════════════════════════════════ */

function injectToastStyles() {
  if (document.getElementById("appToastStyle")) return;
  const style = document.createElement("style");
  style.id = "appToastStyle";
  style.textContent = `
    #appToastStack {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 320px;
    }
    .app-toast {
      padding: 10px 14px;
      border-radius: 6px;
      font-family: system-ui, sans-serif;
      font-size: 0.88rem;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 0.25s, transform 0.25s;
    }
    .app-toast.show { opacity: 1; transform: translateX(0); }
    .app-toast.success { background:#eafaf1; color:#1a7a45; border:1.5px solid #a3dfc0; }
    .app-toast.error   { background:#fff0f0; color:#c0392b; border:1.5px solid #f5aaaa; }
    .app-toast.warning { background:#fff8e1; color:#b06a00; border:1.5px solid #ffe08a; }
  `;
  document.head.appendChild(style);
}

function showToast(message, type = "success") {
  injectToastStyles();
  let stack = document.getElementById("appToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "appToastStack";
    document.body.appendChild(stack);
  }

  const icons = { success: "fa-circle-check", error: "fa-circle-xmark", warning: "fa-triangle-exclamation" };
  const iconClass = icons[type] || icons.success;

  const toast = document.createElement("div");
  toast.className = `app-toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${message}</span>`;
  stack.appendChild(toast);

  // Trigger transition on next frame
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ══════════════════════════════════════════════════════════
   FIREBASE / FIRESTORE BOOTSTRAP
   ══════════════════════════════════════════════════════════ */

async function initFirestore() {
  setSyncState("syncing", "Loading config");
  try {
    const res = await fetch(FIRESTORE_CONFIG_URL);
    if (!res.ok) throw new Error(`Cannot load firestore.config (HTTP ${res.status})`);
    const cfg = await res.json();

    // Validate minimum required fields
    const required = ["apiKey", "authDomain", "projectId"];
    for (const field of required) {
      if (!cfg[field] || cfg[field].startsWith("YOUR_")) {
        throw new Error(`firestore.config is missing a real value for "${field}"`);
      }
    }

    // Firebase SDK loaded via CDN in index.html (compat v9 build)
    // window.firebase is the compat namespace
    if (!window.firebase) throw new Error("Firebase SDK not loaded. Add the CDN scripts to index.html.");

    // Initialise (or reuse existing app)
    let app;
    if (firebase.apps && firebase.apps.length) {
      app = firebase.apps[0];
    } else {
      app = firebase.initializeApp(cfg);
    }

    db = firebase.firestore(app);

    // Enable offline persistence (single-tab)
    try {
      await db.enablePersistence({ synchronizeTabs: false });
    } catch (persErr) {
      // Non-fatal — persistence may already be enabled or unsupported
      console.warn("Firestore persistence:", persErr.code);
    }

    fsReady = true;
    setSyncState("idle");
    console.log("Firestore ready — project:", cfg.projectId);
  } catch (err) {
    fsError = err.message;
    fsReady = false;
    setSyncState("offline", err.message);
    console.error("Firestore init failed:", err);
  }
}

/* ══════════════════════════════════════════════════════════
   FIRESTORE READ
   Loads all players for a given activity+ageGroup key.
   Returns an array of adminNo strings.
   ══════════════════════════════════════════════════════════ */

async function fsLoadTeam(key) {
  if (!fsReady || !db) return null;
  setSyncState("syncing", "Loading team");
  try {
    const snap = await db.collection(FS_COLLECTION)
      .where("key", "==", key)
      .get();

    const admins = [];
    snap.forEach(doc => admins.push(doc.data().adminNo));
    setSyncState("idle");
    return admins;                     // may be empty []
  } catch (err) {
    setSyncState("error", err.message);
    console.error("Firestore read error:", err);
    return null;                       // signal failure — fall back to local
  }
}

/* ══════════════════════════════════════════════════════════
   FIRESTORE WRITE (BATCHED)
   Replaces all docs for the given key with the current local list.
   Uses a batched write: delete old docs + add new docs in one commit.
   Firestore batch limit = 500 ops; schools typically have <50/team so safe.
   ══════════════════════════════════════════════════════════ */

async function fsSaveTeam(key) {
  if (!fsReady || !db) {
    setSyncState("offline", "No Firestore connection");
    return false;
  }

  const [activity, ageGroup] = key.split("|");
  const adminList = team[key] || [];

  setSyncState("syncing");
  try {
    /* ── Step 1: fetch existing docs for this key ── */
    const existing = await db.collection(FS_COLLECTION)
      .where("key", "==", key)
      .get();

    const batch = db.batch();

    /* ── Step 2: delete every existing doc for this team ── */
    existing.forEach(doc => batch.delete(doc.ref));

    /* ── Step 3: add current list as fresh docs ── */
    adminList.forEach(adminNo => {
      const ref = db.collection(FS_COLLECTION).doc();   // auto-ID
      batch.set(ref, {
        adminNo,
        activity,
        ageGroup,
        key,                // composite lookup field
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    setSyncState("synced", `${adminList.length} player${adminList.length !== 1 ? "s" : ""} saved`);

    // Return to idle after 3 s
    setTimeout(() => {
      const el = document.getElementById("syncIndicator");
      if (el && el.classList.contains(INDICATOR_STATES.synced.cls)) setSyncState("idle");
    }, 3000);

    return true;
  } catch (err) {
    setSyncState("error", err.message);
    console.error("Firestore write error:", err);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════
   DATA LOADERS
   ══════════════════════════════════════════════════════════ */

async function loadStudents() {
  const res = await fetch(DATA_URL);
  students = await res.json();
}

async function loadActivities() {
  const res = await fetch(LIST_URL_ACTIVITY);
  const text = await res.text();
  text.split("\n").forEach(line => {
    if (!line.trim()) return;
    const name = (line.split(";")[1] || "").replace(/"/g, "").trim();
    if (name) activities.push(name);
  });
}

async function loadAgeGroups() {
  const res = await fetch(LIST_URL_AGEGROUP);
  const text = await res.text();
  text.split("\n").forEach(line => {
    if (!line.trim()) return;
    const name = (line.split(";")[1] || "").replace(/"/g, "").trim();
    if (name) age_groups.push(name);
  });
}

/* ══════════════════════════════════════════════════════════
   UI HELPERS
   ══════════════════════════════════════════════════════════ */

function populateDropdownActivities() {
  const select = document.getElementById("activitySelect");
  select.innerHTML = '<option value="">-- Select Activity --</option>';
  activities.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a; opt.textContent = a;
    select.appendChild(opt);
  });
}

function populateDropdownAgeGroup() {
  const select = document.getElementById("agegroupSelect");
  select.innerHTML = '<option value="">-- Select Age Group --</option>';
  age_groups.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a; opt.textContent = a;
    select.appendChild(opt);
  });
}

/* ══════════════════════════════════════════════════════════
   LOCAL STORAGE
   ══════════════════════════════════════════════════════════ */

function loadTeamStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    team = data ? JSON.parse(data) : {};
  } catch {
    team = {};
  }
}

function saveTeamStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
}

/* ══════════════════════════════════════════════════════════
   SELECTION HELPERS
   ══════════════════════════════════════════════════════════ */

function currentActivity()  { return document.getElementById("activitySelect").value; }
function currentAgeGroup()  { return document.getElementById("agegroupSelect").value;  }
function currentKey() {
  const act = currentActivity();
  const age = currentAgeGroup();
  return act && age ? `${act}|${age}` : "";
}

/* ══════════════════════════════════════════════════════════
   DOMAIN HELPERS
   ══════════════════════════════════════════════════════════ */

function findStudent(admin) { return students.find(s => s.adminNo === admin); }

/* ══════════════════════════════════════════════════════════
   CRUD
   ══════════════════════════════════════════════════════════ */

function addStudent() {
  const admin = document.getElementById("adminInput").value.trim();
  const key   = currentKey();

  if (!key) {
    showToast("Please select an Activity and Age Group first.", "warning");
    return;
  }
  if (!admin) {
    showToast("Please enter an Admin No.", "warning");
    return;
  }

  if (!team[key]) team[key] = [];

  const student = findStudent(admin);
  if (!student) {
    showToast(`No matching student found for Admin No "${admin}".`, "error");
    return;
  }

  if (team[key].includes(admin)) {
    showToast(`${student.firstName} ${student.lastName} is already on this team.`, "warning");
    return;
  }

  team[key].push(admin);
  saveTeamStorage();
  render();
  markUnsaved();

  showToast(`${student.firstName} ${student.lastName} added to the team.`, "success");
}

function removeStudent() {
  const admin = document.getElementById("adminInput").value.trim();
  const key   = currentKey();

  if (!key) {
    showToast("Please select an Activity and Age Group first.", "warning");
    return;
  }
  if (!admin) {
    showToast("Please enter an Admin No.", "warning");
    return;
  }

  if (!team[key] || !team[key].includes(admin)) {
    showToast(`No matching student found on this team for Admin No "${admin}".`, "error");
    return;
  }

  const student = findStudent(admin);
  team[key] = team[key].filter(a => a !== admin);
  saveTeamStorage();
  render();
  markUnsaved();

  const displayName = student ? `${student.firstName} ${student.lastName}` : admin;
  showToast(`${displayName} removed from the team.`, "success");
}

/* ── Unsaved-change indicator on the Save button ─────────── */
function markUnsaved() {
  const btn = document.getElementById("saveCloudBtn");
  if (btn) {
    btn.classList.add("unsaved");
    btn.title = "Save to Cloud (unsaved changes)";
    btn.setAttribute("aria-label", btn.title);
  }
}

function clearUnsaved() {
  const btn = document.getElementById("saveCloudBtn");
  if (btn) {
    btn.classList.remove("unsaved");
    btn.title = "Save to Cloud";
    btn.setAttribute("aria-label", btn.title);
  }
}

/* ══════════════════════════════════════════════════════════
   SAVE TO CLOUD (explicit, called by button)
   ══════════════════════════════════════════════════════════ */

async function saveToCloud() {
  const key = currentKey();
  if (!key) {
    alert("Please select an Activity and Age Group first.");
    return;
  }
  const ok = await fsSaveTeam(key);
  if (ok) clearUnsaved();
}

/* ══════════════════════════════════════════════════════════
   LOAD FROM CLOUD (on selection change)
   Merges cloud data into local; cloud is authoritative.
   ══════════════════════════════════════════════════════════ */

async function loadFromCloud(key) {
  if (!fsReady || !key) return;
  const cloudList = await fsLoadTeam(key);
  if (cloudList === null) return;         // read failed — keep local
  if (cloudList.length === 0 && (!team[key] || team[key].length === 0)) return;

  // Cloud is authoritative — overwrite local for this key
  team[key] = cloudList;
  saveTeamStorage();
}

/* ══════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════ */

function render() {
  const container = document.getElementById("team");
  const act = currentActivity();
  const age = currentAgeGroup();
  const key = currentKey();

  document.getElementById("teamTitle").innerText =
    act && age ? `${act} – ${age} Team` : "";

  container.innerHTML = "";
  if (!key || !team[key] || team[key].length === 0) return;

  const list = [...team[key]];
  list.sort((a, b) => {
    const sa = findStudent(a), sb = findStudent(b);
    const na = `${sa?.firstName || ""} ${sa?.lastName || ""}`;
    const nb = `${sb?.firstName || ""} ${sb?.lastName || ""}`;
    return na.localeCompare(nb);
  });

  list.forEach(admin => {
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

/* ══════════════════════════════════════════════════════════
   EXPORT / IMPORT
   ══════════════════════════════════════════════════════════ */

function exportTeam() {
  const act = currentActivity(), age = currentAgeGroup(), key = currentKey();
  const data = key && team[key] ? team[key] : [];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `${(act || "Activity").replace(/\s/g, "_")}_${(age || "Age").replace(/\s/g, "_")}_team.json`;
  a.click();
}

function exportTeamExcel() {
  const act = currentActivity(), age = currentAgeGroup(), key = currentKey();
  if (!act || !age) { alert("Please select an Activity and Age Group first."); return; }

  const adminList = key && team[key] ? team[key] : [];
  if (!adminList.length) { alert("No students in this team to export."); return; }

  const rows = adminList
    .map(admin => findStudent(admin))
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
  ws["!cols"] = [{ wch: 4 },{ wch: 16 },{ wch: 18 },{ wch: 12 },{ wch: 18 },{ wch: 18 },{ wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${act} ${age}`.slice(0, 31));
  XLSX.writeFile(wb, `${act.replace(/\s/g, "_")}_${age.replace(/\s/g, "_")}_team.xlsx`);
}

function importTeam() {
  const file = document.getElementById("importFile").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const key = currentKey();
    if (!key) { alert("Please select an Activity and Age Group before importing."); return; }
    try {
      team[key] = JSON.parse(e.target.result);
    } catch {
      alert("Invalid JSON file."); return;
    }
    saveTeamStorage();
    render();
    markUnsaved();
  };
  reader.readAsText(file);
}

function printTeam() { window.print(); }

/* ══════════════════════════════════════════════════════════
   EVENT WIRING
   ══════════════════════════════════════════════════════════ */

document.getElementById("activitySelect").addEventListener("change", async () => {
  clearUnsaved();
  const key = currentKey();
  if (key) await loadFromCloud(key);
  render();
});

document.getElementById("agegroupSelect").addEventListener("change", async () => {
  clearUnsaved();
  const key = currentKey();
  if (key) await loadFromCloud(key);
  render();
});

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */

async function init() {
  // Build indicator DOM immediately so setSyncState works
  injectSyncIndicator();

  // Load local data first so UI is usable while Firestore connects
  await loadStudents();
  await loadActivities();
  await loadAgeGroups();
  populateDropdownActivities();
  populateDropdownAgeGroup();
  loadTeamStorage();
  render();

  // Then connect to Firestore in the background
  await initFirestore();
}

/* ══════════════════════════════════════════════════════════
   INJECT SYNC INDICATOR + SAVE BUTTON (if not in HTML)
   Injects the indicator bar and the Save to Cloud button
   so this JS file is self-contained.
   ══════════════════════════════════════════════════════════ */

function injectSyncIndicator() {
  // Inject CSS
  if (!document.getElementById("syncIndicatorStyle")) {
    const style = document.createElement("style");
    style.id = "syncIndicatorStyle";
    style.textContent = `
      /* ── Sync indicator bar ─────────────────────── */
      #syncIndicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.78rem;
        font-family: system-ui, sans-serif;
        font-weight: 500;
        letter-spacing: 0.01em;
        border: 1.5px solid transparent;
        transition: background 0.25s, color 0.25s, border-color 0.25s;
        vertical-align: middle;
        user-select: none;
      }
      .sync-icon {
        font-size: 1rem;
        line-height: 1;
        display: inline-block;
      }
      .sync-icon.spinning {
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }

      /* ── State colours ──────────────────────────── */
      .sync-idle    { background:#f0f4ff; color:#4a5bb5; border-color:#c5cff5; }
      .sync-syncing { background:#fff8e1; color:#b06a00; border-color:#ffe08a; }
      .sync-synced  { background:#eafaf1; color:#1a7a45; border-color:#a3dfc0; }
      .sync-error   { background:#fff0f0; color:#c0392b; border-color:#f5aaaa; }
      .sync-offline { background:#f5f5f5; color:#888;    border-color:#ddd;    }

      /* ── Save button ────────────────────────────── */
      #saveCloudBtn {
        position: relative;
        cursor: pointer;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 1.5px solid #4a5bb5;
        background: #4a5bb5;
        color: #fff;
        font-size: 1rem;
        transition: background 0.2s, opacity 0.2s;
      }
      #saveCloudBtn:hover  { background: #3a4aa0; }
      #saveCloudBtn.unsaved {
        border-color: #e67e22;
        background: #e67e22;
        animation: pulse-unsaved 1.4s ease-in-out infinite;
      }
      #saveCloudBtn.unsaved::after {
        content: "";
        position: absolute;
        top: -2px;
        right: -2px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #fff;
        border: 1.5px solid #e67e22;
      }
      @keyframes pulse-unsaved {
        0%,100% { opacity: 1; }
        50%      { opacity: 0.7; }
      }

      /* ── Sync toolbar wrapper ────────────────────── */
      #syncToolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 0 4px;
        flex-wrap: wrap;
      }
    `;
    document.head.appendChild(style);
  }

  // Inject toolbar if not already in the DOM
  if (!document.getElementById("syncToolbar")) {
    const toolbar = document.createElement("div");
    toolbar.id = "syncToolbar";
    toolbar.innerHTML = `
      <button id="saveCloudBtn" onclick="saveToCloud()" title="Save to Cloud" aria-label="Save to Cloud">
        <i class="fa-solid fa-cloud-arrow-up"></i>
      </button>
      <span id="syncIndicator" class="sync-offline">
        <span class="sync-icon">✗</span>
        <span class="sync-label">Connecting…</span>
      </span>
    `;

    // Insert before .controls (the team list now renders above .controls,
    // so the toolbar sits directly above the controls toolbar it belongs to).
    const controls = document.querySelector(".controls");
    if (controls) {
      controls.insertAdjacentElement("beforebegin", toolbar);
    } else {
      const h1 = document.querySelector("h1");
      if (h1) h1.insertAdjacentElement("afterend", toolbar);
      else document.body.prepend(toolbar);
    }
  }
}

init();
