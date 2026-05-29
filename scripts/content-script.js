// AlgoSync Content Script - Surgical Edition v2
(function() {
  const PLATFORMS = { LEETCODE: 'LeetCode', GFG: 'GeeksforGeeks', HACKERRANK: 'HackerRank' };
  let currentPlatform = null;
  if (window.location.hostname.includes('leetcode')) currentPlatform = PLATFORMS.LEETCODE;
  else if (window.location.hostname.includes('geeksforgeeks')) currentPlatform = PLATFORMS.GFG;
  else if (window.location.hostname.includes('hackerrank')) currentPlatform = PLATFORMS.HACKERRANK;

  if (!currentPlatform) return;
  function isContextValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }

  injectBadge();

  // --- SUBMISSION TRACKER ---
  let lastSubmissionTime = 0;

  function observeGFG() {
    const observer = new MutationObserver(() => {
      const now = Date.now();
      const successMessage = document.body.innerText.includes('Problem Solved Successfully');
      
      // Only sync if it's a NEW success message (more than 5 seconds since last sync)
      if (successMessage && (now - lastSubmissionTime > 5000)) {
        lastSubmissionTime = now;
        syncSolution();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getChallengeSlug() {
    const match = window.location.pathname.match(/\/challenges\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  function cacheProblemDetails() {
    if (currentPlatform !== PLATFORMS.HACKERRANK) return;
    if (window.location.pathname.includes('/submissions') || 
        window.location.pathname.includes('/leaderboard') || 
        window.location.pathname.includes('/forum') || 
        window.location.pathname.includes('/editorial')) {
      return;
    }
    const descContainer = document.querySelector('.challenge-body-html') || 
                          document.querySelector('.challenge_description') || 
                          document.querySelector('[class*="problem-statement"]') || 
                          document.querySelector('[class*="challenge-description"]');
    
    if (descContainer && descContainer.innerText.trim().length > 10) {
      const slug = getChallengeSlug();
      if (!slug) return;
      
      const cachedData = {
        title: getCleanTitleRaw(),
        difficulty: getCleanDifficulty(),
        description: getCleanDescription(),
        testCases: getCleanTestCases(),
        companyTags: getCleanTags('company'),
        topicTags: getCleanTags('topic'),
        timestamp: Date.now()
      };
      
      sessionStorage.setItem(`algosync_cache_${slug}`, JSON.stringify(cachedData));
    }
  }

  async function scrapeProblemData() {
    let title = getCleanTitle();
    let difficulty = getCleanDifficulty();
    let description = getCleanDescription();
    let testCases = getCleanTestCases();
    let companyTags = getCleanTags('company');
    let topicTags = getCleanTags('topic');

    if (currentPlatform === PLATFORMS.HACKERRANK) {
      const slug = getChallengeSlug();
      if (slug) {
        const cachedStr = sessionStorage.getItem(`algosync_cache_${slug}`);
        if (cachedStr) {
          try {
            const cached = JSON.parse(cachedStr);
            if (window.location.pathname.includes('/submissions') || 
                window.location.pathname.includes('/leaderboard') || 
                window.location.pathname.includes('/forum') || 
                window.location.pathname.includes('/editorial') || 
                title.toLowerCase().includes('submission') || 
                title === 'Problem' || 
                description.includes('Description scrape failed') || 
                description.length < 50 || 
                !document.querySelector('.challenge-body-html, .challenge_description, [class*="problem-statement"], [class*="challenge-description"], [data-analytics="ChallengeStatement"]')) {
              title = cached.title || title;
              difficulty = cached.difficulty || difficulty;
              description = cached.description || description;
              testCases = cached.testCases || testCases;
              companyTags = cached.companyTags || companyTags;
              topicTags = cached.topicTags || topicTags;
            }
          } catch (e) {
            console.error('Failed to parse cached details', e);
          }
        }
      }
    }

    return {
      platform: currentPlatform,
      problemName: title,
      difficulty: difficulty,
      code: await getCleanCode(),
      extension: getCleanExtension(),
      description: description,
      testCases: testCases,
      companyTags: companyTags,
      topicTags: topicTags
    };
  }

  function getCleanTitleRaw() {
    const selectors = ['.problems_header_content__S_W_K h3', '.problem-title', 'h3[class*="title"]', '.question-title', '#question-title'];
    for (let s of selectors) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim().length > 2) return el.innerText.trim();
    }
    return document.title.split('|')[0].replace('Practice', '').replace('GeeksforGeeks', '').trim() || 'Problem';
  }

  function getCleanTitle() {
    let title = getCleanTitleRaw();
    if (currentPlatform === PLATFORMS.HACKERRANK) {
      title = title.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim();
    }
    return title;
  }

  function getCleanDifficulty() {
    const match = document.body.innerText.match(/Difficulty:\s*(\w+)/i);
    return match ? match[1] : (document.querySelector('.text-olive, .text-yellow, .text-pink')?.innerText.trim() || 'Medium');
  }

  async function getCleanCode() {
    const lines = Array.from(document.querySelectorAll('.ace_line, .view-line, .CodeMirror-line')).map(l => l.innerText);
    if (lines.length > 5) return lines.join('\n');
    const editor = document.querySelector('.monaco-editor, .ace_editor, .CodeMirror');
    return editor ? editor.innerText : "Code Scrape Failed";
  }

  function getCleanExtension() {
    const t = document.body.innerText.toLowerCase();
    return t.includes('java') ? 'java' : (t.includes('python') ? 'py' : (t.includes('cpp') || t.includes('c++') ? 'cpp' : 'java'));
  }

  function getCleanDescription() {
    let descContainer = document.querySelector('.problems_problem_content__S_W_K') || 
                        document.querySelector('[data-track-load="description_content"]') ||
                        document.querySelector('[data-cy="question-content"]') ||
                        document.querySelector('[class*="problem_content"]') || 
                        document.querySelector('.problem-statement') ||
                        document.querySelector('.challenge-body-html') ||
                        document.querySelector('.challenge_description') ||
                        document.querySelector('[class*="challenge-description"]') ||
                        document.querySelector('[data-analytics="ChallengeStatement"]');
                        
    if (!descContainer) {
      let text = document.body.innerText;
      if (text.includes('Problems (13)')) { const parts = text.split(/Problems \(\d+\)/); text = parts[parts.length - 1]; }
      const blackList = ['Courses', 'Free Google Workshops', 'Problem of the Day', 'Ask A Doubt', 'My Doubts', 'Not Available', 'Back', 'Next Track', 'Problems Solved', 'Complete', 'Progress may take upto', 'Problem Editorial Submissions', 'Go to Videos', 'Next', 'Accuracy:', 'Submissions:', 'Points:', 'Average Time:', 'Topic Tags', 'Company Tags'];
      blackList.forEach(word => { text = text.split('\n').filter(line => !line.includes(word)).join('\n'); });
      const startKeywords = ['Given', 'Write', 'Implement', 'You are given'];
      for (let kw of startKeywords) { if (text.includes(kw)) { text = text.substring(text.indexOf(kw)); break; } }
      return text.trim() || 'Description scrape failed.';
    }
    
    return descContainer.innerText.trim();
  }

  function getCleanTags(type) {
    const selector = type === 'company' ? 'a[href*="company"]' : 'a[href*="topic"]';
    const tags = Array.from(document.querySelectorAll(selector)).map(t => t.innerText.trim()).filter(t => t && t.length < 40 && !t.includes('Report'));
    return [...new Set(tags)].join(', ') || 'None';
  }

  function getCleanTestCases() {
    if (currentPlatform === PLATFORMS.HACKERRANK) {
      const preElements = Array.from(document.querySelectorAll('.challenge-user-input, .challenge-user-output, pre'));
      const cases = preElements.map(el => {
        let label = '';
        let prev = el.previousElementSibling;
        if (prev && (prev.tagName.startsWith('H') || prev.className.includes('title') || prev.className.includes('label') || prev.className.includes('heading'))) {
          label = prev.innerText.trim() + ':\n';
        }
        return label + el.innerText.trim();
      }).filter(t => t.trim().length > 0 && t.length < 1000);
      
      if (cases.length > 0) return cases.join('\n\n');
    }

    const cases = Array.from(document.querySelectorAll('pre, [class*="example"]')).map(c => c.innerText.trim()).filter(t => t.toLowerCase().includes('input') || t.toLowerCase().includes('output'));
    return cases.join('\n\n') || 'Test cases not found.';
  }

  function injectBadge() {
    if (document.getElementById('algosync-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'algosync-badge';
    let logoUrl = '';
    try { logoUrl = chrome.runtime.getURL('assets/AlgoSync extension logo.png'); } catch(e) {}
    badge.innerHTML = `<div class="badge-content"><span class="label" id="badge-label">AlgoSync</span><button class="manual-push" id="btn-manual-sync">↑ Sync</button></div><img src="${logoUrl}" class="badge-icon" alt="A">`;
    document.body.appendChild(badge);
    badge.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') badge.classList.toggle('expanded'); });
    document.getElementById('btn-manual-sync').addEventListener('click', (e) => { e.stopPropagation(); syncSolution(); });
  }

  async function syncSolution() {
    const badge = document.getElementById('algosync-badge');
    const label = document.getElementById('badge-label');
    const syncBtn = document.getElementById('btn-manual-sync');
    if (!isContextValid()) { badge.classList.add('error', 'expanded'); label.innerText = 'Please Refresh!'; return; }
    badge.classList.add('expanded', 'algosync-syncing');
    label.innerText = 'Pushing...';
    syncBtn.style.display = 'none';
    try {
      const payload = await scrapeProblemData();
      chrome.runtime.sendMessage({ action: 'pushSolution', payload }, (res) => {
        badge.classList.remove('algosync-syncing');
        if (res && res.success) {
          badge.classList.add('success');
          label.innerText = res.message === 'Duplicate code skipped' ? 'Same Code! 📁' : 'Pushed! ✅';
        } else {
          badge.classList.add('error');
          label.innerText = 'Failed! ❌';
          if (res?.error) alert('AlgoSync Error: ' + res.error);
        }
        setTimeout(() => {
          badge.classList.remove('expanded', 'success', 'error');
          setTimeout(() => { label.innerText = 'AlgoSync'; syncBtn.style.display = 'block'; }, 300);
        }, 3000);
      });
    } catch (e) { badge.classList.remove('algosync-syncing'); badge.classList.add('error', 'expanded'); label.innerText = 'Please Refresh!'; }
  }
  function observeHackerRank() {
    const observer = new MutationObserver(() => {
      const now = Date.now();
      const text = document.body.innerText;
      const successMessage = text.includes('Congratulations!') || 
                            text.includes('Compiler Message: Success') || 
                            text.includes('All test cases passed!') ||
                            text.includes('Success!') ||
                            document.querySelector('.congrats-heading, .submission-status-success, [class*="congrats"]') !== null;
      
      if (successMessage && (now - lastSubmissionTime > 5000)) {
        lastSubmissionTime = now;
        syncSolution();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (currentPlatform === PLATFORMS.GFG) observeGFG();
  else if (currentPlatform === PLATFORMS.HACKERRANK) {
    observeHackerRank();
    cacheProblemDetails();
    const cacheObserver = new MutationObserver(() => {
      cacheProblemDetails();
    });
    cacheObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
