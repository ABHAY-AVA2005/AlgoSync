const GITHUB_CLIENT_ID = 'Ov23lien2nepUiHUGdRA';
const GITHUB_CLIENT_SECRET = '2c59fb5edd693c54037bf64d370b299d6e7db6cf'; // Ideally use a proxy, but for local testing...

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    handleLogin(sendResponse);
    return true;
  }
  if (request.action === 'pushSolution') {
    handlePush(request.payload, sendResponse);
    return true;
  }
});

async function handleLogin(sendResponse) {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;

  try {
    const redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');

    // Exchange code for token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code
      })
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.access_token) {
      await chrome.storage.sync.set({ accessToken: tokenData.access_token });

      // Fetch user repos
      const repos = await fetchRepos(tokenData.access_token);
      await chrome.storage.sync.set({ repos: repos });

      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Token exchange failed' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function fetchRepos(token) {
  const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
    headers: { 'Authorization': `token ${token}` }
  });
  return await response.json();
}

async function handlePush(payload, sendResponse) {
  const { accessToken, selectedRepo } = await chrome.storage.sync.get(['accessToken', 'selectedRepo']);
  if (!accessToken || !selectedRepo) {
    sendResponse({ success: false, error: 'Not configured' });
    return;
  }

  try {
    const { platform, difficulty, problemName, code, extension, testCases, description } = payload;
    const folderPath = `${platform}/${difficulty}/${problemName}`;

    // 1. Handle Versioning for Code File
    let fileName = `solution.${extension}`;
    let existingFiles = await getFolderContents(selectedRepo, folderPath, accessToken);

    let version = 1;
    let baseFileName = `solution`;
    while (existingFiles.some(f => f.name === (version === 1 ? `${baseFileName}.${extension}` : `${baseFileName}_V${version}.${extension}`))) {
      version++;
    }
    if (version > 1) fileName = `${baseFileName}_V${version}.${extension}`;

    // 2. Push README.md (Always update with latest info/test cases)
    const readmeContent = `# ${problemName}\n\n## Difficulty: ${difficulty}\n\n## Description\n${description}\n\n## Test Cases\n\`\`\`\n${testCases}\n\`\`\``;
    await pushToGitHub(selectedRepo, `${folderPath}/README.md`, readmeContent, accessToken);

    // 3. Push Solution File
    await pushToGitHub(selectedRepo, `${folderPath}/${fileName}`, code, accessToken);

    // 4. Update Master README (The "Beat All" Feature)
    await updateMasterReadme(selectedRepo, { platform, difficulty, problemName, folderPath, fileName }, accessToken);

    // 5. Update Stats
    await updateStats(difficulty);

    sendResponse({ success: true, fileName: fileName });
  } catch (error) {
    console.error('Push error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function updateMasterReadme(repo, data, token) {
  const path = 'README.md';
  let content = '# 🚀 My Coding Journey (AlgoSync)\n\n| Platform | Problem | Difficulty | Solution | Date |\n| --- | --- | --- | --- | --- |\n';
  let sha;

  try {
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (existing.ok) {
      const fileData = await existing.json();
      sha = fileData.sha;
      content = atob(fileData.content.replace(/\n/g, ''));
    }
  } catch (e) { }

  const date = new Date().toLocaleDateString();
  const row = `| ${data.platform} | ${data.problemName} | ${data.difficulty} | [View](${data.folderPath}/${data.fileName}) | ${date} |\n`;

  if (!content.includes(data.problemName)) {
    content += row;
  }

  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update Master README for ${data.problemName}`,
      content: btoa(unescape(encodeURIComponent(content))),
      sha: sha
    })
  });
}

async function getFolderContents(repo, path, token) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (response.status === 404) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function updateStats(difficulty) {
  const data = await chrome.storage.sync.get(['stats']);
  const stats = data.stats || { total: 0, today: 0, lastDate: null, easy: 0, medium: 0, hard: 0 };
  const today = new Date().toLocaleDateString();

  if (stats.lastDate !== today) {
    stats.today = 0;
    stats.lastDate = today;
  }

  stats.total++;
  stats.today++;

  const diff = difficulty.toLowerCase();
  if (diff.includes('easy')) stats.easy++;
  else if (diff.includes('medium')) stats.medium++;
  else if (diff.includes('hard')) stats.hard++;

  await chrome.storage.sync.set({ stats });
}

async function pushToGitHub(repo, path, content, token) {
  // Check if file exists to get SHA (for updating README, though for solutions we usually create new versions)
  let sha;
  const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { 'Authorization': `token ${token}` }
  });
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Sync ${path} via AlgoSync`,
      content: btoa(unescape(encodeURIComponent(content))),
      sha: sha
    })
  });

  return await response.json();
}
