// Helper functions to read and write to local storage instead of Firestore
async function getFirestoreData() {
  try {
    const data = await chrome.storage.local.get(['stats', 'solvedList']);
    return { 
      stats: data.stats || null, 
      solvedList: data.solvedList || [] 
    };
  } catch (err) {
    console.error("Storage Read Error:", err);
    return { stats: null, solvedList: [] };
  }
}

async function setFirestoreData(stats, solvedList) {
  try {
    await chrome.storage.local.set({ stats, solvedList });
  } catch (err) {
    console.error("Storage Write Error:", err);
  }
}

