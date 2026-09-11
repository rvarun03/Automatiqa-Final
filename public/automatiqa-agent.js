/**
 * AutomatiQA Device Agent (Real-Time ADB Streaming & Action Bridge)
 * -----------------------------------------------------------------
 * Companion script for local USB devices and Android Studio emulators (e.g. emulator-5554)
 * to stream real Android application screens directly to AutomatiQA and capture physical/emulator taps.
 */

const { exec, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Read command line arguments
const args = {};
process.argv.slice(2).forEach(val => {
  const parts = val.split('=');
  if (parts[0].startsWith('--')) {
    const key = parts[0].slice(2);
    args[key] = parts[1];
  }
});

const userEmail = (args.email || 'sowbarnya@qaoncloud.com').toLowerCase();
const serverUrl = (args.server || 'http://localhost:3000').replace(/\/$/, '');
const port = parseInt(args.port) || 4723;
const appiumServerUrl = new URL(args.appium || process.env.AUTOMATIQA_APPIUM_URL || `http://127.0.0.1:${port}`);

console.log('====================================================');
console.log('       AUTOMATIQA DEVICE AGENT (REAL-TIME ADB STREAM)');
console.log('====================================================');
console.log(`User Email : ${userEmail}`);
console.log(`Server URL : ${serverUrl}`);
console.log(`Appium URL: ${appiumServerUrl.href.replace(/\/$/, '')}`);
console.log(`ADB Status : Checking...`);

function runCmd(command) {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stdout: stdout || '', stderr: stderr || '' });
      } else {
        resolve({ success: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

let appiumSession = { deviceId: '', sessionId: '' };

function appiumRequest(method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const client = appiumServerUrl.protocol === 'https:' ? https : http;
    const basePath = appiumServerUrl.pathname.replace(/\/$/, '');
    const req = client.request({
      hostname: appiumServerUrl.hostname,
      port: appiumServerUrl.port || (appiumServerUrl.protocol === 'https:' ? 443 : 80),
      path: `${basePath}${requestPath}` || '/', method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, res => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(responseBody || '{}'); } catch (_) {}
        if ((res.statusCode || 500) >= 400 || parsed.value?.error) {
          reject(new Error(parsed.value?.message || `Appium request failed (${res.statusCode})`));
          return;
        }
        resolve(parsed);
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Appium request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getAppiumSession(deviceId) {
  if (appiumSession.deviceId === deviceId && appiumSession.sessionId) return appiumSession.sessionId;
  const response = await appiumRequest('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': deviceId,
        'appium:udid': deviceId,
        'appium:noReset': true,
        'appium:autoLaunch': false,
        'appium:newCommandTimeout': 3600
      },
      firstMatch: [{}]
    }
  });
  const sessionId = response.value?.sessionId || response.sessionId;
  if (!sessionId) throw new Error('Appium did not create a UiAutomator2 session');
  appiumSession = { deviceId, sessionId };
  console.log(`[Appium] UiAutomator2 session ${sessionId} attached to ${deviceId}`);
  return sessionId;
}

async function performAppiumSwipe(deviceId, x1, y1, x2, y2, duration) {
  try {
    const sessionId = await getAppiumSession(deviceId);
    const gestureDuration = Math.max(100, Math.min(2500, duration || 300));
    await appiumRequest('POST', `/session/${encodeURIComponent(sessionId)}/actions`, {
      actions: [{
        type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, origin: 'viewport', x: x1, y: y1 },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: Math.min(150, gestureDuration) },
          { type: 'pointerMove', duration: gestureDuration, origin: 'viewport', x: x2, y: y2 },
          { type: 'pointerUp', button: 0 }
        ]
      }]
    });
    console.log(`[Appium][Swipe] (${x1},${y1}) -> (${x2},${y2}) on ${deviceId}`);
    return true;
  } catch (error) {
    console.warn(`[Appium][Swipe] ${error.message}; falling back to ADB.`);
    appiumSession = { deviceId: '', sessionId: '' };
    return false;
  }
}

async function checkAdb() {
  const result = await runCmd('adb version');
  if (result.success) {
    console.log(`ADB Status : OK (${result.stdout.split('\n')[0]})`);
    return true;
  } else {
    console.log('ADB Status : ERROR (ADB not found in system PATH. Install Android SDK Platform-Tools.)');
    return false;
  }
}

async function scanDevices() {
  const result = await runCmd('adb devices -l');
  if (!result.success) return [];

  const lines = result.stdout.split('\n');
  const devices = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const id = parts[0];
    const status = parts[1];
    if (status !== 'device') continue;

    let model = 'Unknown Android Device';
    parts.forEach(part => {
      if (part.startsWith('model:')) model = part.substring(6).replace(/_/g, ' ');
    });

    const isEmulator = id.startsWith('emulator-') || id.startsWith('127.0.0.1:') || model.toLowerCase().includes('emulator');

    const versionRes = await runCmd(`adb -s ${id} shell getprop ro.build.version.release`);
    const version = versionRes.success && versionRes.stdout.trim() ? versionRes.stdout.trim() : '14';

    devices.push({
      deviceId: id,
      deviceName: model,
      platform: 'Android',
      version: version,
      status: 'Connected',
      type: isEmulator ? 'Emulator' : 'Real Device'
    });
  }

  return devices;
}

// Fast binary screencap via adb exec-out with fallback
function captureScreenshot(deviceId) {
  return new Promise((resolve) => {
    exec(`adb -s ${deviceId} exec-out screencap -p`, { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
      if (!err && stdout && stdout.length > 1000) {
        const base64Image = stdout.toString('base64');
        resolve(`data:image/png;base64,${base64Image}`);
      } else {
        // Fallback method via tmp
        const tempPath = path.join(__dirname || '.', `screencap_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        runCmd(`adb -s ${deviceId} shell screencap -p /data/local/tmp/screencap.png`).then(() => {
          runCmd(`adb -s ${deviceId} pull /data/local/tmp/screencap.png "${tempPath}"`).then(() => {
            try {
              if (fs.existsSync(tempPath)) {
                const fileData = fs.readFileSync(tempPath);
                fs.unlinkSync(tempPath);
                resolve(`data:image/png;base64,${fileData.toString('base64')}`);
                return;
              }
            } catch (e) {}
            resolve(null);
          });
        });
      }
    });
  });
}

// Cache the last window dump XML to minimize latency
let cachedXmlHierarchy = { time: 0, xml: '' };
let lastCapturedFrame = null;

async function dumpUiHierarchy(deviceId) {
  const dumpRes = await runCmd(`adb -s ${deviceId} shell uiautomator dump /data/local/tmp/window_dump.xml`);
  if (!dumpRes.success) return '';
  const readRes = await runCmd(`adb -s ${deviceId} shell cat /data/local/tmp/window_dump.xml`);
  return readRes.success && readRes.stdout && readRes.stdout.includes('<hierarchy') ? readRes.stdout : '';
}

async function refreshCachedXmlHierarchy(deviceId) {
  const xml = await dumpUiHierarchy(deviceId);
  if (xml) cachedXmlHierarchy = { time: Date.now(), xml };
  return xml;
}

async function getHierarchyBeforeGesture(deviceId) {
  if (cachedXmlHierarchy.xml && Date.now() - cachedXmlHierarchy.time < 2500) return cachedXmlHierarchy.xml;
  return refreshCachedXmlHierarchy(deviceId);
}

async function getElementAtCoordinates(deviceId, x, y, preloadedXml) {
  try {
    const now = Date.now();
    let xmlContent = typeof preloadedXml === 'string'
      ? preloadedXml
      : (preloadedXml === true ? await getHierarchyBeforeGesture(deviceId) : '');

    if (!xmlContent) xmlContent = await refreshCachedXmlHierarchy(deviceId);

    if (!xmlContent && now - cachedXmlHierarchy.time < 10000 && cachedXmlHierarchy.xml) {
      xmlContent = cachedXmlHierarchy.xml;
    }

    if (!xmlContent) return null;

    // Parse nodes and bounds [x1,y1][x2,y2]
    const nodeRegex = /<node\s+([^>]*)\s*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"([^>]*)\/?>/g;
    let match;
    let bestNodeAttributes = null;
    let smallestArea = Infinity;
    let bestInteractionRank = Infinity;

    while ((match = nodeRegex.exec(xmlContent)) !== null) {
      const allAttrs = (match[1] + ' ' + match[6]).trim();
      const x1 = parseInt(match[2], 10);
      const y1 = parseInt(match[3], 10);
      const x2 = parseInt(match[4], 10);
      const y2 = parseInt(match[5], 10);

      // Check if tap point is inside this node's bounds
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const area = (x2 - x1) * (y2 - y1);

        // Extract attributes
        const getAttr = (name) => {
          const m = allAttrs.match(new RegExp(`${name}="([^"]*)"`));
          return m ? m[1] : '';
        };

        const isClickable = getAttr('clickable') === 'true';
        const hasText = !!getAttr('text');
        const hasDesc = !!getAttr('content-desc');
        const nodeClass = getAttr('class') || 'android.view.View';
        const isNativeControl = /(?:EditText|Button|CheckBox|RadioButton|Switch|Spinner)$/i.test(nodeClass);

        // Prefer the actual input/button over a smaller TextView rendered
        // inside it. Area is only compared among equally useful node types.
        const interactionRank = isNativeControl ? 0 : isClickable ? 1 : (hasText || hasDesc) ? 2 : 3;
        if (interactionRank < bestInteractionRank || (interactionRank === bestInteractionRank && area < smallestArea)) {
          bestInteractionRank = interactionRank;
          smallestArea = area;
          bestNodeAttributes = {
            resourceId: getAttr('resource-id'),
            contentDescription: getAttr('content-desc'),
            text: getAttr('text'),
            className: nodeClass,
            clickable: isClickable,
            enabled: getAttr('enabled') !== 'false',
            editable: getAttr('editable') === 'true' || /EditText|TextInput|AutoCompleteTextView/i.test(nodeClass),
            focusable: getAttr('focusable') === 'true',
            focused: getAttr('focused') === 'true',
            password: getAttr('password') === 'true',
            bounds: `[${x1},${y1}][${x2},${y2}]`
          };
        }
      }
    }

    if (!bestNodeAttributes) return null;

    // Generic clickable containers often own a visible TextView rather than
    // exposing their own label. Use the nearest visible semantic node.
    if (!bestNodeAttributes.text && !bestNodeAttributes.contentDescription) {
      const semanticNodes = [];
      const semanticRegex = /<node\s+([^>]*)\s+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"([^>]*)\/?>/g;
      let semanticMatch;
      while ((semanticMatch = semanticRegex.exec(xmlContent)) !== null) {
        const attrs = `${semanticMatch[1]} ${semanticMatch[6]}`;
        const label = attrs.match(/(?:content-desc|text)="([^"]+)"/)?.[1]?.trim();
        if (!label) continue;
        const sx1 = Number(semanticMatch[2]);
        const sy1 = Number(semanticMatch[3]);
        const sx2 = Number(semanticMatch[4]);
        const sy2 = Number(semanticMatch[5]);
        const dx = x < sx1 ? sx1 - x : x > sx2 ? x - sx2 : 0;
        const dy = y < sy1 ? sy1 - y : y > sy2 ? y - sy2 : 0;
        const distance = Math.hypot(dx, dy);
        if (distance <= 220) semanticNodes.push({ label, distance });
      }
      semanticNodes.sort((a, b) => a.distance - b.distance);
      if (semanticNodes[0]) bestNodeAttributes.hint = semanticNodes[0].label;
    }

    let { resourceId, contentDescription, text, hint, password, className, bounds, focused } = bestNodeAttributes;
    // Some apps expose an empty EditText but render its label as a nearby
    // TextView. Associate the closest label above/overlapping the input.
    if (!contentDescription && !hint && /EditText$/i.test(className || '')) {
      const inputBounds = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (inputBounds) {
        const [, ix1, iy1, ix2] = inputBounds.map(Number);
        const labels = [];
        const labelRegex = /<node\s+([^>]*)\s+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"([^>]*)\/?>/g;
        let labelMatch;
        while ((labelMatch = labelRegex.exec(xmlContent)) !== null) {
          const attrs = `${labelMatch[1]} ${labelMatch[6]}`;
          const label = attrs.match(/(?:text|content-desc)="([^"]+)"/)?.[1]?.trim();
          if (!label) continue;
          if (text && label === text) continue;
          const lx1 = Number(labelMatch[2]);
          const ly2 = Number(labelMatch[5]);
          const lx2 = Number(labelMatch[4]);
          const overlapsHorizontally = lx2 >= ix1 && lx1 <= ix2;
          const verticalDistance = Number(iy1) - ly2;
          if (overlapsHorizontally && verticalDistance >= -40 && verticalDistance <= 300) {
            labels.push({ label, distance: Math.abs(verticalDistance) });
          }
        }
        labels.sort((a, b) => a.distance - b.distance);
        hint = labels[0]?.label || '';
      }
    }
    const isAndroidSystemSurface = /^android:id\/(?:navigationBarBackground|statusBarBackground|content)$/i.test(resourceId);
    const hasStableSemanticLocator = !!(resourceId || contentDescription || text || hint);
    const isNativeInteractiveControl = /(?:EditText|Button|CheckBox|RadioButton|Switch|Spinner)$/i.test(className || '');
    // Containers, root canvas views and Android system bars are not the
    // control the user intended to tap. Returning null makes the recorder use
    // its coordinate fallback instead of emitting a misleading XPath.
    if (isAndroidSystemSurface || (!hasStableSemanticLocator && !isNativeInteractiveControl)) return null;
    let xpath = '';
    let primaryType = 'xpath';
    let primaryValue = '';
    let playwrightScript = '';

    if (/EditText$/i.test(className || '') && resourceId) {
      primaryType = 'resource-id';
      primaryValue = resourceId;
      xpath = `//*[@resource-id="${resourceId}"]`;
      playwrightScript = `await driver.elementById("${resourceId}").click();`;
    } else if (/EditText$/i.test(className || '') && contentDescription) {
      primaryType = 'accessibility-id';
      primaryValue = contentDescription;
      xpath = `//*[@content-desc="${contentDescription}"]`;
      playwrightScript = `await driver.elementByAccessibilityId("${contentDescription}").click();`;
    } else if (/EditText$/i.test(className || '')) {
      primaryType = 'xpath';
      primaryValue = `//${className}[@bounds='${bounds}']`;
      xpath = primaryValue;
      playwrightScript = `const el = await driver.elementByXPath("${xpath}");\nawait el.click();`;
    } else if (text) {
      primaryType = 'text';
      primaryValue = text;
      xpath = `//*[@text="${text}"]`;
      playwrightScript = `const el = await driver.elementByXPath("//*[@text='${text}']");\nawait el.click();`;
    } else if (contentDescription) {
      primaryType = 'accessibility-id';
      primaryValue = contentDescription;
      xpath = `//*[@content-desc="${contentDescription}"]`;
      playwrightScript = `await driver.elementByAccessibilityId("${contentDescription}").click();`;
    } else if (resourceId) {
      primaryType = 'resource-id';
      primaryValue = resourceId;
      xpath = `//*[@resource-id="${resourceId}"]`;
      playwrightScript = `await driver.elementById("${resourceId}").click();`;
    } else {
      primaryType = 'xpath';
      primaryValue = `//${className}[@bounds='${bounds}']`;
      xpath = primaryValue;
      playwrightScript = `const el = await driver.elementByXPath("${xpath}");\nawait el.click();`;
    }

    return {
      resourceId,
      accessibilityId: contentDescription || undefined,
      contentDescription,
      text,
      hint,
      password,
      className,
      clickable: bestNodeAttributes.clickable,
      enabled: bestNodeAttributes.enabled,
      editable: bestNodeAttributes.editable,
      focusable: bestNodeAttributes.focusable,
      focused: bestNodeAttributes.focused,
      bounds,
      xpath,
      primaryType,
      primaryValue,
      playwrightScript
    };
  } catch (err) {
    console.error('Failed to parse window XML dump:', err.message);
  }
  return null;
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseBounds(bounds) {
  const match = String(bounds || '').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return null;
  return {
    x1, y1, x2, y2,
    width: x2 - x1,
    height: y2 - y1,
    centerX: Math.round((x1 + x2) / 2),
    centerY: Math.round((y1 + y2) / 2)
  };
}

function getRecordedPoint(params) {
  const bounds = parseBounds(params?.bounds || params?.target?.bounds || params?.node?.bounds || params?.locator?.primary?.bounds);
  if (bounds) return { x: bounds.centerX, y: bounds.centerY };
  if (params?.x !== undefined && params?.y !== undefined) {
    const x = Number(params.x);
    const y = Number(params.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

function parseUiNodes(xml) {
  const nodes = [];
  const nodeRegex = /<node\s+([^>]*?)\/?>/g;
  let match;
  while ((match = nodeRegex.exec(xml || '')) !== null) {
    const attrs = match[1];
    const getAttr = (name) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return m ? xmlDecode(m[1]).trim() : '';
    };
    const boundsText = getAttr('bounds');
    const bounds = parseBounds(boundsText);
    if (!bounds) continue;
    nodes.push({
      resourceId: getAttr('resource-id'),
      contentDescription: getAttr('content-desc'),
      text: getAttr('text'),
      className: getAttr('class'),
      clickable: getAttr('clickable') === 'true',
      editable: getAttr('editable') === 'true' || /EditText|TextInput|AutoCompleteTextView/i.test(getAttr('class')),
      focusable: getAttr('focusable') === 'true',
      focused: getAttr('focused') === 'true',
      enabled: getAttr('enabled') !== 'false',
      visibleToUser: getAttr('visible-to-user') !== 'false',
      boundsText,
      bounds
    });
  }
  return nodes;
}

// Resolve a recorded native node on the current screen before falling back to
// coordinates. If several nodes match, choose the one nearest the recorded
// position so repeated small icons do not resolve to the wrong copy.
function resolveRecordedTarget(xml, params) {
  if (!xml || !params) return null;
  const target = params.target || params.node || {};
  const primary = params.locator?.primary || {};
  const alternatives = Array.isArray(params.locator?.alternatives) ? params.locator.alternatives : [];
  const wanted = {
    resourceId: target.resourceId || params.resourceId || (primary.type === 'resource-id' ? primary.value : '') || alternatives.find(a => a?.type === 'resource-id')?.value,
    contentDescription: target.contentDescription || target.accessibilityId || params.contentDescription || params.accessibilityId || (primary.type === 'content-desc' || primary.type === 'accessibility-id' ? primary.value : '') || alternatives.find(a => a?.type === 'content-desc' || a?.type === 'accessibility-id')?.value,
    // params.text is the value to enter for fill/type actions, never an
    // element locator. Using it here made edited values search for a field
    // that already contained the new text before playback typed anything.
    text: target.text || (primary.type === 'text' ? primary.value : '') || alternatives.find(a => a?.type === 'text')?.value,
    className: target.className || params.className || ''
  };
  if (!wanted.resourceId && !wanted.contentDescription && !wanted.text && primary.type === 'coordinates') return null;

  const recordedPoint = getRecordedPoint(params);
  const nodes = parseUiNodes(xml).filter(node => node.enabled && node.visibleToUser);
  const candidates = [];

  for (const node of nodes) {
    let score = 0;
    const reasons = [];
    if (wanted.resourceId && node.resourceId === String(wanted.resourceId)) {
      score += 100;
      reasons.push('resource-id');
    }
    if (wanted.contentDescription && node.contentDescription === String(wanted.contentDescription)) {
      score += 80;
      reasons.push('content-desc');
    }
    if (wanted.text && node.text === String(wanted.text)) {
      score += 60;
      reasons.push('text');
    }
    if (wanted.className && node.className === String(wanted.className)) {
      score += 20;
      reasons.push('class');
    }
    if (!score) continue;
    if (!node.clickable && !/(Button|CheckBox|RadioButton|Switch|ImageButton|TextView)$/i.test(node.className || '')) {
      score -= 25;
    }
    const distance = recordedPoint
      ? Math.hypot(node.bounds.centerX - recordedPoint.x, node.bounds.centerY - recordedPoint.y)
      : 0;
    candidates.push({ node, score, distance, locatorUsed: reasons.join('+') });
  }

  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || (a.node.bounds.width * a.node.bounds.height) - (b.node.bounds.width * b.node.bounds.height));
  const best = candidates[0];
  if (!best || best.score < 40) return null;

  return {
    x: best.node.bounds.centerX,
    y: best.node.bounds.centerY,
    bounds: best.node.boundsText,
    locatorUsed: best.locatorUsed,
    className: best.node.className,
    text: best.node.text,
    resourceId: best.node.resourceId,
    contentDescription: best.node.contentDescription,
    clickable: best.node.clickable,
    editable: best.node.editable,
    focusable: best.node.focusable,
    focused: best.node.focused,
    distance: Math.round(best.distance)
  };
}

function sameEditableTarget(left, right) {
  if (!left || !right) return false;
  if (left.resourceId && right.resourceId) return left.resourceId === right.resourceId;
  if (left.contentDescription && right.contentDescription) return left.contentDescription === right.contentDescription;
  return left.className === right.className && left.bounds === right.bounds;
}

async function isKeyboardVisible(deviceId) {
  const result = await runCmd(`adb -s ${deviceId} shell dumpsys input_method`);
  return !!(result.success && /mInputShown=true|mIsInputViewShown=true|isInputViewShown=true/i.test(result.stdout || ''));
}

async function waitUntilInputReady(deviceId, params, initialTarget, timeoutMs = 5000) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    const xml = await refreshCachedXmlHierarchy(deviceId).catch(() => '');
    const resolved = resolveRecordedTarget(xml, params);
    const focused = await getFocusedElement(deviceId, xml).catch(() => null);
    const target = resolved || initialTarget;
    const targetMatchesFocus = sameEditableTarget(target, focused);
    const keyboardVisible = await isKeyboardVisible(deviceId).catch(() => false);
    lastState = { target, focused, keyboardVisible, targetMatchesFocus };
    console.log('[MOBILE_PLAYBACK][INPUT_READY]', {
      resourceId: target?.resourceId || '', className: target?.className || '',
      editable: !!target?.editable || /EditText|TextInput|AutoCompleteTextView/i.test(target?.className || ''),
      focused: targetMatchesFocus, keyboardVisible
    });
    if (target && targetMatchesFocus && target.enabled !== false) return lastState;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return lastState;
}

// Text typed with `adb shell input text` goes to whichever field holds focus, so
// the focused node is the element the step should reference.
async function getFocusedElement(deviceId, preloadedXml) {
  try {
    const xmlContent = preloadedXml || cachedXmlHierarchy.xml || await dumpUiHierarchy(deviceId);
    if (!xmlContent) return null;

    const nodeRegex = /<node\s+([^>]*?)\/?>/g;
    let match;
    while ((match = nodeRegex.exec(xmlContent)) !== null) {
      const attrs = match[1];
      const getAttr = (name) => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1] : '';
      };
      if (getAttr('focused') !== 'true') continue;

      const boundsMatch = getAttr('bounds').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
      if (!boundsMatch) continue;
      const centerX = Math.round((Number(boundsMatch[1]) + Number(boundsMatch[3])) / 2);
      const centerY = Math.round((Number(boundsMatch[2]) + Number(boundsMatch[4])) / 2);
      return await getElementAtCoordinates(deviceId, centerX, centerY, xmlContent);
    }
  } catch (err) {
    console.error('Failed to resolve the focused element:', err.message);
  }
  return null;
}

// Appium code that drives the element itself rather than raw screen coordinates
function buildAppiumScript(action, locatorAttr, params) {
  const target = locatorAttr && locatorAttr.primaryValue
    ? (locatorAttr.primaryType === 'resource-id'
        ? `driver.elementById(${JSON.stringify(locatorAttr.primaryValue)})`
        : locatorAttr.primaryType === 'accessibility-id'
          ? `driver.elementByAccessibilityId(${JSON.stringify(locatorAttr.primaryValue)})`
          : `driver.elementByXPath(${JSON.stringify(locatorAttr.xpath || locatorAttr.primaryValue)})`)
    : '';

  if (action === 'fill' || action === 'type') {
    return target
      ? `const el = await ${target};\nawait el.clear();\nawait el.sendKeys(${JSON.stringify(params.text || '')});`
      : `await driver.keys(${JSON.stringify(params.text || '')});`;
  }
  if (action === 'press') {
    const keyName = params.key || 'Back';
    return `// Press ${keyName}\nawait driver.pressKeyCode(${keyName === 'Home' ? 3 : keyName === 'Recents' ? 187 : keyName === 'Enter' ? 66 : 4});`;
  }
  if (action === 'swipe' || action === 'scroll') {
    const anchor = target ? `const el = await ${target};\n` : '';
    return `${anchor}await driver.touchPerform([\n  { action: 'press', options: { x: ${params.x1}, y: ${params.y1} } },\n  { action: 'wait', options: { ms: ${params.duration || 300} } },\n  { action: 'moveTo', options: { x: ${params.x2}, y: ${params.y2} } },\n  { action: 'release' }\n]);`;
  }
  if (action === 'long_press') {
    return target
      ? `const el = await ${target};\nawait driver.touchPerform([{ action: 'longPress', options: { element: el.value } }, { action: 'release' }]);`
      : `await driver.touchPerform([{ action: 'longPress', options: { x: ${params.x}, y: ${params.y} } }, { action: 'release' }]);`;
  }
  if (action === 'double_tap') {
    return target
      ? `const el = await ${target};\nawait el.click();\nawait el.click();`
      : `await driver.touchPerform([{ action: 'tap', options: { x: ${params.x}, y: ${params.y}, count: 2 } }]);`;
  }
  // click / tap
  return target
    ? `await (await ${target}).click();`
    : `await driver.touchPerform([{ action: 'tap', options: { x: ${params.x}, y: ${params.y} } }]);`;
}

function postJson(urlStr, data) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const payload = JSON.stringify(data);
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch(e) {
            resolve(body);
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    } catch(err) {
      reject(err);
    }
  });
}

function getJson(urlStr) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'GET'
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch(e) {
            resolve(body);
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.end();
    } catch(err) {
      reject(err);
    }
  });
}

let agentRunning = true;
let activeRecordingSession = null;
let lastUploadedFrameTime = 0;
let lastUploadedHierarchyTime = 0;
let touchListenerProcess = null;
let currentListeningDevice = null;
let touchDeviceBounds = { displayWidth: 1080, displayHeight: 2400, touchMaxX: 1080, touchMaxY: 2400 };
// ADB-injected input is visible to getevent like a physical touch. Suppress it
// so one inspector/playback tap cannot be recorded and replayed twice.
let suppressInjectedTouchUntil = 0;
// Browser live-frame recording creates the authoritative step before it sends
// ADB input. For that transaction, getevent is only an echo of our command and
// must never create a second (often stale-hierarchy) step.
let browserDrivenCommandUntil = 0;
let activePlaybackInputTarget = null;
const injectedTouchMarkers = [];
// getevent callbacks are synchronous, while hierarchy dumps and screenshots
// are asynchronous. Preserve the user's physical interaction order so a tap
// made after a swipe can never reach the server before that swipe.
let recordingInteractionQueue = Promise.resolve();

function enqueueRecordingInteraction(work) {
  recordingInteractionQueue = recordingInteractionQueue
    .then(work)
    .catch(err => console.error('[Recorder] Interaction failed:', err.message));
}

function markInjectedTouch(x, y, kind = 'tap') {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
  injectedTouchMarkers.push({ x: Number(x), y: Number(y), kind, expiresAt: Date.now() + 5000 });
  while (injectedTouchMarkers.length > 12) injectedTouchMarkers.shift();
}

function consumeInjectedTouch(x, y) {
  const now = Date.now();
  for (let index = injectedTouchMarkers.length - 1; index >= 0; index--) {
    const marker = injectedTouchMarkers[index];
    if (marker.expiresAt < now) {
      injectedTouchMarkers.splice(index, 1);
      continue;
    }
    // Input injection can be rounded differently by a device driver; 24px is
    // deliberately much smaller than adjacent form controls/buttons.
    if (Math.hypot(marker.x - x, marker.y - y) <= 24) {
      injectedTouchMarkers.splice(index, 1);
      return marker;
    }
  }
  return null;
}

async function getDeviceBounds(deviceId) {
  let displayWidth = 1080;
  let displayHeight = 2400;
  let touchMaxX = 1080;
  let touchMaxY = 2400;

  const wmSize = await runCmd(`adb -s ${deviceId} shell wm size`);
  if (wmSize.success && wmSize.stdout) {
    const match = wmSize.stdout.match(/Override size:\s*(\d+)x(\d+)/) || wmSize.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
    if (match) {
      displayWidth = parseInt(match[1], 10);
      displayHeight = parseInt(match[2], 10);
    }
  }

  const geteventP = await runCmd(`adb -s ${deviceId} shell getevent -p`);
  if (geteventP.success && geteventP.stdout) {
    const lines = geteventP.stdout.split('\n');
    for (const l of lines) {
      if (l.includes('0035') || l.includes('ABS_MT_POSITION_X') || l.includes('ABS_X')) {
        const m = l.match(/max\s*(\d+)/i);
        if (m) touchMaxX = parseInt(m[1], 10);
      }
      if (l.includes('0036') || l.includes('ABS_MT_POSITION_Y') || l.includes('ABS_Y')) {
        const m = l.match(/max\s*(\d+)/i);
        if (m) touchMaxY = parseInt(m[1], 10);
      }
    }
  }

  return { displayWidth, displayHeight, touchMaxX, touchMaxY };
}

// Key map for converting ADB hardware input keys into characters
const KEY_MAP = {
  KEY_A: 'a', KEY_B: 'b', KEY_C: 'c', KEY_D: 'd', KEY_E: 'e', KEY_F: 'f', KEY_G: 'g', KEY_H: 'h',
  KEY_I: 'i', KEY_J: 'j', KEY_K: 'k', KEY_L: 'l', KEY_M: 'm', KEY_N: 'n', KEY_O: 'o', KEY_P: 'p',
  KEY_Q: 'q', KEY_R: 'r', KEY_S: 's', KEY_T: 't', KEY_U: 'u', KEY_V: 'v', KEY_W: 'w', KEY_X: 'x',
  KEY_Y: 'y', KEY_Z: 'z',
  KEY_0: '0', KEY_1: '1', KEY_2: '2', KEY_3: '3', KEY_4: '4', KEY_5: '5', KEY_6: '6', KEY_7: '7', KEY_8: '8', KEY_9: '9',
  KEY_SPACE: ' ', KEY_MINUS: '-', KEY_EQUAL: '=', KEY_SLASH: '/', KEY_BACKSLASH: '\\',
  KEY_SEMICOLON: ';', KEY_APOSTROPHE: "'", KEY_GRAVE: '`', KEY_COMMA: ',', KEY_DOT: '.',
  KEY_NUMPAD0: '0', KEY_NUMPAD1: '1', KEY_NUMPAD2: '2', KEY_NUMPAD3: '3', KEY_NUMPAD4: '4',
  KEY_NUMPAD5: '5', KEY_NUMPAD6: '6', KEY_NUMPAD7: '7', KEY_NUMPAD8: '8', KEY_NUMPAD9: '9'
};

let typingBuffer = '';
let typingTimer = null;
let lastFocusedElement = null;
let focusedTextBeforeTyping = '';
let lastTrackedActivity = '';
let lastForegroundPackage = '';

// The package under test, as reported by the server with each heartbeat
function getTargetPackage() {
  return (activeRecordingSession && (activeRecordingSession.appPackage || activeRecordingSession.packageName)) || '';
}

function isRecordingActive() {
  return !!activeRecordingSession && activeRecordingSession.status !== 'Stopped';
}

// Only interactions with the app under test belong in the recording. Without this
// check, tapping through the launcher or any app that happens to come to the
// foreground is captured as a step of the flow.
function isTargetInForeground() {
  const target = getTargetPackage();
  if (!target || !lastForegroundPackage) return true;
  return lastForegroundPackage === target;
}

function skipForegroundMismatch(what) {
  console.log(`[Recorder] Ignoring ${what}: "${lastForegroundPackage}" is in the foreground, not the app under test "${getTargetPackage()}".`);
}

async function flushTypingBuffer(deviceId) {
  if (!isRecordingActive()) {
    typingBuffer = '';
    return;
  }
  if (!typingBuffer) return;
  // getevent key ordering is not a reliable representation of an IME's final
  // committed text (especially soft keyboards/autocorrect). Use it only as a
  // trigger; UIAutomator's focused EditText is the authoritative value.
  const keyEventText = typingBuffer;
  typingBuffer = '';
  let focusedNow = null;
  try {
    const xml = await refreshCachedXmlHierarchy(deviceId);
    focusedNow = await getFocusedElement(deviceId, xml);
  } catch (err) {
    console.warn('[Recorder][Typing] Could not read focused field:', err.message);
  }

  if (focusedNow && (!lastFocusedElement || sameEditableTarget(lastFocusedElement, focusedNow))) {
    lastFocusedElement = { ...lastFocusedElement, ...focusedNow };
  }
  const displayedText = focusedNow?.text;
  const baseline = focusedTextBeforeTyping || '';
  // Normal typing appends to the text that was in the field when it received
  // focus. If it was replaced/autocorrected, preserve the complete visible
  // value and explicitly mark it for replacement during playback.
  const appendsToExistingText = typeof displayedText === 'string' && displayedText.startsWith(baseline);
  const typedText = typeof displayedText === 'string'
    ? (appendsToExistingText ? displayedText.slice(baseline.length) : displayedText)
    : keyEventText;
  const replaceText = typeof displayedText === 'string' && !appendsToExistingText;

  if (!typedText && !replaceText) return;
  const inputScreenshot = await captureScreenshot(deviceId).catch(() => null);

  const stepPayload = {
    email: userEmail,
    event: {
      id: Math.random().toString(36).substring(7),
      action: 'fill',
      value: typedText,
      text: typedText,
      replaceText,
      elementName: lastFocusedElement?.hint || lastFocusedElement?.contentDescription || lastFocusedElement?.resourceId || `Input text: "${typedText}"`,
      locator: {
        primary: {
          type: lastFocusedElement?.primaryType || 'xpath',
          value: lastFocusedElement?.primaryValue || lastFocusedElement?.xpath || `//android.widget.EditText`,
          playwright: lastFocusedElement?.resourceId
            ? `${replaceText ? `await driver.elementById("${lastFocusedElement.resourceId}").clear();\n` : ''}await driver.elementById("${lastFocusedElement.resourceId}").sendKeys(${JSON.stringify(typedText)});`
            : `${replaceText ? 'await driver.elementByXPath("//android.widget.EditText").clear();\n' : ''}await driver.elementByXPath("//android.widget.EditText").sendKeys(${JSON.stringify(typedText)});`
        },
        alternatives: [
          lastFocusedElement?.resourceId ? { type: 'resource-id', value: lastFocusedElement.resourceId } : null,
          lastFocusedElement?.xpath ? { type: 'xpath', value: lastFocusedElement.xpath } : null
        ].filter(Boolean)
      },
      screen: lastTrackedActivity || "ActiveScreen",
      platform: 'mobile',
      bounds: lastFocusedElement?.bounds,
      node: lastFocusedElement ? {
        resourceId: lastFocusedElement.resourceId, accessibilityId: lastFocusedElement.accessibilityId,
        contentDescription: lastFocusedElement.contentDescription, text: lastFocusedElement.text,
        hint: lastFocusedElement.hint, className: lastFocusedElement.className,
        editable: true, focusable: lastFocusedElement.focusable !== false,
        focused: true, enabled: lastFocusedElement.enabled !== false, bounds: lastFocusedElement.bounds
      } : undefined,
      target: lastFocusedElement ? {
        resourceId: lastFocusedElement.resourceId, accessibilityId: lastFocusedElement.accessibilityId,
        contentDescription: lastFocusedElement.contentDescription, text: lastFocusedElement.text,
        hint: lastFocusedElement.hint, className: lastFocusedElement.className,
        editable: true, focusable: lastFocusedElement.focusable !== false,
        enabled: lastFocusedElement.enabled !== false, bounds: lastFocusedElement.bounds
      } : undefined,
      screenshot: inputScreenshot || lastCapturedFrame || undefined,
      timestamp: Date.now()
    }
  };

  console.log(`🟢 [ADB Recorded Step] Action: TYPE/FILL "${typedText}" (source=${focusedNow ? 'focused-ui-node' : 'key-events'})`);
  postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload).catch(() => {});
  postJson(`${serverUrl}/api/mobile/agent/record-event`, stepPayload).catch(() => {});
  postJson(`${serverUrl}/api/device-agent/upload-logs`, {
    email: userEmail,
    log: `[ADB Step Captured] TYPE "${typedText}" into input element`,
    type: 'info',
    url: 'ADB'
  }).catch(() => {});
  focusedTextBeforeTyping = typeof displayedText === 'string' ? displayedText : baseline;
}

async function startAdbTouchListener(deviceId) {
  if (currentListeningDevice === deviceId && touchListenerProcess) return;

  if (touchListenerProcess) {
    try { touchListenerProcess.kill(); } catch (e) {}
    touchListenerProcess = null;
  }

  currentListeningDevice = deviceId;
  touchDeviceBounds = await getDeviceBounds(deviceId);
  console.log(`[ADB Sniffer] 🟢 Active on ${deviceId} (Screen: ${touchDeviceBounds.displayWidth}x${touchDeviceBounds.displayHeight}, TouchMax: ${touchDeviceBounds.touchMaxX}x${touchDeviceBounds.touchMaxY})`);

  let lastSeenRawX = null;
  let lastSeenRawY = null;
  let currentRawX = null;
  let currentRawY = null;
  let isTouching = false;
  let lastRecordedTime = 0;
  let elementAtTouchStart = null;
  let screenshotAtTouchStart = null;
  let gestureStartRawX = null;
  let gestureStartRawY = null;
  let gestureStartedAt = 0;

  const beginTouch = () => {
    if (isTouching) return;
    isTouching = true;
    // Coordinates reported before TRACKING_ID/DOWN belong to the prior touch
    // on several Android drivers. Latch only values emitted during this touch.
    gestureStartRawX = null;
    gestureStartRawY = null;
    gestureStartedAt = Date.now();
    screenshotAtTouchStart = lastCapturedFrame;
  };

  try {
    touchListenerProcess = spawn('adb', ['-s', deviceId, 'shell', 'getevent', '-l']);
    let buffer = '';

    touchListenerProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;

        // Parse only absolute X axis events. Event value/code 0000 is also
        // used by EV_SYN and was incorrectly turning every recorded X into 0.
        if (line.includes('ABS_MT_POSITION_X') || /\bABS_X\b/.test(line) || /\b0035\b/.test(line)) {
          const parts = line.trim().split(/\s+/);
          const hexVal = parts[parts.length - 1];
          const val = parseInt(hexVal, 16);
          if (!isNaN(val)) {
            currentRawX = val;
            lastSeenRawX = val;
            if (isTouching && gestureStartRawX === null) gestureStartRawX = val;
            if (currentRawX > touchDeviceBounds.touchMaxX && touchDeviceBounds.touchMaxX <= touchDeviceBounds.displayWidth) {
              touchDeviceBounds.touchMaxX = Math.max(32767, currentRawX);
            }
          }
        }
        // Parse only absolute Y axis events; 0001 is not a safe Y identifier.
        else if (line.includes('ABS_MT_POSITION_Y') || /\bABS_Y\b/.test(line) || /\b0036\b/.test(line)) {
          const parts = line.trim().split(/\s+/);
          const hexVal = parts[parts.length - 1];
          const val = parseInt(hexVal, 16);
          if (!isNaN(val)) {
            currentRawY = val;
            lastSeenRawY = val;
            if (isTouching && gestureStartRawY === null) gestureStartRawY = val;
            if (currentRawY > touchDeviceBounds.touchMaxY && touchDeviceBounds.touchMaxY <= touchDeviceBounds.displayHeight) {
              touchDeviceBounds.touchMaxY = Math.max(32767, currentRawY);
            }
            if (isTouching && !elementAtTouchStart && currentRawX !== null) {
              const screenX = touchDeviceBounds.touchMaxX > touchDeviceBounds.displayWidth
                ? Math.round((currentRawX / touchDeviceBounds.touchMaxX) * touchDeviceBounds.displayWidth)
                : currentRawX;
              const screenY = touchDeviceBounds.touchMaxY > touchDeviceBounds.displayHeight
                ? Math.round((currentRawY / touchDeviceBounds.touchMaxY) * touchDeviceBounds.displayHeight)
                : currentRawY;
              // Always take a fresh hierarchy snapshot when the finger goes
              // down. The cached dump can belong to the previous screen (for
              // example after opening the image picker), which makes the
              // released tap get recorded as the previous element.
              elementAtTouchStart = refreshCachedXmlHierarchy(deviceId)
                .then(xml => getElementAtCoordinates(deviceId, screenX, screenY, xml || true))
                .catch(() => getElementAtCoordinates(deviceId, screenX, screenY, true));
            }
          }
        }
        // Many Android touch drivers report tracking IDs without BTN_TOUCH.
        else if ((line.includes('ABS_MT_TRACKING_ID') || line.includes('0039 ')) && !line.includes('ffffffff')) {
          beginTouch();
        }
        // Touch / Mouse Down
        else if ((line.includes('BTN_TOUCH') || line.includes('BTN_LEFT') || line.includes('BTN_MOUSE')) && line.includes('DOWN')) {
          beginTouch();
          const rawX = currentRawX !== null ? currentRawX : lastSeenRawX;
          const rawY = currentRawY !== null ? currentRawY : lastSeenRawY;
          if (rawX !== null && rawY !== null) {
            const screenX = touchDeviceBounds.touchMaxX > touchDeviceBounds.displayWidth
              ? Math.round((rawX / touchDeviceBounds.touchMaxX) * touchDeviceBounds.displayWidth)
              : rawX;
            const screenY = touchDeviceBounds.touchMaxY > touchDeviceBounds.displayHeight
              ? Math.round((rawY / touchDeviceBounds.touchMaxY) * touchDeviceBounds.displayHeight)
              : rawY;
            // Start Appium/UIAutomator inspection before the tap can navigate
            // away from the element that the user actually touched.
            elementAtTouchStart = refreshCachedXmlHierarchy(deviceId)
              .then(xml => getElementAtCoordinates(deviceId, screenX, screenY, xml || true))
              .catch(() => getElementAtCoordinates(deviceId, screenX, screenY, true));
          }
        }
        // Touch / Mouse Up or Release
        else if (
          ((line.includes('BTN_TOUCH') || line.includes('BTN_LEFT') || line.includes('BTN_MOUSE')) && line.includes('UP')) ||
          (line.includes('ABS_MT_TRACKING_ID') && line.includes('ffffffff')) ||
          (line.includes('0039') && line.includes('ffffffff'))
        ) {
          const targetX = currentRawX !== null ? currentRawX : lastSeenRawX;
          const targetY = currentRawY !== null ? currentRawY : lastSeenRawY;

          if (isTouching || (targetX !== null && targetY !== null)) {
            isTouching = false;
            const now = Date.now();
            if (now - lastRecordedTime > 300) {
              lastRecordedTime = now;
              currentRawX = null;
              currentRawY = null;

              if (targetX !== null && targetY !== null) {
                // Scale coordinates accurately to screen display pixels
                let screenX = targetX;
                let screenY = targetY;
                if (touchDeviceBounds.touchMaxX > touchDeviceBounds.displayWidth) {
                  screenX = Math.round((targetX / touchDeviceBounds.touchMaxX) * touchDeviceBounds.displayWidth);
                }
                if (touchDeviceBounds.touchMaxY > touchDeviceBounds.displayHeight) {
                  screenY = Math.round((targetY / touchDeviceBounds.touchMaxY) * touchDeviceBounds.displayHeight);
                }

                // Clamp to screen bounds
                screenX = Math.max(0, Math.min(touchDeviceBounds.displayWidth, screenX));
                screenY = Math.max(0, Math.min(touchDeviceBounds.displayHeight, screenY));

                const injectedMarker = consumeInjectedTouch(screenX, screenY);
                if (injectedMarker) {
                  console.log(`[Recorder] Ignoring injected ${injectedMarker.kind} at (${screenX}, ${screenY}); it must not create a recording step.`);
                  currentRawX = null;
                  currentRawY = null;
                  gestureStartRawX = null;
                  gestureStartRawY = null;
                  elementAtTouchStart = null;
                  screenshotAtTouchStart = null;
                  continue;
                }

                const capturedElement = elementAtTouchStart;
                const capturedScreenshot = screenshotAtTouchStart;
                elementAtTouchStart = null;
                screenshotAtTouchStart = null;
                const rawStartX = gestureStartRawX === null ? targetX : gestureStartRawX;
                const rawStartY = gestureStartRawY === null ? targetY : gestureStartRawY;
                const startX = touchDeviceBounds.touchMaxX > touchDeviceBounds.displayWidth
                  ? Math.round((rawStartX / touchDeviceBounds.touchMaxX) * touchDeviceBounds.displayWidth) : rawStartX;
                const startY = touchDeviceBounds.touchMaxY > touchDeviceBounds.displayHeight
                  ? Math.round((rawStartY / touchDeviceBounds.touchMaxY) * touchDeviceBounds.displayHeight) : rawStartY;
                gestureStartRawX = null;
                gestureStartRawY = null;

                if (Math.hypot(screenX - startX, screenY - startY) >= 30) {
                  enqueueRecordingInteraction(() => handlePhysicalEmulatorSwipe(deviceId, startX, startY, screenX, screenY, Math.max(100, Date.now() - gestureStartedAt), capturedElement, capturedScreenshot));
                } else {
                  enqueueRecordingInteraction(() => handlePhysicalEmulatorTap(deviceId, screenX, screenY, capturedElement, capturedScreenshot));
                }
              }
            }
          }
        }
        // Handle Back button keypress
        else if (line.includes('KEY_BACK') && line.includes('UP')) {
          handleHardwareKeyPress(deviceId, 'Back', 4);
        }
        // Handle Home button keypress
        else if ((line.includes('KEY_HOMEPAGE') || line.includes('KEY_HOME')) && line.includes('UP')) {
          handleHardwareKeyPress(deviceId, 'Home', 3);
        }
        // Handle App Switch button keypress
        else if ((line.includes('KEY_APPSELECT') || line.includes('KEY_MENU')) && line.includes('UP')) {
          handleHardwareKeyPress(deviceId, 'AppSwitch', 187);
        }
        // Handle Hardware Keystroke for typing
        else if (line.includes('EV_KEY') && line.includes('UP')) {
          const matchKey = line.match(/KEY_[A-Z0-9_]+/);
          if (matchKey) {
            const keyName = matchKey[0];
            if (keyName === 'KEY_ENTER') {
              void flushTypingBuffer(deviceId);
            } else if (keyName === 'KEY_BACKSPACE') {
              typingBuffer = typingBuffer.slice(0, -1);
            } else if (KEY_MAP[keyName]) {
              typingBuffer += KEY_MAP[keyName];
              if (typingTimer) clearTimeout(typingTimer);
              typingTimer = setTimeout(() => {
                void flushTypingBuffer(deviceId);
              }, 600);
            }
          }
        }
      }
    });

    touchListenerProcess.on('exit', () => {
      touchListenerProcess = null;
      currentListeningDevice = null;
    });
  } catch (err) {
    console.warn('[ADB Sniffer] Could not start getevent listener:', err.message);
  }
}

async function handleHardwareKeyPress(deviceId, keyName, keycode) {
  try {
    if (!isRecordingActive()) return;
    // Home and App Switch leave the app under test, so the press itself is only
    // a step when it happened while that app was in front.
    if (!isTargetInForeground()) {
      skipForegroundMismatch(`hardware key "${keyName}"`);
      return;
    }
    // The key event has already occurred when getevent reaches this handler;
    // capture the resulting screen for later playback verification.
    await new Promise(resolve => setTimeout(resolve, 250));
    const postActionScreenshot = await captureScreenshot(deviceId).catch(() => null);
    const stepPayload = {
      email: userEmail,
      event: {
        id: Math.random().toString(36).substring(7),
        action: 'press',
        value: keyName,
        elementName: `Hardware Key: ${keyName}`,
        locator: {
          primary: {
            type: 'key',
            value: keyName,
            playwright: `await driver.pressKeyCode(${keycode});`
          },
          alternatives: []
        },
        screen: "ActiveScreen",
        platform: 'mobile',
        timestamp: Date.now(),
        screenshot: postActionScreenshot || lastCapturedFrame
      }
    };

    console.log(`[ADB Key Event Captured] "${keyName}" on ${deviceId}`);
    await postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload);
    await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
      email: userEmail,
      log: `[ADB Key Event] Pressed '${keyName}' on ${deviceId}`,
      type: 'info',
      url: 'ADB'
    });
  } catch (err) {
    console.error('Failed to handle key press:', err.message);
  }
}

async function handlePhysicalEmulatorTap(deviceId, x, y, elementPromise, touchDownScreenshot) {
  try {
    if (Date.now() < browserDrivenCommandUntil) {
      console.log(`[Recorder] Ignoring getevent tap at (${x}, ${y}): browser-recorded command is authoritative.`);
      return;
    }
    if (!isRecordingActive()) return;
    if (!isTargetInForeground()) {
      skipForegroundMismatch(`physical tap at (${x}, ${y})`);
      return;
    }
    console.log(`[ADB Tap Event] Detected physical tap at coordinates (${x}, ${y}) on ${deviceId}`);
    const preActionScreenshot = touchDownScreenshot || lastCapturedFrame;
    // Prefer the hierarchy snapshot started on touch-down. Resolving only after
    // release can identify the destination screen instead of the touched node.
    const [locatorAttr, freshScreenshot] = await Promise.all([
      // A post-release lookup can resolve a new screen, never use it to
      // overwrite the field captured at touch-down.
      Promise.resolve(elementPromise).catch(() => null),
      captureScreenshot(deviceId).catch(() => null)
    ]);

    if (locatorAttr && /EditText$/i.test(locatorAttr.className || '')) {
      lastFocusedElement = { ...locatorAttr };
      focusedTextBeforeTyping = locatorAttr.text || '';
      console.log('[Recorder][Typing] focused target latched', JSON.stringify({
        resourceId: locatorAttr.resourceId,
        contentDescription: locatorAttr.contentDescription,
        textBeforeTyping: focusedTextBeforeTyping,
        hint: locatorAttr.hint,
        bounds: locatorAttr.bounds
      }));
    }

    const labelName = getAndroidElementName(locatorAttr) || `Unlabelled Android element`;
    const playwrightCode = locatorAttr?.playwrightScript || `await driver.touchPerform([{ action: 'tap', options: { x: ${x}, y: ${y} } }]);`;

    const stepPayload = {
      email: userEmail,
      event: {
        id: Math.random().toString(36).substring(7),
        action: 'click',
        value: undefined,
        elementName: labelName,
        locator: {
          primary: {
            type: locatorAttr?.primaryType || 'coordinates',
            value: locatorAttr?.primaryValue || locatorAttr?.xpath || JSON.stringify({ x, y, unit: 'pixels' }),
            playwright: playwrightCode
          },
          alternatives: [
            locatorAttr?.text ? { type: 'text', value: locatorAttr.text } : null,
            locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
            locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
            locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null,
            { type: 'coordinates', value: JSON.stringify({ x, y, unit: 'pixels' }) }
          ].filter(Boolean)
        },
        screen: "ActiveScreen",
        platform: 'mobile',
        coordinates: { x, y },
        x,
        y,
        screenWidth: touchDeviceBounds.displayWidth,
        screenHeight: touchDeviceBounds.displayHeight,
        normalizedX: touchDeviceBounds.displayWidth ? x / touchDeviceBounds.displayWidth : undefined,
        normalizedY: touchDeviceBounds.displayHeight ? y / touchDeviceBounds.displayHeight : undefined,
        node: locatorAttr ? {
          text: locatorAttr.text,
          contentDescription: locatorAttr.contentDescription,
          resourceId: locatorAttr.resourceId,
          className: locatorAttr.className,
          clickable: locatorAttr.clickable
        } : undefined,
        target: locatorAttr ? {
          resourceId: locatorAttr.resourceId,
          text: locatorAttr.text,
          contentDescription: locatorAttr.contentDescription,
          className: locatorAttr.className,
          clickable: locatorAttr.clickable,
          bounds: locatorAttr.bounds
        } : undefined,
        bounds: locatorAttr?.bounds,
        // Playback verification needs the state produced by this action.
        screenshot: freshScreenshot || preActionScreenshot,
        timestamp: Date.now()
      }
    };

    console.log(`🟢 [ADB Recorded Step] Action: CLICK on "${labelName}"`);

    // Post to both endpoints for instant UI synchronization
    await postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload).catch(() => {});
    await postJson(`${serverUrl}/api/mobile/agent/record-event`, stepPayload).catch(() => {});

    // Upload live log to browser console
    await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
      email: userEmail,
      log: `[ADB Step Captured] CLICK on "${labelName}" at (${x}, ${y})`,
      type: 'info',
      url: 'ADB'
    }).catch(() => {});

  } catch (err) {
    console.error('Failed to handle physical tap:', err.message);
  }
}

async function handlePhysicalEmulatorSwipe(deviceId, x1, y1, x2, y2, duration, elementPromise, touchDownScreenshot) {
  try {
    if (Date.now() < browserDrivenCommandUntil) {
      console.log(`[Recorder] Ignoring getevent swipe (${x1},${y1}) -> (${x2},${y2}): browser-recorded command is authoritative.`);
      return;
    }
    if (!isRecordingActive()) return;
    if (!isTargetInForeground()) {
      skipForegroundMismatch(`physical swipe at (${x1},${y1}) -> (${x2},${y2})`);
      return;
    }
    // Human vertical/horizontal swipes are rarely pixel-perfect. Lock the
    // minor axis so playback cannot drift diagonally into another carousel,
    // tab, or touch target.
    if (Math.abs(y2 - y1) >= Math.abs(x2 - x1)) {
      const lockedX = Math.round((x1 + x2) / 2);
      x1 = lockedX; x2 = lockedX;
    } else {
      const lockedY = Math.round((y1 + y2) / 2);
      y1 = lockedY; y2 = lockedY;
    }
    const locatorAttr = await Promise.resolve(elementPromise).catch(() => null);
    // ADB reports touch-up before WebView/native fling scrolling has settled.
    // Capture the stable destination, not a transient frame midway through it.
    await new Promise(resolve => setTimeout(resolve, 700));
    await refreshCachedXmlHierarchy(deviceId).catch(() => '');
    const postActionScreenshot = await captureScreenshot(deviceId).catch(() => null);
    const screenWidth = touchDeviceBounds.displayWidth;
    const screenHeight = touchDeviceBounds.displayHeight;
    const stepPayload = {
      email: userEmail,
      event: {
        id: Math.random().toString(36).substring(7),
        action: 'swipe',
        value: 'Swipe gesture',
        elementName: 'Swipe gesture',
        locator: {
          primary: { type: 'coordinates', value: JSON.stringify({ x1, y1, x2, y2, unit: 'pixels' }) },
          alternatives: []
        },
        platform: 'mobile',
        screen: 'ActiveScreen',
        x1, y1, x2, y2, duration,
        screenWidth, screenHeight,
        normalizedX1: x1 / screenWidth,
        normalizedY1: y1 / screenHeight,
        normalizedX2: x2 / screenWidth,
        normalizedY2: y2 / screenHeight,
        bounds: locatorAttr?.bounds,
        screenshot: postActionScreenshot || touchDownScreenshot || lastCapturedFrame,
        timestamp: Date.now()
      }
    };
    console.log(`[Recorder][Swipe] (${x1},${y1}) -> (${x2},${y2}) in ${duration}ms`);
    await postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload);
    await postJson(`${serverUrl}/api/mobile/agent/record-event`, stepPayload);
  } catch (err) {
    console.error(`[Recorder][Swipe] Failed: ${err.message}`);
  }
}

function getAndroidElementName(locatorAttr) {
  if (!locatorAttr) return '';
  const className = String(locatorAttr.className || '').split('.').pop();
  const identity = `${locatorAttr.resourceId || ''} ${locatorAttr.hint || ''} ${locatorAttr.contentDescription || ''}`;
  if (/EditText/i.test(className)) {
    if (locatorAttr.password || /pass(?:word|code)|pin/i.test(identity)) return 'Password field';
    if (/email/i.test(identity)) return 'Email field';
    if (/user(?:name)?/i.test(identity)) return 'Username field';
    if (locatorAttr.hint) return `${locatorAttr.hint} field`;
    if (locatorAttr.resourceId) {
      const fieldId = String(locatorAttr.resourceId).split(/[:/]id\//).pop() || '';
      const fieldName = fieldId.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
        .replace(/^(?:edit|text|input|field|et)\s+/i, '').trim();
      if (fieldName) return `${fieldName.replace(/\b\w/g, c => c.toUpperCase())} field`;
    }
    return 'Text field';
  }
  const semanticName = locatorAttr.contentDescription || locatorAttr.accessibilityId || locatorAttr.text || locatorAttr.hint;
  if (semanticName && /[a-z0-9]{2}/i.test(String(semanticName))) {
    const cleanName = String(semanticName).trim();
    return locatorAttr.clickable && !/\b(?:button|field|input|toggle|checkbox|link)\b/i.test(cleanName)
      ? `${cleanName} button`
      : cleanName;
  }
  if (locatorAttr.resourceId) {
    const id = String(locatorAttr.resourceId).split(/[:/]id\//).pop() || String(locatorAttr.resourceId);
    const words = id
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^(?:btn|button|toolbar|nav|navigation)\s+/i, '')
      .trim();
    if (/arrow\s*back|back\s*arrow|navigate\s*up/i.test(words)) return 'Back button';
    if (/profile|account|avatar/i.test(words)) return 'Profile button';
    if (/^(?:container|content|root|layout|view|wrapper|item|row|column|frame|screen)$/i.test(words)) return '';
    const title = words.replace(/\b\w/g, c => c.toUpperCase());
    return /Button$/i.test(className) && !/\bbutton$/i.test(title) ? `${title} button` : title;
  }
  if (/Button/i.test(className)) return 'Button';
  return className && className !== 'View' ? className.replace(/([a-z])([A-Z])/g, '$1 $2') : '';
}

async function startHeartbeat() {
  while (agentRunning) {
    try {
      const devices = await scanDevices();
      const payload = {
        email: userEmail,
        devices,
        agentPort: port,
        status: 'Active',
        timestamp: Date.now()
      };

      const res = await postJson(`${serverUrl}/api/mobile/agent/register`, payload);

      activeRecordingSession = res?.recording || null;
    } catch (e) {
      console.warn(`Connection to AutomatiQA Cloud failed: ${e.message}. Retrying...`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

let lastActivityCheckTime = 0;
let lastHierarchyRefreshTime = 0;

async function startStreamingAndCommandPolling() {
  while (agentRunning) {
    try {
      const devices = await scanDevices();
      if (devices.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const deviceId = devices[0].deviceId;

      // Start hardware event listener for physical emulator touches
      startAdbTouchListener(deviceId);

      // 1. Continuously capture & stream screenshots to AutomatiQA backend
      const now = Date.now();
      // Keep a recent pre-interaction DOM snapshot. A hierarchy request begun
      // on touch-down can otherwise finish after a button mutates its label.
      if (now - lastHierarchyRefreshTime >= 1200) {
        lastHierarchyRefreshTime = now;
        refreshCachedXmlHierarchy(deviceId).catch(() => '');
      }
      if (now - lastUploadedFrameTime >= 400) {
        const frame = await captureScreenshot(deviceId);
        if (frame) {
          lastCapturedFrame = frame;
          await postJson(`${serverUrl}/api/device-agent/upload-frame`, {
            email: userEmail,
            frame,
            capturedAt: Date.now()
          }).catch(() => {});
          lastUploadedFrameTime = now;
        }
      }

      // 1b. Stream the real UIAutomator hierarchy so the recorder can resolve
      // taps to actual app nodes instead of raw screen coordinates.
      if (now - lastUploadedHierarchyTime >= 500) {
        lastUploadedHierarchyTime = now;
        // Publish the same pre-action cache used by ACTION_DOWN, not a second
        // independently timed dump that can describe a different screen.
        const xml = cachedXmlHierarchy.xml || await refreshCachedXmlHierarchy(deviceId).catch(() => '');
        if (xml) {
          await postJson(`${serverUrl}/api/device-agent/upload-hierarchy`, {
            email: userEmail,
            xml,
            deviceId,
            capturedAt: cachedXmlHierarchy.time || Date.now()
          }).catch(() => {});
        }
      }

      // 2. Track screen navigation / Activity changes
      if (now - lastActivityCheckTime >= 1200) {
        lastActivityCheckTime = now;
        const winFocus = await runCmd(`adb -s ${deviceId} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1"`);
        if (winFocus.success && winFocus.stdout) {
          const actMatch = winFocus.stdout.match(/([a-zA-Z0-9_\.]+\/[a-zA-Z0-9_\.]+)/);
          if (actMatch) {
            const currentAct = actMatch[1];
            lastForegroundPackage = currentAct.split('/')[0];
            const target = getTargetPackage();
            // A transition into the launcher or an unrelated app is not a step of
            // this flow, so track it but do not record it.
            const isTargetScreen = !target || lastForegroundPackage === target;
            if (lastTrackedActivity && lastTrackedActivity !== currentAct && isTargetScreen) {
              console.log(`🟢 [ADB Navigation Captured] Screen transition to: ${currentAct}`);
              const screenName = currentAct.split('/')[1] || currentAct;
              const navPayload = {
                email: userEmail,
                event: {
                  id: Math.random().toString(36).substring(7),
                  action: 'navigate',
                  value: currentAct,
                  elementName: `Screen: ${screenName}`,
                  locator: {
                    primary: {
                      type: 'activity',
                      value: currentAct,
                      playwright: `await driver.startActivity("${currentAct.split('/')[0]}", "${currentAct.split('/')[1]}");`
                    },
                    alternatives: []
                  },
                  screen: screenName,
                  platform: 'mobile',
                  timestamp: Date.now()
                }
              };
              postJson(`${serverUrl}/api/device-agent/record-event`, navPayload).catch(() => {});
              postJson(`${serverUrl}/api/mobile/agent/record-event`, navPayload).catch(() => {});
            }
            lastTrackedActivity = currentAct;
          }
        }
      }

      // 2. Poll for pending interactive user commands from AutomatiQA UI
      const actionRes = await getJson(`${serverUrl}/api/device-agent/pending-actions?email=${encodeURIComponent(userEmail)}`);
      if (actionRes && actionRes.actions && actionRes.actions.length > 0) {
        for (const item of actionRes.actions) {
          const { action, params } = item;
          const actionDeviceId = params.deviceId || deviceId;
          console.log(`Executing Action on Device ${actionDeviceId}: ${action}`, params);

          let cmd = '';
          let locatorAttr = null;
          let locatorPromise = null;

          if (action === 'click' || action === 'tap' || action === 'double_tap' || action === 'long_press') {
            const currentScreen = await getDeviceBounds(actionDeviceId);
            const playbackXml = await refreshCachedXmlHierarchy(actionDeviceId).catch(() => '');
            const resolvedTarget = resolveRecordedTarget(playbackXml, params);
            // Prefer the live bounds of the recorded semantic target. This is
            // essential after scrolling because its screen coordinates move.
            // Recorded coordinates are only a fallback for coordinate-only
            // elements which cannot be found in the current hierarchy.
            let tapX;
            let tapY;
            let clickMethod = resolvedTarget ? 'current_resolved_target' : 'recorded_coordinate_fallback';
            const targetInfo = params.target || params.node || {};

            console.log('[Playback click] Recorded target:', {
              resource_id: targetInfo.resourceId || params.resourceId || '',
              content_desc: targetInfo.contentDescription || targetInfo.accessibilityId || params.contentDescription || params.accessibilityId || '',
              text: targetInfo.text || params.text || '',
              class: targetInfo.className || params.className || '',
              recorded_bounds: params.bounds || targetInfo.bounds || params.locator?.primary?.bounds || '',
              recorded_coordinate: { x: params.x, y: params.y },
              normalized: { x: params.normalizedX, y: params.normalizedY }
            });
            if (resolvedTarget) {
              console.log('[Playback click] Resolved target:', {
                locator_used: resolvedTarget.locatorUsed,
                current_bounds: resolvedTarget.bounds,
                current_center: { x: tapX, y: tapY },
                click_method: clickMethod,
                distance_from_recorded: resolvedTarget.distance
              });
            } else {
              console.log('[Playback click] Element lookup failed; using coordinate fallback.');
            }

            tapX = resolvedTarget?.x;
            tapY = resolvedTarget?.y;
            const normalizedX = Number(params.normalizedX);
            const normalizedY = Number(params.normalizedY);
            if (!Number.isFinite(tapX) || !Number.isFinite(tapY)) {
              tapX = Number.isFinite(normalizedX) ? Math.round(normalizedX * currentScreen.displayWidth) : undefined;
              tapY = Number.isFinite(normalizedY) ? Math.round(normalizedY * currentScreen.displayHeight) : undefined;
            }
            if (!Number.isFinite(tapX) || !Number.isFinite(tapY)) {
              const recordedWidth = Number(params.screenWidth);
              const recordedHeight = Number(params.screenHeight);
              tapX = Number.isFinite(recordedWidth) && recordedWidth > 0
                ? Math.round(Number(params.x) * currentScreen.displayWidth / recordedWidth)
                : Number(params.x);
              tapY = Number.isFinite(recordedHeight) && recordedHeight > 0
                ? Math.round(Number(params.y) * currentScreen.displayHeight / recordedHeight)
                : Number(params.y);
            }
            if (!Number.isFinite(Number(tapX)) || !Number.isFinite(Number(tapY))) {
              throw new Error(`[Playback][Tap] No valid recorded or resolved coordinates for ${params.locator?.primary?.value || 'target'}`);
            }
            console.log('[Playback click] Tap decision:', {
              locator_used: resolvedTarget?.locatorUsed || 'recorded_coordinate',
              current_bounds: resolvedTarget?.bounds || '',
              point: { x: tapX, y: tapY },
              click_method: clickMethod
            });
            params.x = tapX; params.y = tapY;
            cmd = `adb -s ${actionDeviceId} shell input tap ${tapX} ${tapY}`;
            if (action === 'double_tap') {
              cmd += ` && sleep 0.1 && adb -s ${actionDeviceId} shell input tap ${params.x} ${params.y}`;
            } else if (action === 'long_press') {
              cmd = `adb -s ${actionDeviceId} shell input swipe ${params.x} ${params.y} ${params.x} ${params.y} 1000`;
            }
            // Execute live taps immediately. A UIAutomator dump can take
            // multiple seconds and must not block the device interaction.
            locatorPromise = refreshCachedXmlHierarchy(actionDeviceId)
              .then(xml => getElementAtCoordinates(actionDeviceId, params.x, params.y, xml || true))
              .catch(() => getElementAtCoordinates(actionDeviceId, params.x, params.y, true));
          } else if (action === 'type' || action === 'fill') {
            // Never type into whichever field happens to retain focus after a
            // scroll. Re-resolve the recorded input against the *current* UI
            // hierarchy and explicitly focus that exact element first.
            const currentXml = await refreshCachedXmlHierarchy(actionDeviceId).catch(() => '');
            const focusedInput = await getFocusedElement(actionDeviceId, currentXml).catch(() => null);
            const activeFocusedInput = activePlaybackInputTarget && focusedInput && sameEditableTarget(activePlaybackInputTarget, focusedInput)
              ? focusedInput
              : null;
            const coordinateInput = Number.isFinite(Number(params.x)) && Number.isFinite(Number(params.y))
              ? await getElementAtCoordinates(actionDeviceId, Number(params.x), Number(params.y), currentXml).catch(() => null)
              : null;
            const resolvedInput = (params.useActiveInputTarget ? activeFocusedInput : null) ||
              resolveRecordedTarget(currentXml, params) ||
              (/EditText|TextInput|AutoCompleteTextView/i.test(coordinateInput?.className || '') ? coordinateInput : null) ||
              activeFocusedInput;
            const intended = params.useActiveInputTarget && activePlaybackInputTarget
              ? activePlaybackInputTarget
              : (params.target || params.node || {});
            const intendedName = intended.resourceId || intended.contentDescription || intended.accessibilityId || intended.text || params.locator?.primary?.value || 'recorded input';
            if (!resolvedInput || !/EditText|TextInput|AutoCompleteTextView/i.test(resolvedInput.className || '')) {
              throw new Error(`[Playback][Type] Refusing to type "${params.text ?? ''}" because recorded target "${intendedName}" is not a visible editable field after the current layout/scroll state.`);
            }
            const targetIdMatches = !intended.resourceId || resolvedInput.resourceId === intended.resourceId;
            const targetDescMatches = !intended.contentDescription && !intended.accessibilityId || resolvedInput.contentDescription === (intended.contentDescription || intended.accessibilityId);
            if (!targetIdMatches || !targetDescMatches) {
              throw new Error(`[Playback][Type] Resolved field does not match recorded target "${intendedName}". Resolved resource-id="${resolvedInput.resourceId || ''}", content-desc="${resolvedInput.contentDescription || ''}". Refusing to type into a different field.`);
            }
            console.log('[Playback][Type] target resolved', {
              target: intendedName,
              locatorUsed: resolvedInput.locatorUsed,
              currentBounds: resolvedInput.bounds,
              className: resolvedInput.className,
              resourceId: resolvedInput.resourceId,
              contentDescription: resolvedInput.contentDescription,
              text: resolvedInput.text
            });
            await runCmd(`adb -s ${actionDeviceId} shell input tap ${resolvedInput.x} ${resolvedInput.y}`);
            let ready = await waitUntilInputReady(actionDeviceId, params, resolvedInput);
            if (!ready?.targetMatchesFocus) {
              const retryXml = await refreshCachedXmlHierarchy(actionDeviceId).catch(() => '');
              const retryTarget = resolveRecordedTarget(retryXml, params);
              if (!retryTarget || !sameEditableTarget(resolvedInput, retryTarget)) {
                throw new Error(`[Playback][Type] Input readiness timed out and the original target could not be safely re-resolved.`);
              }
              console.warn('[MOBILE_PLAYBACK][INPUT_RETRY] Refocusing original editable target', { resourceId: retryTarget.resourceId, reason: 'focus-not-ready' });
              await runCmd(`adb -s ${actionDeviceId} shell input tap ${retryTarget.x} ${retryTarget.y}`);
              ready = await waitUntilInputReady(actionDeviceId, params, retryTarget, 3000);
              if (!ready?.targetMatchesFocus) throw new Error(`[Playback][Type] Original editable target did not become focused.`);
            }
            // Do not replay a character stream reconstructed from getevent.
            // `params.text` is the committed UIAutomator value captured from
            // the focused field. Quote it as one shell argument so names and
            // locations retain their exact character order.
            const inputText = String(params.text ?? params.value ?? '').replace(/ /g, '%s');
            const shellQuotedText = `'${inputText.replace(/'/g, `'\\''`)}'`;
            const valueBeforeInput = ready?.focused?.text || '';
            const moveCursorToEnd = `adb -s ${actionDeviceId} shell input keyevent 123`;
            const deleteExisting = params.replaceText === true && valueBeforeInput
              ? Array.from(valueBeforeInput).map(() => `adb -s ${actionDeviceId} shell input keyevent 67`).join(' && ')
              : '';
            cmd = `${moveCursorToEnd}${deleteExisting ? ` && ${deleteExisting}` : ''} && adb -s ${actionDeviceId} shell input text ${shellQuotedText}`;
            locatorAttr = ready?.target || resolvedInput;
          } else if (action === 'clear') {
            cmd = `adb -s ${actionDeviceId} shell input keyevent 67`.repeat(25).replace(/adb/g, '&& adb').substring(3);
          } else if (action === 'swipe' || action === 'scroll') {
            const gesture = params.swipe || params;
            const asNumber = value => value === null || value === undefined || value === '' ? NaN : Number(value);
            const recordedX1 = asNumber(gesture.x1 ?? gesture.startX ?? gesture.start?.x);
            const recordedY1 = asNumber(gesture.y1 ?? gesture.startY ?? gesture.start?.y);
            const recordedX2 = asNumber(gesture.x2 ?? gesture.endX ?? gesture.end?.x);
            const recordedY2 = asNumber(gesture.y2 ?? gesture.endY ?? gesture.end?.y);
            const currentScreen = await getDeviceBounds(actionDeviceId);
            const normalizedX1 = asNumber(gesture.normalizedX1 ?? gesture.normalizedStartX);
            const normalizedY1 = asNumber(gesture.normalizedY1 ?? gesture.normalizedStartY);
            const normalizedX2 = asNumber(gesture.normalizedX2 ?? gesture.normalizedEndX);
            const normalizedY2 = asNumber(gesture.normalizedY2 ?? gesture.normalizedEndY);
            const recordedWidth = asNumber(gesture.screenWidth);
            const recordedHeight = asNumber(gesture.screenHeight);
            let x1 = Number.isFinite(normalizedX1) ? Math.round(normalizedX1 * currentScreen.displayWidth) : (Number.isFinite(recordedWidth) ? Math.round(recordedX1 * currentScreen.displayWidth / recordedWidth) : recordedX1);
            let y1 = Number.isFinite(normalizedY1) ? Math.round(normalizedY1 * currentScreen.displayHeight) : (Number.isFinite(recordedHeight) ? Math.round(recordedY1 * currentScreen.displayHeight / recordedHeight) : recordedY1);
            let x2 = Number.isFinite(normalizedX2) ? Math.round(normalizedX2 * currentScreen.displayWidth) : (Number.isFinite(recordedWidth) ? Math.round(recordedX2 * currentScreen.displayWidth / recordedWidth) : recordedX2);
            let y2 = Number.isFinite(normalizedY2) ? Math.round(normalizedY2 * currentScreen.displayHeight) : (Number.isFinite(recordedHeight) ? Math.round(recordedY2 * currentScreen.displayHeight / recordedHeight) : recordedY2);
            if (![x1, y1, x2, y2].every(Number.isFinite)) {
              throw new Error(`[Playback][Swipe] Missing recorded coordinates: ${JSON.stringify(gesture)}`);
            }
            if (Math.abs(y2 - y1) >= Math.abs(x2 - x1)) {
              const lockedX = Math.round((x1 + x2) / 2);
              x1 = lockedX; x2 = lockedX;
            } else {
              const lockedY = Math.round((y1 + y2) / 2);
              y1 = lockedY; y2 = lockedY;
            }
            console.log(`[Playback][Swipe] (${recordedX1},${recordedY1}) -> (${recordedX2},${recordedY2}) resolved for ${currentScreen.displayWidth}x${currentScreen.displayHeight} as (${x1},${y1}) -> (${x2},${y2})`);
            const appiumExecuted = await performAppiumSwipe(actionDeviceId, x1, y1, x2, y2, gesture.duration || 300);
            cmd = appiumExecuted
              ? ':'
              : `adb -s ${actionDeviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${gesture.duration || 300}`;
            // Anchor the gesture to the element it started on
            const preXml = await getHierarchyBeforeGesture(actionDeviceId);
            locatorAttr = await getElementAtCoordinates(actionDeviceId, x1, y1, preXml).catch(() => null);
          } else if (action === 'press') {
            let keycode = 4; // Back default
            if (params.key === 'Home') keycode = 3;
            else if (params.key === 'Recents') keycode = 187;
            else if (params.key === 'VolumeUp') keycode = 24;
            else if (params.key === 'VolumeDown') keycode = 25;
            else if (params.key === 'Power') keycode = 26;
            else if (params.key === 'Enter') keycode = 66;
            cmd = `adb -s ${actionDeviceId} shell input keyevent ${keycode}`;
          } else if (action === 'launch' || action === 'launch_app' || action === 'open_app') {
            const pkg = params.packageName || 'com.machaxi.app';
            const targetDev = (params.deviceId && !params.deviceId.includes(' ') && params.deviceId.length < 30) ? params.deviceId : deviceId;
            console.log(`[ADB Agent] Launching package "${pkg}" on target ADB device "${targetDev}"...`);

            // Wake up screen & dismiss keyguard lock
            await runCmd(`adb -s ${targetDev} shell input keyevent 224`);
            await runCmd(`adb -s ${targetDev} shell wm dismiss-keyguard`);

            // Check if package is installed first
            const pkgCheck = await runCmd(`adb -s ${targetDev} shell pm list packages ${pkg}`);
            const isInstalled = pkgCheck.stdout && pkgCheck.stdout.includes(pkg);

            if (!isInstalled) {
              const msg = `[ADB Warning] Package "${pkg}" is not installed on device ${targetDev}.`;
              console.warn(msg);
              await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
                email: userEmail,
                log: msg,
                type: 'warn',
                url: 'ADB'
              }).catch(() => {});
            } else {
              // Primary: Monkey launcher (resolves default activity automatically)
              let launchRes = await runCmd(`adb -s ${targetDev} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);

              if (!launchRes.success || (launchRes.stdout && launchRes.stdout.includes('No activities found'))) {
                const act = params.launchActivity || '.MainActivity';
                launchRes = await runCmd(`adb -s ${targetDev} shell am start -n ${pkg}/${act}`);
                if (!launchRes.success || (launchRes.stderr && launchRes.stderr.includes('Error'))) {
                  await runCmd(`adb -s ${targetDev} shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg}`);
                }
              }

              console.log(`[ADB Agent] App launch command executed for ${pkg}`);
              await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
                email: userEmail,
                log: `[ADB] Launched application "${pkg}" on device ${targetDev}`,
                type: 'info',
                url: 'ADB'
              }).catch(() => {});
            }
            cmd = '';
          }

          if (cmd) {
            // Do not await the hierarchy lookup before dispatching the action.
            // That lookup is intentionally a pre-action snapshot; waiting here
            // lets a stale cached dump win and delays the actual tap.
            if (params.recordStep === false && (action === 'click' || action === 'tap' || action === 'double_tap' || action === 'long_press' || action === 'swipe' || action === 'scroll')) {
              suppressInjectedTouchUntil = Date.now() + 1800;
              // The React inspector has already stored the intended target and
              // exact touch point. Block the physical event mirror long enough
              // for ADB/getevent delivery, rather than trying to re-resolve it.
              browserDrivenCommandUntil = Date.now() + 5000;
              if (action === 'swipe' || action === 'scroll') {
                // getevent reports the release endpoint for a gesture.
                markInjectedTouch(params.x2, params.y2, action);
              } else {
                markInjectedTouch(params.x, params.y, action);
                if (action === 'double_tap') markInjectedTouch(params.x, params.y, action);
              }
            }
            const commandResult = await runCmd(cmd);

            if (action === 'swipe' || action === 'scroll') {
              // Let momentum/animated scrolling finish before resolving the
              // next click or comparing against the recorded destination.
              await new Promise(resolve => setTimeout(resolve, 700));
              await refreshCachedXmlHierarchy(actionDeviceId).catch(() => '');
            }

            // Resolve the node after the ADB command has already been sent. The
            // promise started before the tap, so it describes the tapped screen.
            if (locatorPromise) {
              locatorAttr = await locatorPromise.catch(() => null);
            }
            if ((action === 'click' || action === 'tap') && locatorAttr && /EditText|TextInput|AutoCompleteTextView/i.test(locatorAttr.className || '')) {
              activePlaybackInputTarget = { ...locatorAttr };
              console.log('[MOBILE_PLAYBACK][INPUT_SESSION] latched editable target', {
                resourceId: locatorAttr.resourceId || '', contentDescription: locatorAttr.contentDescription || '',
                className: locatorAttr.className || '', bounds: locatorAttr.bounds || ''
              });
            } else if (action !== 'fill' && action !== 'type') {
              activePlaybackInputTarget = null;
            }
            // Associate the event with the frame produced by this action, not
            // whatever frame happened to be cached from the prior step.
            const actionScreenshot = await captureScreenshot(actionDeviceId).catch(() => null);
            const actionFrameCapturedAt = Date.now();
            // A completion is valid only after its own screenshot is visible
            // to the server. This prevents playback from verifying a stale
            // frame and rushing into the following step.
            if (actionScreenshot) {
              lastCapturedFrame = actionScreenshot;
              await postJson(`${serverUrl}/api/device-agent/upload-frame`, {
                email: userEmail,
                frame: actionScreenshot,
                capturedAt: actionFrameCapturedAt
              }).catch(() => {});
            }

            await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
              email: userEmail,
              log: `[ADB] Executed ${action.toUpperCase()} on target device ${actionDeviceId}`,
              type: 'info',
              url: 'ADB'
            }).catch(() => {});

            // Browser-inspector taps are recorded before dispatch so the UI is
            // responsive. In that case only execute the ADB action here.
            if (params.recordStep === false) {
              await postJson(`${serverUrl}/api/device-agent/action-result`, {
                actionId: item.id,
                success: commandResult?.success !== false,
                error: commandResult?.success === false ? (commandResult.stderr || commandResult.stdout || `ADB ${action} command failed`) : undefined,
                frameCapturedAt: actionScreenshot ? actionFrameCapturedAt : undefined
              }).catch(() => {});
              continue;
            }

            const labelName = getAndroidElementName(locatorAttr) || 'Screen position';
            const stepPayload = {
              email: userEmail,
              event: {
                id: Math.random().toString(36).substring(7),
                action: action === 'type' ? 'fill' : action,
                value: params.text || params.key || (action === 'swipe' ? 'Swipe Gesture' : undefined),
                elementName: labelName,
                locator: {
                  primary: {
                    type: locatorAttr?.primaryType || 'xpath',
                    value: locatorAttr?.primaryValue || locatorAttr?.xpath || `//android.view.View`,
                    playwright: locatorAttr?.playwrightScript || ((action === 'click' || action === 'tap')
                      ? `await driver.touchPerform([{ action: 'tap', options: { x: ${params.x}, y: ${params.y} } }]);`
                      : action === 'fill' || action === 'type'
                        ? `await driver.keys("${params.text || ''}");`
                        : `await driver.pressKeyCode(4);`)
                  },
                  alternatives: [
                    locatorAttr?.text ? { type: 'text', value: locatorAttr.text } : null,
                    locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
                    locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
                    locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null,
                    params.x !== undefined && params.y !== undefined
                      ? { type: 'coordinates', value: JSON.stringify({ x: params.x, y: params.y, unit: 'pixels' }) }
                      : null
                  ].filter(Boolean)
                },
                // Records whether this step points at a real node from the app's
                // UI hierarchy, or only at screen coordinates
                resolvedFromHierarchy: !!locatorAttr,
                className: locatorAttr?.className,
                screen: "ActiveScreen",
                platform: 'mobile',
                x: params.x,
                y: params.y,
                timestamp: Date.now(),
                screenshot: actionScreenshot || undefined
              }
            };

            await postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn(`[Stream/Polling Error] ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// Start local HTTP server on port 4545 for direct browser requests
function startLocalHttpDaemon() {
  const localServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    const parsedUrl = new URL(req.url, 'http://localhost:4545');

    if (parsedUrl.pathname === '/status') {
      const devices = await scanDevices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ running: true, port: 4545, devices, email: userEmail }));
    }

    if (parsedUrl.pathname === '/devices') {
      const devices = await scanDevices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(devices.map(d => ({
        id: d.deviceId,
        name: d.deviceName,
        androidVersion: d.version,
        status: d.status,
        type: d.type
      }))));
    }

    if (parsedUrl.pathname === '/installed-apps') {
      const devId = parsedUrl.searchParams.get('deviceId') || 'emulator-5554';
      const pkgCmd = await runCmd(`adb -s ${devId} shell pm list packages -3`);
      const pkgs = [];
      if (pkgCmd.success && pkgCmd.stdout) {
        const lines = pkgCmd.stdout.split('\n');
        for (const l of lines) {
          const clean = l.replace('package:', '').trim();
          if (clean) {
            const parts = clean.split('.');
            const name = parts[parts.length - 1];
            pkgs.push({
              name: name.charAt(0).toUpperCase() + name.slice(1),
              package: clean
            });
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(pkgs));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  localServer.listen(4545, () => {
    console.log('🟢 [Local Daemon] Running on http://localhost:4545');
  });

  localServer.on('error', (e) => {
    console.log(`[Local Daemon Note] Port 4545 in use or unavailable: ${e.message}`);
  });
}

async function main() {
  await checkAdb();
  startLocalHttpDaemon();
  startHeartbeat();
  startStreamingAndCommandPolling();
  console.log('AutomatiQA Device Agent initialized and listening for hardware interactions.');
}

main();
