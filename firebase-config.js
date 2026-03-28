// =============================================================
// Firebase Configuration
// Replace the values below with your own Firebase project config.
// You can find these in: Firebase Console > Project Settings > General > Your apps > Web app
// =============================================================

const firebaseConfig = {
  apiKey: "AIzaSyAi5kjxcVXv0Q6xTs3dwQVW6xW8eD_zc0Q",
  authDomain: "kanban-a0ea4.firebaseapp.com",
  projectId: "kanban-a0ea4",
  storageBucket: "kanban-a0ea4.firebasestorage.app",
  messagingSenderId: "981034241119",
  appId: "1:981034241119:web:131ddff56321bc98ae1fea",
  measurementId: "G-D33MM862N9"
};

// Initialize Firebase
let app, auth, db;
let firebaseReady = false;

try {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  firebaseReady = firebaseConfig.apiKey !== "YOUR_API_KEY";
} catch (e) {
  console.error("Firebase init error:", e);
  firebaseReady = false;
}
