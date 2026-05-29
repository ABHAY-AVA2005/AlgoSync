/**
 * AlgoSync Authentication Handler (Firebase Hosting)
 * 
 * This file is hosted on Firebase to bypass Chrome Manifest V3's strict CSP,
 * which blocks external scripts (like Google APIs) inside extension tabs.
 * By running the OAuth flow on a normal webpage, we bypass the CSP.
 */

// 1. Initialize Firebase (v8 Compat API)
const firebaseConfig = {
  apiKey: "AIzaSyClvcVSi8vckZ9Q4wE2ZORG-SMIRWgUJwE",
  authDomain: "algosync-a537d.firebaseapp.com",
  projectId: "algosync-a537d",
  storageBucket: "algosync-a537d.firebasestorage.app",
  messagingSenderId: "474986229246",
  appId: "1:474986229246:web:8f77b351414cefdbd464af",
  measurementId: "G-QNWL1GL255"
};

firebase.initializeApp(firebaseConfig);

(async () => {
  console.log("ALGO_SYNC_AUTH: Initializing popup logic.");
  
  // 2. Extract Extension ID from the URL
  // The popup.js passes its ID so we know exactly where to beam the token back to.
  const urlParams = new URLSearchParams(window.location.search);
  const extId = urlParams.get('extId');
  const container = document.getElementById('message-container');

  if (!extId) {
    container.innerHTML = `
      <h2 style="color: #ff4444;">Missing Extension ID</h2>
      <p>Please launch this page directly from the AlgoSync extension.</p>
    `;
    return;
  }

  // 3. Setup the Login Button
  const loginBtn = document.getElementById('login-btn');
  if (!loginBtn) return;

  loginBtn.addEventListener('click', async () => {
    loginBtn.innerText = "Connecting to GitHub...";
    loginBtn.disabled = true;

    try {
      // 4. Trigger Firebase GitHub OAuth
      const provider = new firebase.auth.GithubAuthProvider();
      provider.addScope('repo'); // We need 'repo' scope to push code to GitHub
      
      const result = await firebase.auth().signInWithPopup(provider);
      
      // Extract the OAuth Access Token from the v8 Compat result object
      const token = result.credential ? result.credential.accessToken : null;

      if (!token) {
        throw new Error("GitHub did not provide an access token.");
      }

      // 5. Success - Beam Token Back to Extension
      container.innerHTML = `
        <h2 style="color: #2ea043;">Success!</h2>
        <p>GitHub connected successfully. Sending data back to extension...</p>
      `;

      chrome.runtime.sendMessage(extId, { action: 'login_success', token: token }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          container.innerHTML = `
            <h2 style="color: #ff4444;">Sync Error</h2>
            <p>Could not communicate with the extension. Make sure it is installed and active.</p>
          `;
        } else {
          // Mission accomplished, auto-close the auth tab
          window.close();
        }
      });
      
    } catch (error) {
      console.error("Auth Error:", error);
      
      // 6. Handle Popup Blockers explicitly for better UX
      if (error.code === 'auth/popup-blocked') {
        container.innerHTML = `
          <h2 style="color: #ff4444;">Popup Blocked</h2>
          <p>Your browser blocked the GitHub login window.</p>
          <p><strong>Please click the "Pop-up blocked" icon in your address bar (or check your browser settings) and select "Always allow pop-ups for this site", then refresh this page to try again.</strong></p>
        `;
      } else {
        container.innerHTML = `
          <h2 style="color: #ff4444;">Authentication Failed</h2>
          <p>${error.message}</p>
          <p>You can safely close this tab and try again.</p>
        `;
      }
      
      // Reset button just in case they want to retry without refreshing
      loginBtn.innerText = "Proceed to GitHub";
      loginBtn.disabled = false;
    }
  });
})();
