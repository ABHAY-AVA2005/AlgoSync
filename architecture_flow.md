# AlgoSync Horizontal System Pipeline Architecture

This document maps out the complete end-to-end data pipeline of the **AlgoSync Chrome Extension and Web Platform**. It illustrates exactly how DOM scraping, namespaced extension storage, Firebase OAuth, GitHub REST API commits, and real-time Cloud Firestore reviews communicate.

---

## 1. Pipeline Architecture Flow (Horizontal)

```mermaid
graph LR
    %% Browser DOM Scraping Node
    subgraph Browser DOM
        A["LeetCode / GFG / HackerRank"] -->|1. Accepted Submission| B["content-script.js"]
    end

    %% Extension Sandbox and Local Namespaced Storage
    subgraph Extension Sandbox
        B -->|2. chrome.runtime.sendMessage| C["background.js Service Worker"]
        C -->|3. Read/Write Operations| D[("chrome.storage")]
        
        subgraph Local Namespace: 'user'
            D1["accessToken (Secure GitHub OAuth)"]
            D2["selectedRepo (Target Repository)"]
            D3["repos (Cached GitHub Repositories)"]
        end
        
        subgraph Sync Namespace: 'settings'
            D4["theme ('dark' | 'light' Preference)"]
        end
        
        subgraph Flat Local Stats
            D5["stats (total / easy / medium / hard)"]
            D6["solvedList (Problem Sync History)"]
        end
        
        D --- D1
        D --- D4
        D --- D5
    end

    %% Firebase Hosted Authentication & Web Reviews Systems
    subgraph Firebase Cloud
        E["https://algosync-a537d.web.app"] -->|4. Firebase Auth GitHub Handshake| F["GitHub OAuth Token"]
        F -->|5. chrome.runtime.onMessageExternal| C
        G["Community Review Form"] -->|6. Firestore add| H[("Cloud Firestore: /reviews")]
        H -->|7. db.onSnapshot Real-time Socket| I["Website Live reviews-list Grid"]
    end

    %% GitHub REST API Target Commits
    subgraph GitHub APIs
        C -->|8. HTTP PUT File Commit| J["GitHub Repository"]
        C -->|9. Pull/Update README.md| J
    end
    
    %% Node Styling
    style A fill:#fbbf24,stroke:#d97706,stroke-width:2px,color:#000
    style B fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff
    style C fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff
    style D fill:#1e1b4b,stroke:#311042,stroke-width:2px,color:#fff
    style E fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#fff
    style H fill:#f97316,stroke:#ea580c,stroke-width:2px,color:#fff
    style J fill:#24292f,stroke:#090d16,stroke-width:2px,color:#fff
```

---

## 2. Segmented Technical Breakdown

### 🔵 Segment A: The Extension Authentication Loop (Lines 4 → 5)
1.  **Launch**: The user clicks **"Connect GitHub Account"** in the popup UI ([popup.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/popup.js)). The popup opens a persistent tab loading the Firebase Hosted webpage: `https://algosync-a537d.web.app/login.html?extId={extId}`.
2.  **Handshake**: The webpage uses the Firebase v8 Compatibility SDK's `GithubAuthProvider` to safely execute the OAuth handshake, requesting `repo` scopes.
3.  **Beam Back**: Once authenticated, the webpage uses Chrome's external messaging system (`chrome.runtime.sendMessage(extId, {action: 'login_success', token})`) to send the OAuth key directly back to the extension service worker.
4.  **Save**: The Background Worker ([background.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/background.js)) intercepts the external message and invokes `AlgoStorage.setToken(token)`, securely locking it into the namespaced `user` object in `chrome.storage.local`.

---

### 🟢 Segment B: The Scraping & Local Messaging Pipeline (Lines 1 → 2)
1.  **Observe**: Injected Content Scripts ([content-script.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/scripts/content-script.js)) constantly observe DOM mutations on coding platform pages.
2.  **Trigger**: Upon intercepting a success state (such as LeetCode's "Accepted" state, GFG's "Problem Solved Successfully", or HackerRank's congrats flags), the scraping engine fires.
3.  **Extract**: The script grabs the user's code directly from the text editor elements (Ace Editor, CodeMirror, or Monaco) along with the problem metadata (Title, Description, Difficulty, Topic Tags, and Test Cases).
4.  **Message**: The Content Script packages this payload and beams it to the Service Worker using `chrome.runtime.sendMessage({action: 'pushSolution', payload})`.

---

### 🟣 Segment C: Commit Engine & README Sync (Lines 8 → 9)
1.  **Authorize**: The background worker grabs the user's secure token and target repository via `AlgoStorage.getUser()`.
2.  **Deduplicate**: It sends a cached check to GitHub to query if the file already exists in the repository folder. If the content matches perfectly, it ignores the sync to avoid useless commits.
3.  **Encode**: If the solution is new, the worker translates the raw solution code into Base64 bytes and makes a RESTful HTTP PUT request directly to:
    `https://api.github.com/repos/{selectedRepo}/contents/{folderPath}/solution.{ext}`.
4.  **README Update**: Once the solution commits successfully, the worker grabs the current `README.md` repository index page, parses the markdown table, injects the new solved problem, updates the total solve and difficulty counts, and commits the updated `README.md` back to GitHub.

---

### 🟡 Segment D: Namespaced Storage Modeling
To prevent cluttering Chrome's storage view and ensure maximum device security, we restructured all local storage interactions under the `AlgoStorage` API ([storage-helper.js](file:///d:/abhay%20varshit%20570/Abhay%20Projects/AlgoSync/storage-helper.js)):

*   **`chrome.storage.local` → `{ user: { accessToken, selectedRepo, repos } }`**
    *   *accessToken*: Secure, scopes-limited GitHub API authentication key.
    *   *selectedRepo*: Locked repository where the user's files are committed.
    *   *repos*: Cached array containing up to 100 repositories used for fast popup search dropdown rendering.
*   **`chrome.storage.sync` → `{ settings: { theme } }`**
    *   *theme*: Light/Dark mode user preference that synchronizes automatically across all Chrome browsers signed into the same Google account.
*   **`chrome.storage.local` → `{ stats, solvedList }`**
    *   *stats*: High-speed, flat metadata counts of easy, medium, and hard solves.
    *   *solvedList*: Comprehensive history logging every synchronized problem. (Stored flat to accommodate unlimited array growth).

---

### 🔴 Segment E: The Live Community Reviews Pipeline (Lines 6 → 7)
1.  **Submit**: Visitors on the hosted webpage fill out the beautiful frosted glass review form. Submitting triggers an direct Firestore write to the `/reviews` collection:
    ```js
    await db.collection('reviews').add({ name, email, rating, text, timestamp })
    ```
2.  **Socket Listen**: The landing page binds a permanent Firestore real-time socket listener (`onSnapshot`) on page load.
3.  **Real-time Renders**: Any time a new review commits anywhere in the world, the socket fires, formats the new review with dynamic stars, and updates the scrollable reviews feed instantly without requiring a page refresh.

---

## 3. Firebase Cloud Infrastructure & Security Blueprint

To ensure complete, standalone security and cloud database transparency, here is the exact blueprint of how Firebase coordinates with AlgoSync.

### A. The Firebase configuration
Both the Firebase-hosted authentication webpage and the landing page utilize this configuration block to establish secure, low-latency client sockets:
```js
const firebaseConfig = {
  apiKey: "AIzaSyClvcVSi8vckZ9Q4wE2ZORG-SMIRWgUJwE",
  authDomain: "algosync-a537d.firebaseapp.com",
  projectId: "algosync-a537d",
  storageBucket: "algosync-a537d.firebasestorage.app",
  messagingSenderId: "474986229246",
  appId: "1:474986229246:web:8f77b351414cefdbd464af",
  measurementId: "G-QNWL1GL255"
};
```

---

### B. Firestore Collections & JSON Schemas

#### 1. The `/reviews` Collection (Public Real-time Feed)
Every user review submitted on the landing page is mapped into this collection as a separate document with this structured layout:
```json
{
  "name": "Abhay Varshit",
  "email": "abhayvarshit2005@gmail.com",
  "rating": 5,
  "text": "AlgoSync completely transformed my daily DSA routine. Everything just works!",
  "timestamp": "Timestamp(seconds=1780000000, nanoseconds=0)"
}
```

---

### C. Live Cloud Firestore Security Rules

To enforce high levels of cloud security, the database is locked behind a strict **Production Security Policy** that blocks all general database access while surgically opening access *only* to the community reviews collection:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 1. Strict default-lock: deny read/write to all collections by default
    match /{document=**} {
      allow read, write: if false;
    }

    // 2. Surgical open: allow public reads & writes specifically on the reviews collection
    match /reviews/{review} {
      allow read, write: if true;
    }
  }
}
```
> [!IMPORTANT]
> The above configuration balances complete security with absolute transparency. It ensures the `/reviews` collection remains publicly active for community growth while guaranteeing no other project pathways can be compromised.

---

## 4. Operational Pipeline: User Journey (Login to Solved Solution)

This tracing demonstrates the exact chronological journey of a developer starting from absolute scratch: logging in, solving a LeetCode problem, and seeing their statistics update in real-time.

```mermaid
sequenceDiagram
    autonumber
    actor User as Developer
    participant Ext as Extension (Popup/Worker)
    participant Page as Web auth.html Page
    participant FB as Firebase Service
    participant GH as GitHub REST API
    participant LC as LeetCode Webpage

    %% PHASE 1: LOGIN
    Note over User, GH: Phase 1 — User Authentication & Locked Repo
    User->>Ext: Clicks "Connect GitHub Account"
    Ext->>Page: Launches Webpage (adds ?extId=id)
    User->>Page: Clicks "Proceed to GitHub"
    Page->>FB: Invokes signInWithPopup(GithubAuthProvider)
    FB-->>Page: Authenticates & returns secure accessToken
    Page->>Ext: chrome.runtime.sendMessage(token) (External Message)
    Ext->>Ext: Writes token to chrome.storage.local { user: { accessToken } }
    Page-->>User: Webpage closes automatically

    %% PHASE 2: CODE SUBMISSION
    Note over User, LC: Phase 2 — Solving a Problem & Content Scraping
    User->>LC: Codes, submits, and passes all test cases (Accepted)
    Note over LC: content-script.js MutationObserver catches success DOM change
    LC->>Ext: chrome.runtime.sendMessage(scraped solution + metadata)
    Ext->>Ext: AlgoStorage.getUser() (Retrieves token & target repo)

    %% PHASE 3: SYNC AND COMITING
    Note over Ext, GH: Phase 3 — Repository Committing & Stats Sync
    Ext->>GH: HTTP GET (Checks if solution already exists in repo)
    alt New Solution (No duplicates)
        Ext->>GH: HTTP PUT (Creates solution.java)
        Ext->>GH: HTTP PUT (Creates README.md problem details)
        Ext->>GH: HTTP GET (Pulls master repository README.md)
        Ext->>GH: HTTP PUT (Syncs updated portfolio table and solved counts)
    end
    Ext->>Ext: Updates local statistics (easy++) & appends solved problem to solvedList
    Ext-->>LC: Beams Sync Success response
    LC-->>User: Displays glowing green "Pushed! ✅" badge on LeetCode screen
```

### Detailed Sequence Explanation

#### 🔑 Step 1 to 8: The /Login Pathway
1.  **Auth Call**: The user opens the extension and clicks "Connect GitHub". The popup UI launches the hosted webpage `https://algosync-a537d.web.app/login.html` inside a new tab, passing along the extension's internal ID (`?extId=...`).
2.  **Provider Popup**: Clicking "Proceed to GitHub" runs Firebase's standard compatibility login popup. The developer signs in on GitHub, authorizing AlgoSync to access their repositories.
3.  **Token Capture**: Firebase returns the authenticated credentials containing the secure GitHub `accessToken`.
4.  **External Message Injection**: Using the extension's unique ID, the webpage makes an external message request (`chrome.runtime.sendMessage(extId, { action: 'login_success', token })`).
5.  **Secure Storage Storage**: The service worker captures the token and writes it directly to the local namespaced storage:
    `chrome.storage.local.set({ user: { accessToken: token } })`. 
6.  **Auto Close**: The webpage intercepts the successful delivery signal and closes itself seamlessly, completing the login loop.

---

#### 💻 Step 9 to 12: The Accepted Problem Scraping Pathway
1.  **Accepted Trigger**: The developer opens an Easy LeetCode problem (e.g. *"Two Sum"*), codes a solution, and clicks Submit. The page compiles the inputs, passes all test cases, and renders `"Accepted"`.
2.  **Observer Intercept**: The Content Script's `MutationObserver` detects that the success element has loaded. It immediately extracts the user's raw code from the text editor wrapper, alongside the problem name (*"Two Sum"*), difficulty (*"Easy"*), language extension (*"java"*), and description block.
3.  **Background Transmission**: It packages these fields into a JSON payload and makes an internal runtime request to the service worker:
    `chrome.runtime.sendMessage({ action: 'pushSolution', payload })`.

---

#### 📁 Step 13 to 22: The Repository Committing & Local Statistics Pipeline
1.  **Read Config**: The worker calls `AlgoStorage.getUser()` to retrieve the locked target repository (e.g., `user/DSA-Solutions`) and secure OAuth token.
2.  **Duplicate Check**: It sends a cached `GET` request to GitHub to examine if a solution file is already present. If the remote code matches the newly scraped code, it aborts to prevent redundant commits.
3.  **Commit Solution**: If the code is unique, it translates the text into Base64 format and pushes the code using a RESTful `PUT` query:
    `PUT https://api.github.com/repos/user/DSA-Solutions/contents/[LC]_Two_Sum/solution.java`
4.  **Commit Problem details**: Next, it pushes a local `README.md` containing the problem descriptions and test cases:
    `PUT https://api.github.com/repos/user/DSA-Solutions/contents/[LC]_Two_Sum/README.md`
5.  **README Update**: The worker pulls down the repository's main portfolio index page (`README.md`), parses the markdown table, appends *"Two Sum"* into the table, increments the total and Easy solved counters, and pushes the updated index back to GitHub.
6.  **Save Stats Locally**: The worker runs `getFirestoreData()`, increments `easy` solves by `1`, appends the problem to `solvedList` with a timestamp, and saves the updated counts locally.
7.  **Extension Badge Feed**: The background service worker sends a successful sync signal back to the content script, which displays a green, fading **"Pushed! ✅"** badge directly on the LeetCode screen.


