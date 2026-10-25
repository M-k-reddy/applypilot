// ApplyPilot service worker. Opens the side panel when the toolbar icon is clicked.
// No always-on content scripts: page scripts are injected on demand by the side panel (activeTab + scripting).
const enablePanel = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

// Forget per-tab application state when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove(`tab:${tabId}`).catch(() => {}); });
