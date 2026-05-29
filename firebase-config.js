const firebaseConfig = {
  apiKey: "AIzaSyClvcVSi8vckZ9Q4wE2ZORG-SMIRWgUJwE",
  authDomain: "algosync-a537d.firebaseapp.com",
  projectId: "algosync-a537d",
  storageBucket: "algosync-a537d.firebasestorage.app",
  messagingSenderId: "474986229246",
  appId: "1:474986229246:web:8f77b351414cefdbd464af",
  measurementId: "G-QNWL1GL255"
};

// Initialize Firebase using the Compat API for Chrome Extension Service Workers
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // if already initialized
}

self.firebaseApp = firebase.app();
self.auth = firebase.auth();
self.db = firebase.firestore();
