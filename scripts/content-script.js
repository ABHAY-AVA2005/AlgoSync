// AlgoSync Content Script - Refined High-Accuracy Version
(function() {
  const PLATFORMS = {
    LEETCODE: 'LeetCode',
    GFG: 'GeeksforGeeks',
    HACKERRANK: 'HackerRank'
  };

  let currentPlatform = null;
  if (window.location.hostname.includes('leetcode')) currentPlatform = PLATFORMS.LEETCODE;
  else if (window.location.hostname.includes('geeksforgeeks')) currentPlatform = PLATFORMS.GFG;
  else if (window.location.hostname.includes('hackerrank')) currentPlatform = PLATFORMS.HACKERRANK;

  if (!currentPlatform) return;

  injectBadge();

  // --- Platform Observation Strategies ---

  function observeLeetCode() {
    // LeetCode uses a specific success message locator
    const observer = new MutationObserver(() => {
      const success = document.querySelector('[data-e2e-locator="submission-result"]');
      if (success && success.innerText.includes('Accepted')) {
        syncSolution();
        observer.disconnect();
        setTimeout(observeLeetCode, 5000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeGFG() {
    // GFG shows a "Problem Solved Successfully" modal
    const observer = new MutationObserver(() => {
      if (document.body.innerText.includes('Problem Solved Successfully')) {
        syncSolution();
        observer.disconnect();
        setTimeout(observeGFG, 5000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeHackerRank() {
    const observer = new MutationObserver(() => {
      const success = document.querySelector('.congratulations-heading');
      if (success) {
        syncSolution();
        observer.disconnect();
        setTimeout(observeHackerRank, 5000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --- Advanced Scrapers ---

  async function scrapeProblemData() {
    return {
      platform: currentPlatform,
      problemName: getCleanTitle(),
      difficulty: getCleanDifficulty(),
      code: await getCleanCode(),
      extension: getCleanExtension(),
      description: getCleanDescription(),
      testCases: getCleanTestCases(),
      stats: getPerformanceStats()
    };
  }

  function getPerformanceStats() {
    let stats = { runtime: 'N/A', memory: 'N/A' };
    if (currentPlatform === PLATFORMS.LEETCODE) {
      const runtimeElem = document.querySelector('[data-e2e-locator="submission-runtime"]');
      const memoryElem = document.querySelector('[data-e2e-locator="submission-memory"]');
      if (runtimeElem) stats.runtime = runtimeElem.innerText;
      if (memoryElem) stats.memory = memoryElem.innerText;
    }
    return stats;
  }

  function getCleanTitle() {
    if (currentPlatform === PLATFORMS.LEETCODE) return document.querySelector('.text-title-large')?.innerText.split('. ')[1] || 'Problem';
    if (currentPlatform === PLATFORMS.GFG) return document.querySelector('.problems_header_content__S_W_K h3')?.innerText || 'Problem';
    return document.querySelector('.page-label')?.innerText || 'Problem';
  }

  function getCleanDifficulty() {
    if (currentPlatform === PLATFORMS.LEETCODE) {
      const diff = document.querySelector('.text-pink, .text-yellow, .text-olive');
      return diff ? diff.innerText : 'Medium';
    }
    if (currentPlatform === PLATFORMS.GFG) return document.querySelector('.problems_header_description__S_W_K span')?.innerText || 'Medium';
    return 'Medium';
  }

  async function getCleanCode() {
    // 1. Try to use the 'Copy' button strategy (most reliable for Monaco)
    // 2. Fallback to scraping the editor lines while filtering out line numbers
    
    if (currentPlatform === PLATFORMS.LEETCODE) {
      // LeetCode's Monaco editor keeps code in 'view-line' divs
      const lines = Array.from(document.querySelectorAll('.view-line')).map(l => l.innerText);
      return lines.join('\n');
    }
    
    if (currentPlatform === PLATFORMS.GFG || currentPlatform === PLATFORMS.HACKERRANK) {
      // Often use Ace or specialized editors
      const editor = document.querySelector('.ace_content') || document.querySelector('.CodeMirror-code');
      if (editor) {
        const lines = Array.from(editor.querySelectorAll('.ace_line, .CodeMirror-line')).map(l => l.innerText);
        return lines.join('\n');
      }
    }

    return "Code Scrape Failed - Check Selectors";
  }

  function getCleanExtension() {
    const text = document.body.innerText.toLowerCase();
    if (text.includes('java')) return 'java';
    if (text.includes('python')) return 'py';
    if (text.includes('c++') || text.includes('cpp')) return 'cpp';
    if (text.includes('javascript')) return 'js';
    return 'txt';
  }

  function getCleanDescription() {
    const desc = document.querySelector('[data-key="description-content"]') || document.querySelector('.problems_problem_content__D_m_J');
    return desc ? desc.innerText : 'No description found.';
  }

  function getCleanTestCases() {
    const examples = Array.from(document.querySelectorAll('pre, code')).filter(el => el.innerText.toLowerCase().includes('input'));
    return examples.map(e => e.innerText).join('\n\n') || 'Sample test cases not found.';
  }

  // --- UI Helpers ---

  function injectBadge() {
    if (document.getElementById('algosync-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'algosync-badge';
    badge.innerHTML = `
      <div class="status-dot"></div>
      <span class="label">AlgoSync: Active</span>
      <button class="manual-push">Force Sync</button>
    `;
    document.body.appendChild(badge);
    badge.addEventListener('click', () => syncSolution(true));
  }

  async function syncSolution(manual = false) {
    const badge = document.getElementById('algosync-badge');
    badge.classList.add('algosync-syncing');
    
    const payload = await scrapeProblemData();
    chrome.runtime.sendMessage({ action: 'pushSolution', payload }, (res) => {
      badge.classList.remove('algosync-syncing');
      const toast = document.createElement('div');
      toast.className = 'algosync-toast';
      toast.innerText = res.success ? '✓ Synced to GitHub' : '✗ Sync Failed';
      toast.style.cssText = `position:fixed; bottom:70px; right:20px; background:#1e293b; color:white; padding:8px 16px; border-radius:8px; z-index:999999; border:1px solid ${res.success ? '#10b981' : '#ef4444'}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    });
  }

  // Start Observation
  if (currentPlatform === PLATFORMS.LEETCODE) observeLeetCode();
  else if (currentPlatform === PLATFORMS.GFG) observeGFG();
  else if (currentPlatform === PLATFORMS.HACKERRANK) observeHackerRank();

})();
