// auth.js — Session 2 (email-link sign-in) — COMPLETE
//
// Implements Firebase "Email link (passwordless)" sign-in and an auth guard
// for the app shell. Uses the modular Firebase v9+ SDK.
//
// Verified against the real index.html (Session 1 scaffold):
//   #authGate          — plain <div>, the "logged out" card (NOT a <dialog>)
//   #appShell           — plain <div>, hidden until authenticated
//   #signOutBtn         — sign-out button in the navbar
//   #loginEmailInput    — NEW: added to the authGate <input>, `disabled` removed
//   #sendLinkBtn        — NEW: added to the authGate <button>, `disabled` removed
//   #loginStatus        — NEW: small status/error line added under the button
// The three "NEW" ids/attribute changes are applied in the accompanying
// index.html patch — see that file's diff for the exact markup.
//
// firebase-config.js is assumed to export an initialized modular-SDK
// `auth` instance (`export { auth }`). If Session 1 actually used the
// compat SDK (`firebase.auth()`), flag it and this file gets rewritten
// against that API instead — it will NOT work as-is against compat.

import { auth } from './firebase-config.js';
import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ---- Config -----------------------------------------------------------

const ELEMENT_IDS = {
  authGate: 'authGate',       // plain <div>, not a <dialog>
  emailInput: 'loginEmailInput',
  sendBtn: 'sendLinkBtn',
  status: 'loginStatus',
  logoutBtn: 'signOutBtn',
  appShell: 'appShell',
};

// Where the sign-in link should point. Must be an authorized domain in the
// Firebase console → Authentication → Settings → Authorized domains.
const actionCodeSettings = {
  url: window.location.origin + window.location.pathname,
  handleCodeInApp: true,
};

// Key used to remember the email address between "send link" and
// "click link" (possibly in a new tab/device). This is the standard,
// Firebase-recommended pattern for email-link auth, since Firestore isn't
// available yet at the point the link is clicked (no signed-in user).
const EMAIL_STORAGE_KEY = 'coverapp:emailForSignIn';

// ---- Internal helpers ---------------------------------------------------

function el(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const status = el(ELEMENT_IDS.status);
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('text-error', isError);
  status.classList.toggle('text-success', !isError && !!message);
}

function showAppShell(show) {
  const shell = el(ELEMENT_IDS.appShell);
  const gate = el(ELEMENT_IDS.authGate);
  // Both #authGate and #appShell are plain <div>s toggled with Tailwind's
  // `hidden` class (see index.html) — not <dialog> elements.
  if (shell) shell.classList.toggle('hidden', !show);
  if (gate) gate.classList.toggle('hidden', show);
}

// ---- Public API -----------------------------------------------------

/**
 * Sends a passwordless sign-in link to the given email address.
 * Call from the "Send link" button handler.
 */
async function sendLoginLink(email) {
  if (!email || !email.includes('@')) {
    setStatus('Enter a valid email address.', true);
    return;
  }
  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
    setStatus(`Check ${email} for your sign-in link.`);
  } catch (err) {
    console.error('sendLoginLink failed:', err);
    setStatus(err.message || 'Could not send sign-in link.', true);
  }
}

/**
 * Completes sign-in if the current URL is a Firebase email sign-in link.
 * Call once on app load, before rendering the shell.
 */
async function completeSignInIfLinkPresent() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;

  let email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
  if (!email) {
    // Link opened on a different device/browser than it was requested on.
    email = window.prompt('Confirm your email to complete sign-in:');
  }
  if (!email) {
    setStatus('Email is required to complete sign-in.', true);
    return false;
  }

  try {
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);
    // Clean the sign-in params out of the URL bar.
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  } catch (err) {
    console.error('completeSignInIfLinkPresent failed:', err);
    setStatus(err.message || 'Sign-in link is invalid or expired.', true);
    return false;
  }
}

/** Signs the current user out. */
async function logout() {
  try {
    await firebaseSignOut(auth);
  } catch (err) {
    console.error('logout failed:', err);
  }
}

/**
 * Wires the auth guard: toggles the app shell vs. login modal based on
 * auth state, and binds the DOM elements listed in ELEMENT_IDS.
 * Call once from app.js on startup.
 */
function initAuth() {
  const sendBtn = el(ELEMENT_IDS.sendBtn);
  const emailInput = el(ELEMENT_IDS.emailInput);
  const logoutBtn = el(ELEMENT_IDS.logoutBtn);

  if (sendBtn && emailInput) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendLoginLink(emailInput.value.trim());
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  onAuthStateChanged(auth, (user) => {
    showAppShell(!!user);
  });

  // Run link-completion in the background; onAuthStateChanged above will
  // flip the UI once it resolves.
  completeSignInIfLinkPresent();
}

// ---- window.* bridge (for inline onclick= handlers, per app convention) --

window.CoverApp = window.CoverApp || {};
window.CoverApp.auth = {
  sendLoginLink,
  logout,
  completeSignInIfLinkPresent,
};

export { initAuth, sendLoginLink, completeSignInIfLinkPresent, logout };
