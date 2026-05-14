# 🚀 AlgoSync: The Ultimate Coding Sync Pipeline

**AlgoSync** is a premium Chrome Extension (Manifest V3) designed to bridge the gap between competitive programming platforms and your professional GitHub portfolio. It automates the synchronization of solutions from **LeetCode**, **GeeksforGeeks**, and **HackerRank** into a structured, version-controlled GitHub repository.

---

## 🏗️ System Architecture & Pipeline

AlgoSync operates on a high-reliability, 5-stage pipeline designed to ensure that no solution is ever lost and every commit is professional.

### 1. Detection Engine (Hybrid Model)
- **LeetCode**: Uses a network-level interceptor to catch the exact GraphQL response for `Accepted` submissions.
- **GFG & HackerRank**: Employs a `MutationObserver` to detect success modals and result messages in real-time.
- **Manual Push**: Provides a floating UI badge for on-demand syncing.

### 2. High-Accuracy Scraping
Unlike basic tools, AlgoSync targets the internal models of the **Monaco** and **Ace** editors. 
- **Clean Code**: Filters out line numbers, ghost characters, and IDE artifacts.
- **Metadata**: Scrapes Problem Difficulty, Title, Description, and Sample Test Cases.

### 3. Smart Versioning Logic (No-Overwrite Policy)
AlgoSync queries the GitHub API before every push. 
- If a solution already exists (e.g., `TwoSum.java`), it automatically versions the new one as `TwoSum_V2.java`.
- This preserves your coding history and allows you to track your progress on the same problem over time.

### 4. Transformation & Performance Analytics
- **Pathing**: `[Platform]/[Difficulty]/[Problem Name]/...`
- **Performance**: Captures **Runtime (ms)** and **Memory (MB)** metrics directly from the submission results and embeds them in the files.
- **Context**: Generates a `README.md` for *each* problem folder with the full problem description and test cases.

### 5. Master Progress Dashboard
- Every successful sync updates a **Global Progress Table** in your repository's root `README.md`. 
- This turns your repository into a searchable, categorized database of your coding achievements.

---

## ✨ Premium Features
- **Glassmorphism UI**: A sleek, dark-themed dashboard for managing repositories and viewing live stats.
- **Live Stats**: Track your **Easy**, **Medium**, and **Hard** problem counts in real-time.
- **Triple-Platform Support**: One extension to rule them all—no need for separate GFG or HackerRank tools.
- **Force Sync Badge**: An on-screen status indicator that lets you know when AlgoSync is active and ready.

---

## 🛠️ Installation & Setup

1. **GitHub Setup**: 
   - Register an OAuth App on GitHub.
   - Set the callback URL to `https://[EXTENSION_ID].chromiumapp.org/`.
   - Update `GITHUB_CLIENT_ID` and `SECRET` in `background.js`.
2. **Chrome Setup**:
   - Go to `chrome://extensions`.
   - Enable **Developer Mode**.
   - Click **Load Unpacked** and select this folder.
3. **Sync**:
   - Link your repo via the extension popup and start solving!

---

*Made with ❤️ for the Developer Community.*
