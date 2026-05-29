/**
 * AlgoSync Storage Helper (v2)
 *
 * All user data is stored in two clean top-level objects:
 *
 *  chrome.storage.local  →  { user: { accessToken, selectedRepo, repos } }
 *  chrome.storage.sync   →  { settings: { theme } }
 *
 * Use the AlgoStorage API below instead of calling chrome.storage directly.
 * This keeps the data readable when inspecting via Chrome DevTools.
 */

const AlgoStorage = {

  // ─── USER DATA (local — never syncs to Google servers) ──────────────────

  /**
   * Returns the full user object: { accessToken, selectedRepo, repos }
   */
  async getUser() {
    const { user } = await chrome.storage.local.get('user');
    return user || {};
  },

  /**
   * Saves the GitHub OAuth access token.
   */
  async setToken(accessToken) {
    const user = await this.getUser();
    await chrome.storage.local.set({ user: { ...user, accessToken } });
  },

  /**
   * Saves the selected GitHub repository (e.g. "abhay/DSA-Solutions").
   */
  async setRepo(selectedRepo) {
    const user = await this.getUser();
    await chrome.storage.local.set({ user: { ...user, selectedRepo } });
  },

  /**
   * Saves the full list of the user's GitHub repositories.
   */
  async setRepos(repos) {
    const user = await this.getUser();
    await chrome.storage.local.set({ user: { ...user, repos } });
  },

  /**
   * Clears all user data (called on logout).
   */
  async clearUser() {
    await chrome.storage.local.remove('user');
  },

  // ─── SETTINGS (sync — preferences follow user across devices) ───────────

  /**
   * Returns the settings object: { theme }
   */
  async getSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    return settings || { theme: 'dark' };
  },

  /**
   * Saves the UI theme preference ('dark' | 'light').
   */
  async setTheme(theme) {
    const settings = await this.getSettings();
    await chrome.storage.sync.set({ settings: { ...settings, theme } });
  },

  // ─── MIGRATION: flat keys → nested objects ───────────────────────────────

  /**
   * One-time migration from the old flat storage structure to v2 nested structure.
   * Safe to call on every startup — it is a no-op if migration already happened.
   *
   * Old structure:
   *   storage.local: { accessToken, selectedRepo, repos }
   *   storage.sync:  { theme, accessToken, selectedRepo }
   *
   * New structure:
   *   storage.local: { user: { accessToken, selectedRepo, repos } }
   *   storage.sync:  { settings: { theme } }
   */
  async migrate() {
    const local = await chrome.storage.local.get(['accessToken', 'selectedRepo', 'repos']);
    const sync  = await chrome.storage.sync.get(['accessToken', 'selectedRepo', 'theme']);

    const hasOldData = local.accessToken || local.selectedRepo || local.repos
                    || sync.accessToken  || sync.selectedRepo;

    if (!hasOldData) return; // Already migrated — nothing to do.

    console.log('AlgoSync Storage: Migrating to v2 structure...');

    // Build the new user object from whichever store had the token
    const newUser = {
      accessToken:  local.accessToken  || sync.accessToken  || undefined,
      selectedRepo: local.selectedRepo || sync.selectedRepo || undefined,
      repos:        local.repos        || undefined,
    };
    // Remove undefined keys for a clean object
    Object.keys(newUser).forEach(k => newUser[k] === undefined && delete newUser[k]);

    // Build new settings object
    const newSettings = { theme: sync.theme || 'dark' };

    // Write new structure
    await chrome.storage.local.set({ user: newUser });
    await chrome.storage.sync.set({ settings: newSettings });

    // Remove old flat keys
    await chrome.storage.local.remove(['accessToken', 'selectedRepo', 'repos']);
    await chrome.storage.sync.remove(['accessToken', 'selectedRepo', 'theme']);

    console.log('AlgoSync Storage: Migration to v2 complete.', { user: newUser, settings: newSettings });
  }
};
