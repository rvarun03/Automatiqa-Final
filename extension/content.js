/**
 * Content script for QA Recorder extension
 */

(function() {
  const targetDomain = 'foxquilt.com';
  const isTargetSite = window.location.hostname.includes(targetDomain);
  
  if (isTargetSite) {
    console.log(`[QA Recorder] Active on Foxquilt: ${window.location.href} (IsFrame: ${window !== window.top})`);
  } else {
    console.log("[QA Recorder] Content Script Loaded on:", window.location.href);
  }

  let isRecording = false;

  const updateRecordingState = (newState) => {
    if (isRecording !== newState) {
      isRecording = newState;
      console.log(`[QA Recorder] Recording State Update: ${isRecording} (${window.location.href})`);
      if (isRecording) {
        console.log("[QA Recorder] Listeners are now ACTIVE and capturing events.");
      } else {
        console.log("[QA Recorder] Listeners are now IDLE.");
      }
    }
  };

  // Send current origin to background script to help it connect to the right backend
  const isAutomatiQADashboard = document.title.includes('QAonCloud') || 
                                document.title.includes('AutomatiQA') || 
                                !!document.querySelector('meta[name="qa-recorder-backend-url"]');
  
  if (isAutomatiQADashboard || window.location.hostname === 'localhost') {
    console.log("[QA Recorder] Dashboard detected. Syncing backend URL:", window.location.origin);
    chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', url: window.location.origin });
  }

  // Initial state check
  chrome.storage.local.get(['isRecording'], (result) => {
    updateRecordingState(!!result.isRecording);
  });

  // Re-check state on focus (ensure we didn't miss a start/stop while backgrounded)
  window.addEventListener('focus', () => {
    chrome.storage.local.get(['isRecording'], (result) => {
      updateRecordingState(!!result.isRecording);
    });
  });

  // Listen for recording state changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.isRecording) {
      updateRecordingState(!!changes.isRecording.newValue);
    }
  });

  // MutationObserver to handle dynamic DOM and ensure we're still ready
  const observer = new MutationObserver(() => {
    // On highly dynamic sites like Foxquilt, we might want to re-check storage periodically
    // or log that we're still watching if debug is on
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const isSensitiveField = (element) => {
    if (!element) return false;
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const type = (element.type || '').toLowerCase();
    const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    
    const sensitiveTerms = ['password', 'pwd', 'otp', 'code', 'token', 'secret', 'apikey', 'creditcard', 'cvv', 'pin'];
    
    return type === 'password' || 
           sensitiveTerms.some(term => 
             name.includes(term) || 
             id.includes(term) || 
             placeholder.includes(term) || 
             ariaLabel.includes(term)
           );
  };

  const getSafeValue = (element, originalValue) => {
    if (isSensitiveField(element)) {
      return '********';
    }
    return originalValue;
  };

  const getPlaceholder = (element) => {
    const name = (element.name || element.id || 'field').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return `\${${name}}`;
  };

  const recordEvent = (action, el, extra = {}) => {
    if (!isRecording || !el) return;
    const attempt = (retries) => {
      if (!window.QA_RECORDER_UTILS) {
        if (retries > 0) setTimeout(() => attempt(retries - 1), 100);
        else console.error("[QA Recorder] Utils not found after retries.");
        return;
      }
      try {
        const info = window.QA_RECORDER_UTILS.getElementInfo(el);
        let value = extra.value !== undefined ? extra.value : el.value;
        const masked = isSensitiveField(el);
        
        if (masked) {
          extra.originalValue = value; // Store for script generation if needed, but UI will use placeholder
          extra.placeholder = getPlaceholder(el);
          value = '********';
        }

        let targetBox = null;
        let coordinates = null;
        if (info && info.rect) {
          const winWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
          const winHeight = window.innerHeight || document.documentElement.clientHeight || 800;
          targetBox = {
            x: Math.max(0, Math.min(96, (info.rect.left / winWidth) * 100)),
            y: Math.max(0, Math.min(96, (info.rect.top / winHeight) * 100)),
            width: Math.max(2, Math.min(96, (info.rect.width / winWidth) * 100)),
            height: Math.max(2, Math.min(96, (info.rect.height / winHeight) * 100))
          };
          coordinates = {
            x: Math.max(0, Math.min(100, ((info.rect.left + (info.rect.width || 0) / 2) / winWidth) * 100)),
            y: Math.max(0, Math.min(100, ((info.rect.top + (info.rect.height || 0) / 2) / winHeight) * 100))
          };
        }

        const step = {
          action,
          selector: info.selector,
          locator: info.locator,
          elementName: info.text || info.role || info.tagName,
          role: info.role,
          text: info.text,
          value,
          url: window.location.href,
          timestamp: Date.now(),
          masked,
          targetBox,
          coordinates,
          x: coordinates ? coordinates.x : undefined,
          y: coordinates ? coordinates.y : undefined,
          ...extra
        };
        chrome.runtime.sendMessage({ type: 'STEP', payload: step });
        const orig = el.style.outline;
        el.style.outline = "2px solid #10b981";
        el.style.outlineOffset = "2px";
        setTimeout(() => { el.style.outline = orig; }, 300);
      } catch (err) {
        console.error("[QA Recorder] Error capturing step:", err);
      }
    };
    attempt(5);
  };

  const getRealTarget = (e) => {
    if (e.composedPath && e.composedPath().length > 0) {
      return e.composedPath()[0];
    }
    return e.target;
  };

  const getInteractiveElement = (target) => {
    if (!target || !target.closest) return target;
    return target.closest('button, a, input, select, textarea, [role="button"], [role="link"]') || target;
  };

  // Click
  document.addEventListener('click', (e) => {
    if (!isRecording) return;
    const realTarget = getRealTarget(e);
    const el = getInteractiveElement(realTarget);
    
    if (isTargetSite) console.log(`[QA Recorder Foxquilt Click] RealTarget:`, realTarget, `InteractiveEl:`, el);

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      // `change` runs after the browser has applied the checked state.
      return;
    } else {
      recordEvent('click', el);
    }
  }, true);

  // Input (typing)
  let hoverTimeout = null;
  let lastHoveredElement = null;
  document.addEventListener('pointerover', (e) => {
    if (!isRecording) return;
    const el = getInteractiveElement(getRealTarget(e));
    if (!el || el === lastHoveredElement) return;
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      lastHoveredElement = el;
      recordEvent('hover', el);
    }, 500);
  }, true);

  let inputTimeout = null;
  document.addEventListener('input', (e) => {
    if (!isRecording) return;
    const el = getRealTarget(e);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        recordEvent('fill', el, { value: el.value });
      }, 800);
    }
  }, true);

  // Keydown
  document.addEventListener('keydown', (e) => {
      if (!isRecording) return;
      const el = getRealTarget(e);
      if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
          recordEvent('press', el, { value: e.key });
      }
  }, true);

  // Change (dropdown & file upload)
  document.addEventListener('change', (e) => {
    if (!isRecording) return;
    const el = getRealTarget(e);
    if (el.tagName === 'SELECT') {
      recordEvent('selectOption', el, { value: el.value, text: el.options[el.selectedIndex]?.text });
    } else if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      recordEvent(el.checked ? 'check' : 'uncheck', el, { value: el.checked });
    } else if (el.tagName === 'INPUT' && el.type === 'radio') {
      recordEvent('select', el, { value: el.value || el.name || 'selected' });
    } else if (el.tagName === 'INPUT' && el.type === 'file') {
      const files = Array.from(el.files || []).map(f => f.name);
      recordEvent('upload', el, { value: files.join(', '), files: files });
    }
  }, true);

  // Scroll
  let scrollTimeout = null;
  window.addEventListener('scroll', (e) => {
    if (!isRecording) return;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      recordEvent('scroll', document.documentElement, { 
        value: `x: ${window.scrollX}, y: ${window.scrollY}`,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
    }, 1000);
  }, true);

  // Navigation (already handled by background.js on tab update, but we can send it here too)
  window.addEventListener('load', () => {
    if (isRecording) {
      chrome.runtime.sendMessage({ 
        type: 'STEP', 
        payload: {
          action: 'navigate',
          url: window.location.href,
          timestamp: Date.now()
        }
      });
    }
  });

})();
