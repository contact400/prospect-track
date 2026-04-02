// ============================================================
//  STEP 1: Replace these values with your Firebase project config
//  Get them from: Firebase Console → Project Settings → Your apps → SDK setup
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyApmcZIaDHbGEVP7T3k6TGBQFWvTxwnqHA",
  authDomain: "prospecting-tracker.firebaseapp.com",
  projectId: "prospecting-tracker",
  storageBucket: "prospecting-tracker.firebasestorage.app",
  messagingSenderId: "722457581476",
  appId: "1:722457581476:web:b978e34e0eee8296171331"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
