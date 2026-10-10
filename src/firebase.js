/**
 * firebase.js — Firebase App + Auth initialisation
 *
 * All config values come from VITE_FIREBASE_* env vars set in `.env`.
 * Vite replaces `import.meta.env.VITE_*` at build time so no secrets
 * leak beyond what Firebase itself considers safe for browsers.
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
} from 'firebase/auth';


const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Check for missing or placeholder credentials
const isPlaceholder = (val) => !val || val.includes('your-') || val.includes('123456789012');

const missingFirebaseVars = Object.entries(firebaseConfig)
  .filter(([, v]) => isPlaceholder(v))
  .map(([k]) => `VITE_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);

const isFirebaseConfigured = missingFirebaseVars.length === 0;

let app = null;
let auth = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    console.error('Firebase initialization error:', err);
  }
}

export {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
  isFirebaseConfigured,
  missingFirebaseVars,
};



