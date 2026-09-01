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

console.log('====================================================');
console.log('       AUTOMATIQA DEVICE AGENT (REAL-TIME ADB STREAM)');
console.log('====================================================');
console.log(`User Email : ${userEmail}`);
console.log(`Server URL : ${serverUrl}`);
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

async function getElementAtCoordinates(deviceId, x, y) {
  try {
    const now = Date.now();
    let xmlContent = '';

    // Dump window hierarchy to /data/local/tmp/window_dump.xml
    const dumpRes = await runCmd(`adb -s ${deviceId} shell uiautomator dump /data/local/tmp/window_dump.xml`);
    if (dumpRes.success) {
      const readRes = await runCmd(`adb -s ${deviceId} shell cat /data/local/tmp/window_dump.xml`);
      if (readRes.success && readRes.stdout && readRes.stdout.includes('<hierarchy')) {
        xmlContent = readRes.stdout;
        cachedXmlHierarchy = { time: now, xml: xmlContent };
      }
    }

    if (!xmlContent && now - cachedXmlHierarchy.time < 10000 && cachedXmlHierarchy.xml) {
      xmlContent = cachedXmlHierarchy.xml;
    }

    if (!xmlContent) return null;

    // Parse nodes and bounds [x1,y1][x2,y2]
    const nodeRegex = /<node\s+([^>]*)\s*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"([^>]*)\/?>/g;
    let match;
    let bestNodeAttributes = null;
    let smallestArea = Infinity;

    while ((match = nodeRegex.exec(xmlContent)) !== null) {
      const allAttrs = (match[1] + ' ' + match[6]).trim();
      const x1 = parseInt(match[2], 10);
      const y1 = parseInt(match[3], 10);
      const x2 = parseInt(match[4], 10);
      const y2 = parseInt(match[5], 10);

      // Check if tap point is inside this node's bounds
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const width = x2 - x1;
        const height = y2 - y1;
        const area = width * height;

        // Extract attributes
        const getAttr = (name) => {
          const m = allAttrs.match(new RegExp(`${name}="([^"]*)"`));
          return m ? m[1] : '';
        };

        const isClickable = getAttr('clickable') === 'true';
        const hasText = !!getAttr('text');
        const hasDesc = !!getAttr('content-desc');

        // Prefer clickable or labeled elements
        let areaScore = area;
        if (isClickable || hasText || hasDesc) {
          areaScore = area * 0.8; // Give priority
        }

        if (areaScore < smallestArea) {
          smallestArea = areaScore;
          bestNodeAttributes = {
            resourceId: getAttr('resource-id'),
            contentDescription: getAttr('content-desc'),
            text: getAttr('text'),
            className: getAttr('class') || 'android.view.View',
            clickable: isClickable,
            bounds: `[${x1},${y1}][${x2},${y2}]`
          };
        }
      }
    }

    if (!bestNodeAttributes) return null;

    const { resourceId, contentDescription, text, className } = bestNodeAttributes;
    let xpath = '';
    let primaryType = 'xpath';
    let primaryValue = '';
    let playwrightScript = '';

    if (text) {
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
      primaryValue = `//${className}[@bounds="${bestNodeAttributes.bounds}"]`;
      xpath = primaryValue;
      playwrightScript = `await driver.elementByXPath("${xpath}").click();`;
    }

    return {
      resourceId,
      accessibilityId: contentDescription || undefined,
      contentDescription,
      text,
      className,
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
let touchListenerProcess = null;
let currentListeningDevice = null;
let touchDeviceBounds = { displayWidth: 1080, displayHeight: 2400, touchMaxX: 1080, touchMaxY: 2400 };

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
let lastTrackedActivity = '';

function flushTypingBuffer(deviceId) {
  if (!typingBuffer) return;
  const typedText = typingBuffer;
  typingBuffer = '';

  const stepPayload = {
    email: userEmail,
    event: {
      id: Math.random().toString(36).substring(7),
      action: 'fill',
      value: typedText,
      elementName: lastFocusedElement?.text || lastFocusedElement?.resourceId || `Input text: "${typedText}"`,
      locator: {
        primary: {
          type: lastFocusedElement?.primaryType || 'xpath',
          value: lastFocusedElement?.primaryValue || lastFocusedElement?.xpath || `//android.widget.EditText`,
          playwright: lastFocusedElement?.resourceId 
            ? `await driver.elementById("${lastFocusedElement.resourceId}").sendKeys("${typedText}");`
            : `await driver.elementByXPath("//android.widget.EditText").sendKeys("${typedText}");`
        },
        alternatives: [
          lastFocusedElement?.resourceId ? { type: 'resource-id', value: lastFocusedElement.resourceId } : null,
          lastFocusedElement?.xpath ? { type: 'xpath', value: lastFocusedElement.xpath } : null
        ].filter(Boolean)
      },
      screen: lastTrackedActivity || "ActiveScreen",
      platform: 'mobile',
      timestamp: Date.now()
    }
  };

  console.log(`🟢 [ADB Recorded Step] Action: TYPE/FILL "${typedText}"`);
  postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload).catch(() => {});
  postJson(`${serverUrl}/api/mobile/agent/record-event`, stepPayload).catch(() => {});
  postJson(`${serverUrl}/api/device-agent/upload-logs`, {
    email: userEmail,
    log: `[ADB Step Captured] TYPE "${typedText}" into input element`,
    type: 'info',
    url: 'ADB'
  }).catch(() => {});
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

  try {
    touchListenerProcess = spawn('adb', ['-s', deviceId, 'shell', 'getevent', '-l']);
    let buffer = '';

    touchListenerProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;

        // Parse X coordinate (ABS_MT_POSITION_X, ABS_X, 0035, 0000)
        if (line.includes('ABS_MT_POSITION_X') || line.includes('ABS_X') || line.includes('0035 ') || line.includes('0000 ')) {
          const parts = line.trim().split(/\s+/);
          const hexVal = parts[parts.length - 1];
          const val = parseInt(hexVal, 16);
          if (!isNaN(val)) {
            currentRawX = val;
            lastSeenRawX = val;
            if (currentRawX > touchDeviceBounds.touchMaxX && touchDeviceBounds.touchMaxX <= touchDeviceBounds.displayWidth) {
              touchDeviceBounds.touchMaxX = Math.max(32767, currentRawX);
            }
          }
        } 
        // Parse Y coordinate (ABS_MT_POSITION_Y, ABS_Y, 0036, 0001)
        else if (line.includes('ABS_MT_POSITION_Y') || line.includes('ABS_Y') || line.includes('0036 ') || line.includes('0001 ')) {
          const parts = line.trim().split(/\s+/);
          const hexVal = parts[parts.length - 1];
          const val = parseInt(hexVal, 16);
          if (!isNaN(val)) {
            currentRawY = val;
            lastSeenRawY = val;
            if (currentRawY > touchDeviceBounds.touchMaxY && touchDeviceBounds.touchMaxY <= touchDeviceBounds.displayHeight) {
              touchDeviceBounds.touchMaxY = Math.max(32767, currentRawY);
            }
          }
        } 
        // Touch / Mouse Down
        else if ((line.includes('BTN_TOUCH') || line.includes('BTN_LEFT') || line.includes('BTN_MOUSE')) && line.includes('DOWN')) {
          isTouching = true;
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

                handlePhysicalEmulatorTap(deviceId, screenX, screenY);
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
              flushTypingBuffer(deviceId);
            } else if (keyName === 'KEY_BACKSPACE') {
              typingBuffer = typingBuffer.slice(0, -1);
            } else if (KEY_MAP[keyName]) {
              typingBuffer += KEY_MAP[keyName];
              if (typingTimer) clearTimeout(typingTimer);
              typingTimer = setTimeout(() => {
                flushTypingBuffer(deviceId);
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
        timestamp: Date.now()
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

async function handlePhysicalEmulatorTap(deviceId, x, y) {
  try {
    console.log(`[ADB Tap Event] Detected physical tap at coordinates (${x}, ${y}) on ${deviceId}`);
    const locatorAttr = await getElementAtCoordinates(deviceId, x, y);
    
    const labelName = locatorAttr?.text || locatorAttr?.contentDescription || locatorAttr?.resourceId || `Element at (${x}, ${y})`;
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
            type: locatorAttr?.primaryType || 'xpath',
            value: locatorAttr?.primaryValue || locatorAttr?.xpath || `//android.view.View[@bounds="[${x},${y}]"]`,
            playwright: playwrightCode
          },
          alternatives: [
            locatorAttr?.text ? { type: 'text', value: locatorAttr.text } : null,
            locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
            locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
            locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null
          ].filter(Boolean)
        },
        screen: "ActiveScreen",
        platform: 'mobile',
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
      
      if (res && res.recording) {
        activeRecordingSession = res.recording;
      }
    } catch (e) {
      console.warn(`Connection to AutomatiQA Cloud failed: ${e.message}. Retrying...`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

let lastActivityCheckTime = 0;

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
      if (now - lastUploadedFrameTime >= 400) {
        const frame = await captureScreenshot(deviceId);
        if (frame) {
          await postJson(`${serverUrl}/api/device-agent/upload-frame`, {
            email: userEmail,
            frame
          }).catch(() => {});
          lastUploadedFrameTime = now;
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
            if (lastTrackedActivity && lastTrackedActivity !== currentAct) {
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
          console.log(`Executing Action on Device ${deviceId}: ${action}`, params);

          let cmd = '';
          let locatorAttr = null;

          if (action === 'click' || action === 'tap' || action === 'double_tap' || action === 'long_press') {
            cmd = `adb -s ${deviceId} shell input tap ${params.x} ${params.y}`;
            if (action === 'double_tap') {
              cmd += ` && sleep 0.1 && adb -s ${deviceId} shell input tap ${params.x} ${params.y}`;
            } else if (action === 'long_press') {
              cmd = `adb -s ${deviceId} shell input swipe ${params.x} ${params.y} ${params.x} ${params.y} 1000`;
            }
            locatorAttr = await getElementAtCoordinates(deviceId, params.x, params.y);
          } else if (action === 'type' || action === 'fill') {
            const escaped = (params.text || '').replace(/ /g, '%s');
            cmd = `adb -s ${deviceId} shell input text "${escaped}"`;
            locatorAttr = await getElementAtCoordinates(deviceId, params.x || 300, params.y || 300);
          } else if (action === 'clear') {
            cmd = `adb -s ${deviceId} shell input keyevent 67`.repeat(25).replace(/adb/g, '&& adb').substring(3);
          } else if (action === 'swipe' || action === 'scroll') {
            cmd = `adb -s ${deviceId} shell input swipe ${params.x1} ${params.y1} ${params.x2} ${params.y2} ${params.duration || 300}`;
          } else if (action === 'press') {
            let keycode = 4; // Back default
            if (params.key === 'Home') keycode = 3;
            else if (params.key === 'Recents') keycode = 187;
            else if (params.key === 'VolumeUp') keycode = 24;
            else if (params.key === 'VolumeDown') keycode = 25;
            else if (params.key === 'Power') keycode = 26;
            else if (params.key === 'Enter') keycode = 66;
            cmd = `adb -s ${deviceId} shell input keyevent ${keycode}`;
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
            await runCmd(cmd);

            await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
              email: userEmail,
              log: `[ADB] Executed ${action.toUpperCase()} on target device ${deviceId}`,
              type: 'info',
              url: 'ADB'
            }).catch(() => {});

            const labelName = locatorAttr?.text || locatorAttr?.contentDescription || locatorAttr?.resourceId || `Coordinates (${params.x || params.x1 || 0}, ${params.y || params.y1 || 0})`;
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
                    playwright: locatorAttr?.playwrightScript || (action === 'click' ? `await driver.elementByXPath("//android.view.View").click();` : `await driver.pressKeyCode(4);`)
                  },
                  alternatives: [
                    locatorAttr?.text ? { type: 'text', value: locatorAttr.text } : null,
                    locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
                    locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
                    locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null
                  ].filter(Boolean)
                },
                screen: "ActiveScreen",
                platform: 'mobile',
                timestamp: Date.now()
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
