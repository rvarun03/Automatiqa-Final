/**
 * Background script for QA Recorder extension
 */

let socket = null;
let isRecording = false;
let currentSessionId = null;
let backendUrl = "ws://localhost:3000/recorder";

// Load persisted state
chrome.storage.local.get(['backendUrl', 'isRecording', 'currentSessionId'], (result) => {
  if (result.backendUrl) backendUrl = result.backendUrl;
  if (result.isRecording) isRecording = result.isRecording;
  if (result.currentSessionId) currentSessionId = result.currentSessionId;
  console.log(`Initialized with Backend: ${backendUrl}, Recording: ${isRecording}`);
  connectSocket();
});

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`Connecting to recorder backend at ${backendUrl}...`);
  try {
    socket = new WebSocket(backendUrl);
  } catch (e) {
    console.error("Failed to create WebSocket:", e);
    setTimeout(connectSocket, 5000);
    return;
  }

  socket.onopen = () => {
    console.log("Connected to recorder backend");
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[Extension Background] Message from backend:", data.type, data);
      
      if (data.type === 'START_RECORDING') {
        isRecording = true;
        currentSessionId = data.sessionId;
        chrome.storage.local.set({ isRecording: true, currentSessionId: data.sessionId }, () => {
           console.log(`[Extension Background] Recording started: ${currentSessionId}`);
        });
      } else if (data.type === 'STOP_RECORDING') {
        isRecording = false;
        currentSessionId = null;
        chrome.storage.local.set({ isRecording: false, currentSessionId: null }, () => {
           console.log(`[Extension Background] Recording stopped`);
        });
      }
    } catch (e) {
      console.error("[Extension Background] Error parsing message:", e);
    }
  };

  socket.onclose = () => {
    console.log("Disconnected from recorder backend. Retrying in 5s...");
    socket = null;
    setTimeout(connectSocket, 5000);
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

// Initialize connection
connectSocket();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_BACKEND_URL') {
    const newUrl = message.url.replace('http', 'ws') + '/recorder';
    if (backendUrl !== newUrl) {
      console.log(`Updating backend URL to ${newUrl}`);
      backendUrl = newUrl;
      chrome.storage.local.set({ backendUrl: newUrl });
      if (socket) {
        socket.close();
      }
      connectSocket();
    }
  } else if (message.type === 'STEP') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Add tab info if available
      const payload = {
        ...message.payload,
        sessionId: currentSessionId,
        tabId: sender.tab?.id,
        tabTitle: sender.tab?.title
      };
      socket.send(JSON.stringify({ type: 'STEP', payload }));
    }
  }
});

// Handle tab updates (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isRecording && changeInfo.url) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'STEP',
        payload: {
          action: 'navigate',
          url: changeInfo.url,
          sessionId: currentSessionId,
          tabId: tabId,
          tabTitle: tab.title,
          timestamp: Date.now()
        }
      }));
    }
  }
});

// Keep alive for service worker
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    connectSocket();
  }
});
