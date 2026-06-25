// VisasPro DS-160 — Background Service Worker
// Maneja la apertura del side panel y comunicación entre componentes

chrome.runtime.onInstalled.addListener(() => {
  console.log('[VisasPro] Extensión instalada correctamente.');
  // Configurar el side panel para que se abra al hacer clic en el ícono
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.error('[VisasPro] Error configurando side panel:', err));
});

// Relay de mensajes si es necesario
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[VisasPro Background] Mensaje recibido:', message.action);
  return false;
});
