// app.js — Session 1 scaffold.
// Only wires up shell mechanics (modal open/close). No Firestore reads/writes
// happen here yet — those arrive with their owning module (teachers.js,
// absences.js, coverGrid.js, ...).

// Generic <dialog> opener: any element with data-open-modal="someModalId"
// opens that dialog. DaisyUI's modal component is a native <dialog>, so
// this is the only JS the shell needs for modals.
document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modal = document.getElementById(btn.dataset.openModal);
    modal?.showModal();
  });
});

// ── Auth gate — Session 2 replaces this stub ───────────────────────────
// For now the app shell stays hidden and the auth gate stays visible,
// since there is no real sign-in flow yet. Session 2 will:
//   1. Wire up sendSignInLinkToEmail / isSignInWithEmailLink
//   2. Call onAuthStateChanged to toggle #authGate / #appShell
//   3. Wire #signOutBtn to firebase Auth signOut()
//
// document.getElementById("authGate").classList.add("hidden");
// document.getElementById("appShell").classList.remove("hidden");
