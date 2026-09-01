import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Handle global cross-origin script errors gracefully
if (typeof window !== 'undefined') {
  window.onerror = function (message, source, lineno, colno, error) {
    const msgStr = String(message || '');
    if (msgStr.toLowerCase().includes('script error') || !message) {
      console.warn('Cross-origin script error suppressed:', message);
      return true;
    }
    return false;
  };

  window.addEventListener('error', (event) => {
    const msg = String(event.message || (event.error && event.error.message) || '');
    const isScriptError = msg.toLowerCase().includes('script error') || !msg;
    const isResourceError = Boolean(event.target && event.target !== window);

    if (isScriptError || isResourceError) {
      console.warn('Censored cross-origin or resource script error:', event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = String(event.reason?.message || event.reason || '');
    if (reasonMsg.toLowerCase().includes('script error') || !reasonMsg || reasonMsg === '[object Object]') {
      console.warn('Unhandled rejection script error:', event.reason);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);