(async () => {
  // --- Instant Theme Recovery ---
  const { theme } = await AlgoStorage.getSettings();
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }

  const init = async () => {
    const authView = document.getElementById('auth-view');
    const dashboardView = document.getElementById('dashboard-view');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const syncBtn = document.getElementById('sync-btn');
    const repoSection = document.getElementById('repo-section');
    const repoInput = document.getElementById('repo-input');
    const repoToggle = document.getElementById('repo-toggle');
    const repoDropdown = document.getElementById('repo-dropdown');
    const themeToggle = document.getElementById('theme-toggle');

    // --- Theme Toggle ---
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      document.body.setAttribute('data-theme', newTheme);
      AlgoStorage.setTheme(newTheme);
    });

    const calculateStreak = (list) => {
      if (!list || list.length === 0) return { streak: 0, startDate: '' };
      const uniqueDates = new Set();
      for (const item of list) {
        if (typeof item === 'object' && item.date) {
          uniqueDates.add(item.date);
        }
      }
      if (uniqueDates.size === 0) return { streak: 0, startDate: '' };

      const sortedDates = Array.from(uniqueDates).map(d => {
        const parsed = Date.parse(d);
        return isNaN(parsed) ? null : new Date(parsed);
      }).filter(d => d !== null).sort((a, b) => b - a);

      if (sortedDates.length === 0) return { streak: 0, startDate: '' };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const newestDate = sortedDates[0];
      newestDate.setHours(0, 0, 0, 0);

      if (newestDate < yesterday) {
        return { streak: 0, startDate: '' }; // Streak ended
      }

      let streak = 1;
      let currentRef = newestDate;

      for (let i = 1; i < sortedDates.length; i++) {
        const prevDate = sortedDates[i];
        prevDate.setHours(0, 0, 0, 0);

        const diffTime = Math.abs(currentRef - prevDate);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          streak++;
          currentRef = prevDate;
        } else if (diffDays > 1) {
          break;
        }
      }
      return { streak, startDate: currentRef.toLocaleDateString() };
    };

    const syncStreakWithGithub = async () => {
      const { accessToken, selectedRepo } = await AlgoStorage.getUser();
      const { solvedList } = await getFirestoreData();
      if (!accessToken || !selectedRepo) return;

      try {
        const response = await fetch(`https://api.github.com/repos/${selectedRepo}/contents/README.md?t=${Date.now()}`, {
          headers: { 'Authorization': `token ${accessToken}` }
        });
        if (!response.ok) return;

        const data = await response.json();
        const binString = atob(data.content.replace(/\n/g, ''));
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) { bytes[i] = binString.charCodeAt(i); }
        const content = new TextDecoder().decode(bytes);

        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        let rawRows = [];
        let isProgressSection = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes('My Coding Progress')) {
            isProgressSection = true;
            continue;
          }
          if (isProgressSection) {
            if (line.startsWith('|')) {
              const isHeader = line.toLowerCase().includes('platform') || line.includes('---');
              if (!isHeader) {
                rawRows.push(line);
              }
            } else if (line.length > 0 && !line.startsWith('|')) {
              break;
            }
          }
        }

        const list = solvedList || [];
        let updated = false;

        for (const row of rawRows) {
          const cells = row.split('|').map(c => c.trim());
          if (cells.length > 0 && cells[0] === '') cells.shift();
          if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();

          if (cells.length < 5) continue;

          const firstColIsNum = /^\d+$/.test(cells[0]);
          let platform, problem, difficulty, date;
          if (firstColIsNum) {
            platform = cells[1];
            problem = cells[2];
            difficulty = cells[3];
            date = cells[5];
          } else {
            platform = cells[0];
            problem = cells[1];
            difficulty = cells[2];
            date = cells[4];
          }

          const cleanReadmeProblem = problem.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
          const cleanName = cleanReadmeProblem.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim();

          const matchIndex = list.findIndex(item => {
            const localName = typeof item === 'string' ? item : item.name;
            return localName.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim().toLowerCase() === cleanName.toLowerCase();
          });

          if (matchIndex !== -1) {
            const item = list[matchIndex];
            if (typeof item === 'string') {
              list[matchIndex] = {
                name: cleanName,
                difficulty: difficulty || 'Medium',
                platform: platform || 'LeetCode',
                date: date || new Date().toLocaleDateString()
              };
              updated = true;
            } else if (!item.date || item.date !== date) {
              list[matchIndex].date = date || new Date().toLocaleDateString();
              list[matchIndex].platform = platform || item.platform;
              list[matchIndex].difficulty = difficulty || item.difficulty;
              updated = true;
            }
          } else {
            list.push({
              name: cleanName,
              difficulty: difficulty || 'Medium',
              platform: platform || 'LeetCode',
              date: date || new Date().toLocaleDateString()
            });
            updated = true;
          }
        }

        if (updated) {
          let easy = 0, medium = 0, hard = 0;
          for (const item of list) {
            const d = (item.difficulty || 'Medium').toLowerCase();
            if (d.includes('easy') || d.includes('basic')) easy++;
            else if (d.includes('medium')) medium++;
            else if (d.includes('hard')) hard++;
            else easy++;
          }
          const s = { total: list.length, easy, medium, hard };
          
          await setFirestoreData(s, list);

          document.getElementById('stat-total').innerText = s.total;
          document.getElementById('stat-easy').innerText = s.easy;
          document.getElementById('stat-medium').innerText = s.medium;
          document.getElementById('stat-hard').innerText = s.hard;

          const streakData = calculateStreak(list);
          document.getElementById('streak-text').innerText = `${streakData.streak} Day${streakData.streak === 1 ? '' : 's'}`;
          if (streakData.streak > 0) {
            document.getElementById('streak-start-text').innerText = `Since ${streakData.startDate}`;
          } else {
            document.getElementById('streak-start-text').innerText = 'Start one today!';
          }
        }
      } catch (err) {
        console.error('Error syncing streak with GitHub:', err);
      }
    };

    // --- State Check & Auto-Refetch ---
    const checkState = async () => {
      const { accessToken, selectedRepo } = await AlgoStorage.getUser();
      const { stats, solvedList } = await getFirestoreData();
      
      if (accessToken) {
        authView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        
        const streakData = calculateStreak(solvedList || []);
        document.getElementById('streak-text').innerText = `${streakData.streak} Day${streakData.streak === 1 ? '' : 's'}`;
        if (streakData.streak > 0) {
          document.getElementById('streak-start-text').innerText = `Since ${streakData.startDate}`;
        } else {
          document.getElementById('streak-start-text').innerText = 'Start one today!';
        }
        
        // Dynamic background recovery of streak from GitHub repository README.md!
        syncStreakWithGithub();

        if (selectedRepo) {
          // Display short repo name but keep full_name in data-full-repo
          repoInput.value = selectedRepo.includes('/') ? selectedRepo.split('/')[1] : selectedRepo;
          repoInput.setAttribute('data-full-repo', selectedRepo);
        } else {
          // Smart Default: If no repository is locked yet, try to auto-select the most recently updated one
          const { repos } = await AlgoStorage.getUser();
          if (repos && Array.isArray(repos) && repos.length > 0) {
            const defaultRepo = repos[0].full_name;
            await AlgoStorage.setRepo(defaultRepo);
            repoInput.value = repos[0].name;
            repoInput.setAttribute('data-full-repo', defaultRepo);
          }
        }
        
        const s = stats || { total: 0, easy: 0, medium: 0, hard: 0 };
        document.getElementById('stat-total').innerText = s.total;
        document.getElementById('stat-easy').innerText = s.easy;
        document.getElementById('stat-medium').innerText = s.medium;
        document.getElementById('stat-hard').innerText = s.hard;

        // Auto-refetch repos to keep dropdown fresh
        chrome.runtime.sendMessage({ action: 'fetchRepos' });
      } else {
        authView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
      }
    };

    await checkState();

    // --- Dropdown Logic (Search & Select Dropdown Combo) ---
    const renderDropdown = async (filterText = '') => {
      const { repos } = await AlgoStorage.getUser();
      const { selectedRepo } = await AlgoStorage.getUser();
      
      repoDropdown.innerHTML = '';
      if (!repos || !Array.isArray(repos) || repos.length === 0) {
        const div = document.createElement('div');
        div.className = 'dropdown-info-item';
        div.textContent = 'No repositories found. Ensure you are connected.';
        repoDropdown.appendChild(div);
        return;
      }

      let filtered = repos;
      if (filterText.trim()) {
        const query = filterText.toLowerCase().trim();
        // Filter based on short name instead of full name
        filtered = repos.filter(r => r && r.name && r.name.toLowerCase().includes(query));
      }

      if (filtered.length === 0) {
        const div = document.createElement('div');
        div.className = 'dropdown-info-item';
        div.textContent = `No matches found for "${filterText}"`;
        repoDropdown.appendChild(div);
        return;
      }

      filtered.forEach(r => {
        const isSelected = selectedRepo && selectedRepo.toLowerCase() === r.full_name.toLowerCase();
        const badgeClass = r.private ? 'private-badge' : 'public-badge';
        const badgeLabel = r.private ? 'Private' : 'Public';
        
        const lockOrGlobeIconSVG = r.private 
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
        
        const itemDiv = document.createElement('div');
        itemDiv.className = `dropdown-item ${isSelected ? 'selected' : ''}`;
        itemDiv.setAttribute('data-repo', r.full_name);
        itemDiv.setAttribute('data-name', r.name);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'repo-item-content';
        contentDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="repo-item-icon"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'repo-item-name';
        nameSpan.textContent = r.name;
        contentDiv.appendChild(nameSpan);
        
        const badgeSpan = document.createElement('span');
        badgeSpan.className = `repo-badge ${badgeClass}`;
        badgeSpan.innerHTML = `${lockOrGlobeIconSVG} ${badgeLabel}`;
        
        itemDiv.appendChild(contentDiv);
        itemDiv.appendChild(badgeSpan);
        repoDropdown.appendChild(itemDiv);
      });
    };

    const openDropdown = async () => {
      await renderDropdown(''); // Show all repos when opening explicitly
      repoDropdown.classList.add('active');
      repoSection.classList.add('dropdown-open');
    };

    const closeDropdown = () => {
      repoDropdown.classList.remove('active');
      repoSection.classList.remove('dropdown-open');
    };

    const toggleDropdown = async (e) => {
      e.stopPropagation();
      const isOpen = repoDropdown.classList.contains('active');
      if (isOpen) {
        closeDropdown();
      } else {
        await openDropdown();
      }
    };

    // Toggle dropdown when clicking the chevron button
    repoToggle.addEventListener('click', toggleDropdown);

    // Open dropdown when focusing/clicking input field
    repoInput.addEventListener('focus', openDropdown);
    repoInput.addEventListener('click', openDropdown);

    // Filter list as user types
    repoInput.addEventListener('input', async () => {
      await renderDropdown(repoInput.value);
      if (!repoDropdown.classList.contains('active')) {
        repoDropdown.classList.add('active');
        repoSection.classList.add('dropdown-open');
      }

      // Update data-full-repo attribute dynamically as user types
      const val = repoInput.value.trim();
      if (!val) {
        repoInput.removeAttribute('data-full-repo');
        return;
      }
      const { repos } = await AlgoStorage.getUser();
      const exactMatch = repos && Array.isArray(repos) && repos.find(r => r && r.name && r.name.toLowerCase() === val.toLowerCase());
      if (exactMatch) {
        repoInput.setAttribute('data-full-repo', exactMatch.full_name);
      } else if (val.includes('/')) {
        repoInput.setAttribute('data-full-repo', val);
      } else {
        let username = '';
        if (repos && Array.isArray(repos) && repos.length > 0 && repos[0] && repos[0].owner && repos[0].owner.login) {
          username = repos[0].owner.login;
        }
        if (username) {
          repoInput.setAttribute('data-full-repo', `${username}/${val}`);
        } else {
          repoInput.setAttribute('data-full-repo', val);
        }
      }
    });

    // Close when clicking outside of repository section
    document.addEventListener('click', (e) => {
      if (!repoSection.contains(e.target)) {
        closeDropdown();
      }
    });

    // Handle selection from dropdown with instant auto-save
    repoDropdown.addEventListener('click', async (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        const fullRepo = item.getAttribute('data-repo');
        const shortName = item.getAttribute('data-name');
        repoInput.value = shortName;
        repoInput.setAttribute('data-full-repo', fullRepo);
        closeDropdown();
        
        // Auto-save the selected repository immediately to prevent blank input on reload
        await AlgoStorage.setRepo(fullRepo);
        
        // Dynamic visual feedback for selected input
        repoInput.style.borderColor = 'var(--success)';
        setTimeout(() => repoInput.style.borderColor = '', 1000);
      }
    });

    // Auto-save typed custom values on blur (loss of focus)
    repoInput.addEventListener('blur', () => {
      setTimeout(async () => {
        let repo = repoInput.getAttribute('data-full-repo');
        if (!repo) {
          const val = repoInput.value.trim();
          if (val.includes('/')) {
            repo = val;
          } else if (val) {
            const { repos } = await AlgoStorage.getUser();
            let username = '';
            if (repos && Array.isArray(repos) && repos.length > 0 && repos[0] && repos[0].owner && repos[0].owner.login) {
              username = repos[0].owner.login;
            }
            if (username) repo = `${username}/${val}`;
            else repo = val;
          }
        }
        if (repo && repo.includes('/')) {
          await AlgoStorage.setRepo(repo);
        }
      }, 200);
    });

    // Auto-update UI if repos finish loading while dropdown is open
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === 'local' && changes.repos) {
        if (repoDropdown.classList.contains('active')) {
          renderDropdown(repoInput.value);
        }
        // If selectedRepo is still blank, auto-populate with the fresh repos default!
        const { selectedRepo } = await AlgoStorage.getUser();
        if (!selectedRepo && changes.repos.newValue && Array.isArray(changes.repos.newValue) && changes.repos.newValue.length > 0) {
          const defaultRepo = changes.repos.newValue[0].full_name;
          await AlgoStorage.setRepo(defaultRepo);
          repoInput.value = changes.repos.newValue[0].name;
          repoInput.setAttribute('data-full-repo', defaultRepo);
        }
      }

      // Auto-update view if token changes or gets cleared from other context
      if (areaName === 'sync' && changes.accessToken) {
        checkState();
      }
    });

    // Listen to token expired event
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'tokenExpired') {
        authView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
      }
    });

    loginBtn.addEventListener('click', () => {
      loginBtn.innerText = 'Opening Auth...';
      loginBtn.disabled = true;
      // Add a timestamp cache buster so Chrome NEVER loads a broken cached version of login.html
      const cacheBuster = Date.now();
      chrome.tabs.create({ url: `https://algosync-a537d.web.app/login.html?extId=${chrome.runtime.id}&v=${cacheBuster}` });
    });

    document.getElementById('open-repo-btn').addEventListener('click', async () => {
      const { selectedRepo } = await AlgoStorage.getUser();
      if (selectedRepo) {
        chrome.tabs.create({ url: `https://github.com/${selectedRepo}` });
      } else {
        alert("Please select and lock a repository first!");
      }
    });

    logoutBtn.addEventListener('click', async () => {
      if (confirm('Unlink your GitHub account?')) {
        await AlgoStorage.clearUser();
        checkState();
      }
    });

    syncBtn.addEventListener('click', async () => {
      let repo = repoInput.getAttribute('data-full-repo');
      if (!repo) {
        const val = repoInput.value.trim();
        if (val.includes('/')) {
          repo = val;
        } else if (val) {
          const { repos } = await AlgoStorage.getUser();
          let username = '';
          if (repos && Array.isArray(repos) && repos.length > 0 && repos[0] && repos[0].owner && repos[0].owner.login) {
            username = repos[0].owner.login;
          }
          if (username) repo = `${username}/${val}`;
          else repo = val;
        }
      }

      if (!repo || !repo.includes('/')) {
        alert('Please select a repository or enter as: repository_name');
        return;
      }
      await AlgoStorage.setRepo(repo);
      alert('Target Repository Locked! ✅');
    });

    // --- Sync History & Deduplication Features ---
    const solvedListContainer = document.getElementById('solved-list-container');
    const closeSolvedListBtn = document.getElementById('close-solved-list');
    const openHistoryBtn = document.getElementById('open-history');
    const solvedListElement = document.getElementById('solved-list');
    const solvedListSearch = document.getElementById('solved-list-search');
    const dedupBtn = document.getElementById('dedup-btn');

    const renderHistoryList = async (filterText = '') => {
      const { selectedRepo } = await AlgoStorage.getUser();
      const { solvedList } = await getFirestoreData();
      const list = solvedList || [];
      
      solvedListElement.innerHTML = '';
      if (list.length === 0) {
        const div = document.createElement('div');
        div.className = 'dropdown-info-item';
        div.style.color = 'var(--text-secondary)';
        div.style.textAlign = 'center';
        div.style.marginTop = '40px';
        div.style.fontStyle = 'italic';
        div.textContent = 'No solved problems in history yet.';
        solvedListElement.appendChild(div);
        return;
      }

      const query = filterText.toLowerCase().trim();
      let matchFound = false;
      
      // Display in reverse order (newest first)
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        const rawName = typeof item === 'string' ? item : item.name;
        const difficulty = typeof item === 'string' ? 'Medium' : (item.difficulty || 'Medium');
        const platform = typeof item === 'string' ? 'LeetCode' : (item.platform || 'LeetCode');
        
        if (query && !rawName.toLowerCase().includes(query) && !platform.toLowerCase().includes(query)) {
          continue;
        }

        matchFound = true;
        const diffClass = difficulty.toLowerCase().includes('easy') || difficulty.toLowerCase().includes('basic') 
          ? 'easy' 
          : (difficulty.toLowerCase().includes('hard') ? 'hard' : 'medium');
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'solved-item';
        itemDiv.setAttribute('data-index', i.toString());
        
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'solved-item-details';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'solved-item-title';
        titleSpan.setAttribute('title', rawName);
        titleSpan.textContent = rawName;
        detailsDiv.appendChild(titleSpan);
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'solved-item-meta';
        
        const platformSpan = document.createElement('span');
        platformSpan.className = 'solved-item-platform';
        platformSpan.textContent = platform;
        
        const diffSpan = document.createElement('span');
        diffSpan.className = `solved-item-diff ${diffClass}`;
        diffSpan.textContent = difficulty;
        
        metaDiv.appendChild(platformSpan);
        metaDiv.appendChild(diffSpan);
        detailsDiv.appendChild(metaDiv);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'solved-item-actions';
        
        if (selectedRepo) {
          const getFolderPrefix = (plat) => {
            const p = plat.toLowerCase();
            if (p.includes('leetcode')) return '[LC] ';
            if (p.includes('geeksforgeeks') || p === 'gfg') return '[GFG] ';
            if (p.includes('hackerrank')) return '[HR] ';
            return '';
          };
          const folderPrefix = getFolderPrefix(platform);
          const folderName = encodeURIComponent(folderPrefix + rawName);
          const repoLink = `https://github.com/${selectedRepo}/tree/main/${folderName}`;
          
          const a = document.createElement('a');
          a.href = repoLink;
          a.target = '_blank';
          a.className = 'solved-item-link';
          a.title = 'Open solution in GitHub';
          a.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
          actionsDiv.appendChild(a);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'solved-item-delete';
        deleteBtn.setAttribute('data-index', i.toString());
        deleteBtn.title = 'Delete problem';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        actionsDiv.appendChild(deleteBtn);
        
        itemDiv.appendChild(detailsDiv);
        itemDiv.appendChild(actionsDiv);
        solvedListElement.appendChild(itemDiv);
      }

      if (!matchFound) {
        const div = document.createElement('div');
        div.className = 'dropdown-info-item';
        div.style.color = 'var(--text-secondary)';
        div.style.textAlign = 'center';
        div.style.marginTop = '40px';
        div.textContent = `No matches found for "${filterText}"`;
        solvedListElement.appendChild(div);
      }
    };

    openHistoryBtn.addEventListener('click', () => {
      solvedListContainer.classList.remove('hidden');
      renderHistoryList();
    });

    closeSolvedListBtn.addEventListener('click', () => {
      solvedListContainer.classList.add('hidden');
      solvedListSearch.value = '';
    });

    solvedListSearch.addEventListener('input', () => {
      renderHistoryList(solvedListSearch.value);
    });

    solvedListElement.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.solved-item-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const index = parseInt(deleteBtn.getAttribute('data-index'));
        if (confirm('Are you sure you want to remove this problem from history? This will also decrement your local solve counts.')) {
          await deleteProblem(index);
        }
      }
    });

    const deleteProblem = async (index) => {
      const { stats, solvedList } = await getFirestoreData();
      const list = solvedList || [];
      const s = stats || { total: 0, easy: 0, medium: 0, hard: 0 };
      
      if (index >= 0 && index < list.length) {
        const item = list[index];
        const rawName = typeof item === 'string' ? item : item.name;
        const difficulty = typeof item === 'string' ? 'Medium' : (item.difficulty || 'Medium');
        
        list.splice(index, 1);
        
        s.total = Math.max(0, s.total - 1);
        const d = difficulty.toLowerCase();
        if (d.includes('easy') || d.includes('basic')) {
          s.easy = Math.max(0, s.easy - 1);
        } else if (d.includes('medium')) {
          s.medium = Math.max(0, s.medium - 1);
        } else if (d.includes('hard')) {
          s.hard = Math.max(0, s.hard - 1);
        } else {
          s.easy = Math.max(0, s.easy - 1);
        }
        
        await setFirestoreData(s, list);
        
        // Notify background script to synchronously remove the row from README.md on GitHub!
        chrome.runtime.sendMessage({ action: 'deleteSolution', payload: { problemName: rawName } });

        // Refresh dashboard UI
        document.getElementById('stat-total').innerText = s.total;
        document.getElementById('stat-easy').innerText = s.easy;
        document.getElementById('stat-medium').innerText = s.medium;
        document.getElementById('stat-hard').innerText = s.hard;
        
        renderHistoryList(solvedListSearch.value);
      }
    };

    dedupBtn.addEventListener('click', async () => {
      if (confirm('This will automatically merge duplicates, clean up "Submission #..." titles, and adjust your solve counts to be accurate. Proceed?')) {
        await deduplicateSolvedList();
        alert('History and stats deduplicated successfully! Syncing with GitHub README... ✨');
      }
    });

    const deduplicateSolvedList = async () => {
      const { stats, solvedList } = await getFirestoreData();
      const list = solvedList || [];
      
      const cleanedList = [];
      const seenProblems = new Set();
      
      let easyCount = 0;
      let mediumCount = 0;
      let hardCount = 0;
      
      for (const item of list) {
        let rawName = typeof item === 'string' ? item : item.name;
        let difficulty = typeof item === 'string' ? 'Medium' : (item.difficulty || 'Medium');
        let platform = typeof item === 'string' ? 'LeetCode' : (item.platform || 'LeetCode');
        
        // Strip out submission identifiers like "Submission #12345" or "Submission _12345"
        let cleanName = rawName.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim();
        
        if (!seenProblems.has(cleanName)) {
          seenProblems.add(cleanName);
          cleanedList.push({ name: cleanName, difficulty, platform });
          
          const d = difficulty.toLowerCase();
          if (d.includes('easy') || d.includes('basic')) easyCount++;
          else if (d.includes('medium')) mediumCount++;
          else if (d.includes('hard')) hardCount++;
          else easyCount++;
        }
      }
      
      const newStats = {
        total: cleanedList.length,
        easy: easyCount,
        medium: mediumCount,
        hard: hardCount
      };
      
      await setFirestoreData(newStats, cleanedList);
      
      // Notify background script to synchronously deduplicate the README.md on GitHub!
      chrome.runtime.sendMessage({ action: 'deduplicateReadme' });
      
      // Update UI dashboard
      document.getElementById('stat-total').innerText = newStats.total;
      document.getElementById('stat-easy').innerText = newStats.easy;
      document.getElementById('stat-medium').innerText = newStats.medium;
      document.getElementById('stat-hard').innerText = newStats.hard;
      
      renderHistoryList(solvedListSearch.value);
    };

    document.getElementById('open-website').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://algosync-a537d.web.app' });
    });

    document.getElementById('clear-stats').addEventListener('click', async () => {
      if (confirm('Clear history?')) {
        await setFirestoreData({ total: 0, easy: 0, medium: 0, hard: 0 }, []);
        checkState();
      }
    });
  };

  // Safe DOMContentLoaded checker to completely eliminate Chrome Extensions race condition
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
