try {
  importScripts(
    'storage-helper.js',
    'firestore-helper.js'
  );
} catch (e) {
  console.error("Failed to load scripts:", e);
}

// Run migration on every startup — safe no-op if already migrated
AlgoStorage.migrate();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'pushSolution') { handlePush(request.payload, sendResponse); return true; }
  if (request.action === 'deleteSolution') { handleDeleteSolution(request.payload.problemName, sendResponse); return true; }
  if (request.action === 'deduplicateReadme') { handleDeduplicateReadme(sendResponse); return true; }
  if (request.action === 'fetchRepos') { 
    AlgoStorage.getUser().then(async ({ accessToken }) => {
        if (accessToken) {
            const repos = await fetchRepos(accessToken);
            if (repos && repos.error === 'Unauthorized') {
                await AlgoStorage.clearUser();
                chrome.runtime.sendMessage({ action: 'tokenExpired' }).catch(() => {});
            } else if (Array.isArray(repos)) {
                await AlgoStorage.setRepos(repos);
            }
        }
        sendResponse({ success: true });
    }).catch(e => {
        console.error("fetchRepos error in background:", e);
        sendResponse({ success: false });
    });
    return true; 
  }
});

async function fetchRepos(token) {
  try {
    const response = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=100&t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    if (!response.ok) {
      if (response.status === 401) {
        return { error: 'Unauthorized', status: 401 };
      }
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("fetchRepos error", e);
    return [];
  }
}

// Listen for external messages from the Firebase Hosted login webpage
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'login_success' && message.token) {
    AlgoStorage.setToken(message.token).then(() => {
      // Fetch repos to update the UI immediately
      chrome.runtime.sendMessage({ action: 'fetchRepos' });
      sendResponse({ success: true });
    });
    return true;
  }
});

// SMARTER NORMALIZATION: Ignores line endings and trailing whitespace, but keeps internal formatting
function normalizeCode(c) {
  return c.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();
}

async function handlePush(payload, sendResponse) {
  const { accessToken, selectedRepo } = await AlgoStorage.getUser();
  if (!accessToken || !selectedRepo) { sendResponse({ success: false, error: 'GitHub not connected!' }); return; }

  try {
    const { platform, difficulty, problemName, code, extension, testCases, description, companyTags, topicTags } = payload;
    const platformTag = platform === 'GeeksforGeeks' ? 'GFG' : (platform === 'LeetCode' ? 'LeetCode' : 'HR');
    const folderName = `[${platformTag}] ${problemName.replace(/[^a-z0-9 ]/gi, '_').trim()}`;
    const folderPath = `${folderName}`;

    // 1. CACHE-BUSTED FOLDER CHECK
    const existingFiles = await getFolderContents(selectedRepo, folderPath, accessToken);
    let isDuplicate = false;
    const normalizedNewCode = normalizeCode(code);

    for (const file of existingFiles) {
        if (file.name.includes('solution')) {
            const fileContent = await getFileContent(selectedRepo, file.path, accessToken);
            if (normalizeCode(fileContent) === normalizedNewCode) {
                isDuplicate = true;
                break;
            }
        }
    }

    if (isDuplicate) {
        sendResponse({ success: true, message: 'Duplicate code skipped' });
        return;
    }

    // 2. RELIABLE VERSIONING
    let version = 1;
    const baseCodeName = `solution.${extension}`;
    // Check for both the base name and versioned names
    while (existingFiles.some(f => f.name === (version === 1 ? baseCodeName : `solution_V${version}.${extension}`))) {
        version++;
    }
    
    const finalFileName = version === 1 ? baseCodeName : `solution_V${version}.${extension}`;
    const finalCodePath = `${folderPath}/${finalFileName}`;
    const readmePath = `${folderPath}/README.md`;

    const readmeContent = `# ${problemName}\n\n### Difficulty: ${difficulty || 'Medium'}\n\n## Description\n\n${description}\n\n---\n**Company Tags**: ${companyTags}\n**Topic Tags**: ${topicTags}\n\n## Test Cases\n\n\`\`\`\n${testCases}\n\`\`\``;
    
    // 3. PUSHING
    await pushToGitHub(selectedRepo, readmePath, readmeContent, accessToken);
    const r2 = await pushToGitHub(selectedRepo, finalCodePath, code, accessToken);
    if (r2.error) throw new Error(r2.error);

    await updateUniqueStats(problemName, difficulty, platform);
    await updateMasterReadme(selectedRepo, { platform, difficulty, problemName, folderPath, fileName: finalFileName }, accessToken);

    sendResponse({ success: true });
  } catch (error) { 
    if (error.message === 'RATE_LIMIT_EXCEEDED') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon48.png',
        title: 'AlgoSync Rate Limit',
        message: 'You have synced too fast! GitHub is rate-limiting you. Please wait 5 minutes before trying again.'
      });
      sendResponse({ success: false, error: 'Rate limit exceeded. Please wait 5 minutes.' });
    } else {
      sendResponse({ success: false, error: error.message }); 
    }
  }
}

async function getFileContent(repo, path, token) {
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
        if (response.status === 403 || response.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
        const data = await response.json();
        const binString = atob(data.content.replace(/\n/g, ''));
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) { bytes[i] = binString.charCodeAt(i); }
        return new TextDecoder().decode(bytes);
    } catch (e) { 
        if (e.message === 'RATE_LIMIT_EXCEEDED') throw e;
        return ""; 
    }
}

async function updateUniqueStats(problemName, difficulty, platform) {
    const { stats, solvedList } = await getFirestoreData();
    const currentStats = stats || { total: 0, easy: 0, medium: 0, hard: 0 };
    const currentList = solvedList || [];
    
    const exists = currentList.some(item => {
        if (typeof item === 'string') return item === problemName;
        return item && item.name === problemName;
    });

    if (!exists) {
        currentList.push({
            name: problemName,
            difficulty: difficulty || 'Medium',
            platform: platform || 'LeetCode',
            date: new Date().toLocaleDateString()
        });
        currentStats.total++;
        const d = (difficulty || 'Medium').toLowerCase();
        if (d.includes('easy') || d.includes('basic')) currentStats.easy++;
        else if (d.includes('medium')) currentStats.medium++;
        else if (d.includes('hard')) currentStats.hard++;
        else currentStats.easy++;
        await setFirestoreData(currentStats, currentList);
    }
}

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
}

async function pushToGitHub(repo, path, content, token) {
  try {
    const bytes = new TextEncoder().encode(content);
    const base64Content = bufferToBase64(bytes);
    let sha;
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    if (existing.status === 403 || existing.status === 429) return { error: 'RATE_LIMIT_EXCEEDED' };
    if (existing.ok) { sha = (await existing.json()).sha; }
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Sync via AlgoSync`, content: base64Content, sha: sha })
    });
    if (response.status === 403 || response.status === 429) return { error: 'RATE_LIMIT_EXCEEDED' };
    const resData = await response.json();
    return response.ok ? resData : { error: resData.message || 'API Error' };
  } catch (e) { return { error: e.message }; }
}

async function updateMasterReadme(repo, data, token) {
  const path = 'README.md';
  let content = '';
  let sha;
  try {
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    if (existing.ok) {
      const fileData = await existing.json(); sha = fileData.sha;
      const binString = atob(fileData.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) { bytes[i] = binString.charCodeAt(i); }
      content = new TextDecoder().decode(bytes);
    }
  } catch (e) {}

  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (content.includes(data.problemName)) {
    return; // Prevent duplicates
  }

  const lines = content.split('\n');
  let rawRows = [];
  let titleSection = [];
  let currentSection = 'title';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('Coding Statistics')) {
      currentSection = 'stats';
      continue;
    }
    if (line.includes('My Coding Progress')) {
      currentSection = 'progress';
      continue;
    }

    if (currentSection === 'title') {
      if (line.length > 0 && !line.startsWith('|')) {
        titleSection.push(line);
      }
    } else if (currentSection === 'progress') {
      if (line.startsWith('|')) {
        const isHeader = line.toLowerCase().includes('platform') || line.includes('---');
        if (!isHeader) {
          rawRows.push(line);
        }
      }
    }
  }

  let parsedRows = [];
  for (const row of rawRows) {
    const cols = parseMarkdownTableRow(row);
    if (cols.length < 5) continue;
    
    const firstColIsNum = /^\d+$/.test(cols[0]);
    let platform, problem, difficulty, solution, date;
    if (firstColIsNum) {
      platform = cols[1];
      problem = cols[2];
      difficulty = cols[3];
      solution = cols[4];
      date = cols[5] || new Date().toLocaleDateString();
    } else {
      platform = cols[0];
      problem = cols[1];
      difficulty = cols[2];
      solution = cols[3];
      date = cols[4] || new Date().toLocaleDateString();
    }
    parsedRows.push({ platform, problem, difficulty, solution, date });
  }

  const dateStr = new Date().toLocaleDateString();
  parsedRows.push({
    platform: data.platform,
    problem: data.problemName,
    difficulty: data.difficulty || 'Medium',
    solution: `[View Code](${data.folderPath}/${data.fileName})`,
    date: dateStr
  });

  const { formattedTable, counts, totalSolved } = rebuildReadmeProgressTable(parsedRows);

  let titleStr = titleSection.join('\n\n');
  if (!titleStr) titleStr = '# 🏆 JAVA-DSA-A2Z: The Ultimate DSA Portfolio';

  const statsSection = `## 📊 Coding Statistics

| Platform | Problems Solved | Badge |
| --- | --- | --- |
| LeetCode | ${counts.LeetCode} | ![LeetCode](https://img.shields.io/badge/LeetCode-${counts.LeetCode}-FFA116?style=flat-square&logo=leetcode&logoColor=white) |
| GeeksforGeeks | ${counts.GeeksforGeeks} | ![GeeksforGeeks](https://img.shields.io/badge/GeeksforGeeks-${counts.GeeksforGeeks}-298D46?style=flat-square&logo=geeksforgeeks&logoColor=white) |
| HackerRank | ${counts.HackerRank} | ![HackerRank](https://img.shields.io/badge/HackerRank-${counts.HackerRank}-058a5f?style=flat-square&logo=hackerrank&logoColor=white) |
| **Total** | **${totalSolved}** | ![Total](https://img.shields.io/badge/Total-${totalSolved}-007ACC?style=flat-square) |`;
  
  const finalContent = `${titleStr}\n\n${statsSection}\n\n## 📊 My Coding Progress\n\n| # | Platform | Problem | Difficulty | Solution | Date |\n| --- | --- | --- | --- | --- | --- |\n${formattedTable}\n`;
  const bytes = new TextEncoder().encode(finalContent);
  const base64Content = bufferToBase64(bytes);

  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Sync via AlgoSync`, content: base64Content, sha: sha })
  });
}

function parseMarkdownTableRow(row) {
  const cells = row.split('|').map(c => c.trim());
  if (cells.length > 0 && cells[0] === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

function rebuildReadmeProgressTable(rows) {
  const getOrderIndex = (platform) => {
    const p = platform.toLowerCase().trim();
    if (p.includes('leetcode') || p === 'lc') return 0;
    if (p.includes('geeksforgeeks') || p === 'gfg') return 1;
    if (p.includes('hackerrank') || p === 'hr') return 2;
    return 3;
  };

  rows.sort((a, b) => {
    const idxA = getOrderIndex(a.platform);
    const idxB = getOrderIndex(b.platform);
    if (idxA !== idxB) return idxA - idxB;
    return a.problem.localeCompare(b.problem);
  });

  let counts = { LeetCode: 0, GeeksforGeeks: 0, HackerRank: 0 };
  let formattedLines = [];
  let indexCounter = 1;

  for (const r of rows) {
    const plat = r.platform;
    const lowerP = plat.toLowerCase().trim();
    
    let canonicalPlat = 'LeetCode';
    if (lowerP.includes('leetcode') || lowerP === 'lc') {
      canonicalPlat = 'LeetCode';
      counts.LeetCode++;
    } else if (lowerP.includes('geeksforgeeks') || lowerP === 'gfg') {
      canonicalPlat = 'GeeksforGeeks';
      counts.GeeksforGeeks++;
    } else if (lowerP.includes('hackerrank') || lowerP === 'hr') {
      canonicalPlat = 'HackerRank';
      counts.HackerRank++;
    } else {
      canonicalPlat = plat;
    }

    formattedLines.push(`| ${indexCounter} | ${canonicalPlat} | ${r.problem} | ${r.difficulty} | ${r.solution} | ${r.date} |`);
    indexCounter++;
  }

  return {
    formattedTable: formattedLines.join('\n'),
    counts,
    totalSolved: rows.length
  };
}

async function getFolderContents(repo, path, token) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    return response.status === 404 ? [] : await response.json();
  } catch { return []; }
}

async function handleDeleteSolution(problemName, sendResponse) {
  const { accessToken, selectedRepo } = await AlgoStorage.getUser();
  if (!accessToken || !selectedRepo) { 
    if (sendResponse) sendResponse({ success: false, error: 'GitHub not connected' }); 
    return; 
  }
  try {
    await removeProblemFromReadme(selectedRepo, problemName, accessToken);
    if (sendResponse) sendResponse({ success: true });
  } catch (error) {
    if (sendResponse) sendResponse({ success: false, error: error.message });
  }
}

async function handleDeduplicateReadme(sendResponse) {
  const { accessToken, selectedRepo } = await AlgoStorage.getUser();
  if (!accessToken || !selectedRepo) { 
    if (sendResponse) sendResponse({ success: false, error: 'GitHub not connected' }); 
    return; 
  }
  try {
    await deduplicateMasterReadme(selectedRepo, accessToken);
    if (sendResponse) sendResponse({ success: true });
  } catch (error) {
    if (sendResponse) sendResponse({ success: false, error: error.message });
  }
}

async function removeProblemFromReadme(repo, problemName, token) {
  const path = 'README.md';
  let content = '';
  let sha;
  
  try {
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    if (!existing.ok) return;
    const fileData = await existing.json();
    sha = fileData.sha;
    const binString = atob(fileData.content.replace(/\n/g, ''));
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) { bytes[i] = binString.charCodeAt(i); }
    content = new TextDecoder().decode(bytes);
  } catch (e) {
    return;
  }

  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = content.split('\n');
  
  let rawRows = [];
  let titleSection = [];
  let currentSection = 'title';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('Coding Statistics')) {
      currentSection = 'stats';
      continue;
    }
    if (line.includes('My Coding Progress')) {
      currentSection = 'progress';
      continue;
    }

    if (currentSection === 'title') {
      if (line.length > 0 && !line.startsWith('|')) {
        titleSection.push(line);
      }
    } else if (currentSection === 'progress') {
      if (line.startsWith('|')) {
        const isHeader = line.toLowerCase().includes('platform') || line.includes('---');
        if (!isHeader) {
          rawRows.push(line);
        }
      }
    }
  }

  let parsedRows = [];
  for (const row of rawRows) {
    const cols = parseMarkdownTableRow(row);
    if (cols.length < 5) continue;
    
    const firstColIsNum = /^\d+$/.test(cols[0]);
    let platform, problem, difficulty, solution, date;
    if (firstColIsNum) {
      platform = cols[1];
      problem = cols[2];
      difficulty = cols[3];
      solution = cols[4];
      date = cols[5] || new Date().toLocaleDateString();
    } else {
      platform = cols[0];
      problem = cols[1];
      difficulty = cols[2];
      solution = cols[3];
      date = cols[4] || new Date().toLocaleDateString();
    }

    const cleanReadmeProblem = problem.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const cleanTargetProblem = problemName.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim();

    if (cleanReadmeProblem === cleanTargetProblem || problem === problemName || cleanReadmeProblem === problemName) {
      continue;
    }

    parsedRows.push({ platform, problem, difficulty, solution, date });
  }

  const { formattedTable, counts, totalSolved } = rebuildReadmeProgressTable(parsedRows);

  let titleStr = titleSection.join('\n\n');
  if (!titleStr) titleStr = '# 🏆 JAVA-DSA-A2Z: The Ultimate DSA Portfolio';

  const statsSection = `## 📊 Coding Statistics

| Platform | Problems Solved | Badge |
| --- | --- | --- |
| LeetCode | ${counts.LeetCode} | ![LeetCode](https://img.shields.io/badge/LeetCode-${counts.LeetCode}-FFA116?style=flat-square&logo=leetcode&logoColor=white) |
| GeeksforGeeks | ${counts.GeeksforGeeks} | ![GeeksforGeeks](https://img.shields.io/badge/GeeksforGeeks-${counts.GeeksforGeeks}-298D46?style=flat-square&logo=geeksforgeeks&logoColor=white) |
| HackerRank | ${counts.HackerRank} | ![HackerRank](https://img.shields.io/badge/HackerRank-${counts.HackerRank}-058a5f?style=flat-square&logo=hackerrank&logoColor=white) |
| **Total** | **${totalSolved}** | ![Total](https://img.shields.io/badge/Total-${totalSolved}-007ACC?style=flat-square) |`;
  
  const finalContent = `${titleStr}\n\n${statsSection}\n\n## 📊 My Coding Progress\n\n| # | Platform | Problem | Difficulty | Solution | Date |\n| --- | --- | --- | --- | --- | --- |\n${formattedTable}\n`;
  const bytes = new TextEncoder().encode(finalContent);
  const base64Content = bufferToBase64(bytes);
  
  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete problem via AlgoSync`, content: base64Content, sha: sha })
  });
}

async function deduplicateMasterReadme(repo, token) {
  const path = 'README.md';
  let content = '';
  let sha;
  
  try {
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: { 'Authorization': `token ${token}` } });
    if (!existing.ok) return;
    const fileData = await existing.json();
    sha = fileData.sha;
    const binString = atob(fileData.content.replace(/\n/g, ''));
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) { bytes[i] = binString.charCodeAt(i); }
    content = new TextDecoder().decode(bytes);
  } catch (e) {
    return;
  }

  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = content.split('\n');
  
  let rawRows = [];
  let titleSection = [];
  let currentSection = 'title';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('Coding Statistics')) {
      currentSection = 'stats';
      continue;
    }
    if (line.includes('My Coding Progress')) {
      currentSection = 'progress';
      continue;
    }

    if (currentSection === 'title') {
      if (line.length > 0 && !line.startsWith('|')) {
        titleSection.push(line);
      }
    } else if (currentSection === 'progress') {
      if (line.startsWith('|')) {
        const isHeader = line.toLowerCase().includes('platform') || line.includes('---');
        if (!isHeader) {
          rawRows.push(line);
        }
      }
    }
  }

  let parsedRows = [];
  let seenProblems = new Set();

  for (const row of rawRows) {
    const cols = parseMarkdownTableRow(row);
    if (cols.length < 5) continue;
    
    const firstColIsNum = /^\d+$/.test(cols[0]);
    let platform, problem, difficulty, solution, date;
    if (firstColIsNum) {
      platform = cols[1];
      problem = cols[2];
      difficulty = cols[3];
      solution = cols[4];
      date = cols[5] || new Date().toLocaleDateString();
    } else {
      platform = cols[0];
      problem = cols[1];
      difficulty = cols[2];
      solution = cols[3];
      date = cols[4] || new Date().toLocaleDateString();
    }

    const cleanReadmeProblem = problem.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const cleanName = cleanReadmeProblem.replace(/\s*Submission\s*[#_]\s*\d+/gi, '').trim();

    if (!seenProblems.has(cleanName)) {
      seenProblems.add(cleanName);
      
      let updatedProblem = problem;
      if (problem.includes('[') && problem.includes(']')) {
        updatedProblem = problem.replace(/\[([^\]]+)\]/g, `[${cleanName}]`);
      } else {
        updatedProblem = cleanName;
      }

      parsedRows.push({ platform, problem: updatedProblem, difficulty, solution, date });
    }
  }

  const { formattedTable, counts, totalSolved } = rebuildReadmeProgressTable(parsedRows);

  let titleStr = titleSection.join('\n\n');
  if (!titleStr) titleStr = '# 🏆 JAVA-DSA-A2Z: The Ultimate DSA Portfolio';

  const statsSection = `## 📊 Coding Statistics

| Platform | Problems Solved | Badge |
| --- | --- | --- |
| LeetCode | ${counts.LeetCode} | ![LeetCode](https://img.shields.io/badge/LeetCode-${counts.LeetCode}-FFA116?style=flat-square&logo=leetcode&logoColor=white) |
| GeeksforGeeks | ${counts.GeeksforGeeks} | ![GeeksforGeeks](https://img.shields.io/badge/GeeksforGeeks-${counts.GeeksforGeeks}-298D46?style=flat-square&logo=geeksforgeeks&logoColor=white) |
| HackerRank | ${counts.HackerRank} | ![HackerRank](https://img.shields.io/badge/HackerRank-${counts.HackerRank}-058a5f?style=flat-square&logo=hackerrank&logoColor=white) |
| **Total** | **${totalSolved}** | ![Total](https://img.shields.io/badge/Total-${totalSolved}-007ACC?style=flat-square) |`;
  
  const finalContent = `${titleStr}\n\n${statsSection}\n\n## 📊 My Coding Progress\n\n| # | Platform | Problem | Difficulty | Solution | Date |\n| --- | --- | --- | --- | --- | --- |\n${formattedTable}\n`;
  const bytes = new TextEncoder().encode(finalContent);
  const base64Content = bufferToBase64(bytes);
  
  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Deduplicate README via AlgoSync`, content: base64Content, sha: sha })
  });
}
