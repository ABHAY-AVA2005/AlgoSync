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
  const providerName = (urlParams.get('provider') || 'github').toLowerCase();
  const container = document.getElementById('message-container');

  if (!extId) {
    container.innerHTML = `
      <h2 style="color: #ff4444;">Missing Extension ID</h2>
      <p>Please launch this page directly from the AlgoSync extension.</p>
    `;
    return;
  }

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    container.innerHTML = `
      <h2 style="color: #ff4444;">Use the extension login</h2>
      <p>This page is only used by the AlgoSync extension. Please open the extension popup and connect from there.</p>
    `;
    return;
  }

  const providerLabel = providerName === 'google' ? 'Google' : 'GitHub';
  const loginBtn = document.getElementById('login-btn');
  if (!loginBtn) return;

  const labelText = providerName === 'google' ? 'Continue with Google' : 'Proceed to GitHub';
  loginBtn.innerText = labelText;

  loginBtn.addEventListener('click', async () => {
    loginBtn.innerText = providerName === 'google' ? 'Connecting to Google...' : 'Connecting to GitHub...';
    loginBtn.disabled = true;

    try {
      const auth = firebase.auth();
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      let provider;
      let requiredTokenField = 'accessToken';

      if (providerName === 'google') {
        provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('profile');
        provider.addScope('email');
      } else {
        provider = new firebase.auth.GithubAuthProvider();
        provider.addScope('repo');
      }

      const result = await auth.signInWithPopup(provider);
      const token = result.credential ? result.credential[requiredTokenField] : null;
      const user = result.user;

      if (!token && providerName === 'github') {
        throw new Error("GitHub did not provide an access token.");
      }

      container.innerHTML = `
        <h2 style="color: #2ea043;">Success!</h2>
        <p>${providerLabel} connected successfully. Sending data back to extension...</p>
      `;

      chrome.runtime.sendMessage(extId, {
        action: 'login_success',
        token: token || '',
        provider: providerName,
        userEmail: user ? user.email : '',
        userName: user ? user.displayName : ''
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          container.innerHTML = `
            <h2 style="color: #ff4444;">Sync Error</h2>
            <p>Could not communicate with the extension. Make sure it is installed and active.</p>
          `;
        } else {
          window.close();
        }
      });

    } catch (error) {
      console.error("Auth Error:", error);

      if (error.code === 'auth/popup-blocked') {
        container.innerHTML = `
          <h2 style="color: #ff4444;">Popup Blocked</h2>
          <p>Your browser blocked the ${providerLabel} login window.</p>
          <p><strong>Please click the "Pop-up blocked" icon in your address bar and allow pop-ups for this site, then refresh.</strong></p>
        `;
      } else {
        container.innerHTML = `
          <h2 style="color: #ff4444;">Authentication Failed</h2>
          <p>${error.message}</p>
          <p>You can safely close this tab and try again.</p>
        `;
      }

      loginBtn.innerText = labelText;
      loginBtn.disabled = false;
    }
  });
})();
