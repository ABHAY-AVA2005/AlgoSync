document.addEventListener('DOMContentLoaded', async () => {
  const authView = document.getElementById('auth-view');
  const dashboardView = document.getElementById('dashboard-view');
  const btnLogin = document.getElementById('btn-login');
  const btnUnlink = document.getElementById('btn-unlink');
  const authStatus = document.getElementById('auth-status');
  const repoSelect = document.getElementById('repo-select');

  // Check initial state
  const data = await chrome.storage.sync.get(['accessToken', 'selectedRepo', 'repos']);
  
  if (data.accessToken) {
    showDashboard(data);
  } else {
    showLogin();
  }

  btnLogin.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'login' }, (response) => {
      if (response.success) {
        // State will be updated by background script and we can refresh
        window.location.reload();
      }
    });
  });

  btnUnlink.addEventListener('click', async () => {
    await chrome.storage.sync.remove(['accessToken', 'selectedRepo', 'repos']);
    showLogin();
  });

  repoSelect.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ selectedRepo: e.target.value });
  });

  function showDashboard(data) {
    authView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    authStatus.querySelector('.dot').className = 'dot green';
    authStatus.querySelector('.status-text').textContent = 'Connected';

    // Update Stats
    const stats = data.stats || { total: 0, today: 0, easy: 0, medium: 0, hard: 0 };
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-easy').textContent = stats.easy;
    document.getElementById('stat-medium').textContent = stats.medium;
    document.getElementById('stat-hard').textContent = stats.hard;

    // Populate repos if available
    if (data.repos) {
      repoSelect.innerHTML = '<option value="" disabled>Select a repository</option>';
      data.repos.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.full_name;
        option.textContent = repo.name;
        if (data.selectedRepo === repo.full_name) option.selected = true;
        repoSelect.appendChild(option);
      });
    }
  }

  function showLogin() {
    authView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    authStatus.querySelector('.dot').className = 'dot red';
    authStatus.querySelector('.status-text').textContent = 'Disconnected';
  }
});
