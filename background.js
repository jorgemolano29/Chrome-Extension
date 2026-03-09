// VisasPro DS-160 — Background Service Worker
// Maneja comunicación entre popup y content script

chrome.runtime.onInstalled.addListener(() => {
  console.log('[VisasPro] Extensión instalada correctamente.');
});

// Relay de mensajes si es necesario
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[VisasPro Background] Mensaje recibido:', message.action);
  return false;
});
