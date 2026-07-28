// Firebase config placeholder — Session 1.
// Replace the values below with your project's config from:
// Firebase Console → Project Settings → General → Your apps → SDK setup and config
//
// Firestore/Auth SDK imports are deferred to Session 2 (auth.js) and
// Session 3 (teachers.js) so this file stays a pure config module that
// every later session can import from without pulling in unused code.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

export const firebaseApp = initializeApp(firebaseConfig);
