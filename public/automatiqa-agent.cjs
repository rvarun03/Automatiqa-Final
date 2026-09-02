/**
 * AutomatiQA Device Agent (Real-Time ADB Streaming & Action Bridge - CommonJS)
 * -----------------------------------------------------------------------------
 * Companion script for local USB devices and Android Studio emulators (e.g. emulator-5554)
 * to stream real Android application screens directly to AutomatiQA and handle touch/input actions.
 */

const { exec } = require('child_process');
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

const userEmail = args.email || 'shanmugapriya@qaoncloud.com';
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
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
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
    const version = versionRes.success ? versionRes.stdout.trim() : '14';

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
        // Fallback method via sdcard
        const tempPath = path.join(__dirname || '.', `screencap_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        runCmd(`adb -s ${deviceId} shell screencap -p /sdcard/screencap.png`).then(() => {
          runCmd(`adb -s ${deviceId} pull /sdcard/screencap.png "${tempPath}"`).then(() => {
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

// Cache of the live UIAutomator hierarchy, so a gesture can be resolved against
// the screen as it was before that gesture was applied
let cachedXmlHierarchy = { time: 0, xml: '' };

// Framework-owned containers. They exist on every Android screen, so targeting
// one identifies nothing about the app under test and makes a generated script
// tap the root view instead of the control the user actually touched.
const NON_TARGETABLE_IDS = new Set([
  'android:id/content',
  'android:id/decor_content_parent',
  'android:id/action_bar_root',
  'android:id/navigationBarBackground',
  'android:id/statusBarBackground',
  'com.android.systemui:id/navigation_bar_frame'
]);

function isTargetableNode(attrs) {
  if (!attrs) return false;
  const resourceId = attrs.resourceId || '';
  if (resourceId && !NON_TARGETABLE_IDS.has(resourceId) && !resourceId.startsWith('android:id/')) return true;
  return !!(attrs.text || attrs.contentDescription) && resourceId !== 'android:id/content';
}

async function dumpUiHierarchy(deviceId) {
  const tempPath = path.join(__dirname || '.', `window_dump_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.xml`);
  const dumpRes = await runCmd(`adb -s ${deviceId} shell uiautomator dump /sdcard/window_dump.xml`);
  if (!dumpRes.success) return '';

  const pullRes = await runCmd(`adb -s ${deviceId} pull /sdcard/window_dump.xml "${tempPath}"`);
  if (!pullRes.success) return '';

  try {
    if (fs.existsSync(tempPath)) {
      const xmlContent = fs.readFileSync(tempPath, 'utf8');
      fs.unlinkSync(tempPath);
      if (xmlContent && xmlContent.includes('<hierarchy')) {
        cachedXmlHierarchy = { time: Date.now(), xml: xmlContent };
        return xmlContent;
      }
    }
  } catch (err) {
    console.error('Failed to read window XML dump:', err.message);
  }
  return '';
}

// Resolving a tap against a dump taken after it would describe the screen the tap
// opened, so a snapshot from just before the gesture is always preferred.
async function getHierarchyBeforeGesture(deviceId) {
  if (cachedXmlHierarchy.xml && Date.now() - cachedXmlHierarchy.time < 2500) return cachedXmlHierarchy.xml;
  return (await dumpUiHierarchy(deviceId)) || cachedXmlHierarchy.xml || '';
}

async function getElementAtCoordinates(deviceId, x, y, preloadedXml) {
  try {
    const xmlContent = preloadedXml || await dumpUiHierarchy(deviceId);
    if (xmlContent) {

      const nodeRegex = /<node[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>/g;
      let match;
      // A tap lands inside a whole stack of nested nodes. The innermost is often
      // an anonymous wrapper (an ImageView inside a button) that no test could
      // target, so identifiable nodes are chosen first and raw geometry only as
      // a fallback.
      let bestIdentifiable = null;
      let bestIdentifiableArea = Infinity;
      let bestAny = null;
      let bestAnyArea = Infinity;

      while ((match = nodeRegex.exec(xmlContent)) !== null) {
        const nodeStr = match[0];
        const x1 = parseInt(match[1], 10);
        const y1 = parseInt(match[2], 10);
        const x2 = parseInt(match[3], 10);
        const y2 = parseInt(match[4], 10);

        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
          const area = (x2 - x1) * (y2 - y1);
          const entry = { nodeStr, bounds: `[${x1},${y1}][${x2},${y2}]` };

          if (area < bestAnyArea) {
            bestAnyArea = area;
            bestAny = entry;
          }

          // Something a generated test can actually locate by
          const readAttr = (name) => {
            const m = nodeStr.match(new RegExp(`${name}="([^"]*)"`));
            return m ? m[1] : '';
          };
          const candidate = {
            resourceId: readAttr('resource-id'),
            text: readAttr('text'),
            contentDescription: readAttr('content-desc')
          };
          if (isTargetableNode(candidate) && area < bestIdentifiableArea) {
            bestIdentifiableArea = area;
            bestIdentifiable = entry;
          }
        }
      }

      // Never fall back to a framework container. Reporting no element keeps the
      // step honest as a coordinate tap instead of emitting a locator that would
      // click the root view on playback.
      const best = bestIdentifiable || bestAny;
      if (!best) return null;
      if (!bestIdentifiable) {
        const rootId = (best.nodeStr.match(/resource-id="([^"]*)"/) || [])[1] || '';
        if (NON_TARGETABLE_IDS.has(rootId) || rootId.startsWith('android:id/')) return null;
      }
      const bestNodeStr = best.nodeStr;
      const bestBounds = best.bounds;

      const getAttr = (name) => {
        const regex = new RegExp(`${name}="([^"]*)"`);
        const m = bestNodeStr.match(regex);
        return m ? m[1] : '';
      };

      const resourceId = getAttr('resource-id');
      const contentDescription = getAttr('content-desc');
      const text = getAttr('text');
      const className = getAttr('class') || 'android.view.View';

      let xpath = '';
      let primaryType = 'xpath';
      let primaryValue = '';
      if (resourceId) {
        primaryType = 'resource-id';
        primaryValue = resourceId;
        xpath = `//${className}[@resource-id="${resourceId}"]`;
      } else if (contentDescription) {
        primaryType = 'accessibility-id';
        primaryValue = contentDescription;
        xpath = `//${className}[@content-desc="${contentDescription}"]`;
      } else if (text) {
        primaryType = 'text';
        primaryValue = text;
        xpath = `//${className}[@text="${text}"]`;
      } else {
        xpath = `//${className}[@bounds="${bestBounds}"]`;
        primaryValue = xpath;
      }

      return {
        resourceId,
        accessibilityId: contentDescription || resourceId || undefined,
        contentDescription,
        text,
        className,
        bounds: bestBounds,
        clickable: /clickable="true"/.test(bestNodeStr),
        xpath,
        primaryType,
        primaryValue
      };
    }
  } catch (err) {
    console.error('Failed to parse window XML dump:', err);
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
      if (!/focused="true"/.test(attrs)) continue;
      const boundsMatch = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
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
  return target
    ? `await (await ${target}).click();`
    : `await driver.touchPerform([{ action: 'tap', options: { x: ${params.x}, y: ${params.y} } }]);`;
}

function getAndroidElementName(locatorAttr) {
  if (!locatorAttr) return '';
  const semanticName = locatorAttr.text || locatorAttr.contentDescription || locatorAttr.accessibilityId;
  if (semanticName && String(semanticName).trim()) return String(semanticName).trim();
  if (locatorAttr.resourceId) {
    const id = String(locatorAttr.resourceId).split(/[:\/]id\//).pop() || String(locatorAttr.resourceId);
    return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  const className = String(locatorAttr.className || '').split('.').pop();
  return className && className !== 'View' ? className.replace(/([a-z])([A-Z])/g, '$1 $2') : '';
}

let agentRunning = true;
let activeRecordingSession = null;
let lastUploadedFrameTime = 0;
let lastUploadedHierarchyTime = 0;

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

async function startStreamingAndCommandPolling() {
  while (agentRunning) {
    try {
      const devices = await scanDevices();
      if (devices.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const deviceId = devices[0].deviceId;

      // 1. Continuously capture & stream screenshots to AutomatiQA backend
      const now = Date.now();
      if (now - lastUploadedFrameTime >= 400) {
        const frame = await captureScreenshot(deviceId);
        if (frame) {
          await postJson(`${serverUrl}/api/device-agent/upload-frame`, {
            email: userEmail,
            frame
          });
          lastUploadedFrameTime = now;
        }
      }

      // 1b. Stream the real UIAutomator hierarchy so the recorder can resolve
      // taps to actual app nodes instead of raw screen coordinates.
      if (now - lastUploadedHierarchyTime >= 1500) {
        lastUploadedHierarchyTime = now;
        const xml = await dumpUiHierarchy(deviceId).catch(() => '');
        if (xml) {
          await postJson(`${serverUrl}/api/device-agent/upload-hierarchy`, {
            email: userEmail,
            xml,
            deviceId
          }).catch(() => {});
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

          if (action === 'click' || action === 'tap' || action === 'double_tap' || action === 'long_press') {
            cmd = `adb -s ${actionDeviceId} shell input tap ${params.x} ${params.y}`;
            if (action === 'double_tap') {
              cmd += ` && sleep 0.1 && adb -s ${actionDeviceId} shell input tap ${params.x} ${params.y}`;
            } else if (action === 'long_press') {
              cmd = `adb -s ${actionDeviceId} shell input swipe ${params.x} ${params.y} ${params.x} ${params.y} 1000`;
            }
            // Resolve against the screen as it is BEFORE the gesture. Dumping
            // afterwards would describe whatever screen the tap navigated to.
            const preXml = await getHierarchyBeforeGesture(actionDeviceId);
            locatorAttr = await getElementAtCoordinates(actionDeviceId, params.x, params.y, preXml).catch(() => null);
          } else if (action === 'type' || action === 'fill') {
            const escaped = (params.text || '').replace(/ /g, '%s');
            cmd = `adb -s ${actionDeviceId} shell input text "${escaped}"`;
            // Text lands in the focused field, so that node identifies the step
            const preXml = await getHierarchyBeforeGesture(actionDeviceId);
            locatorAttr = await getFocusedElement(actionDeviceId, preXml).catch(() => null);
          } else if (action === 'clear') {
            cmd = `adb -s ${actionDeviceId} shell input keyevent 67`.repeat(25).replace(/adb/g, '&& adb').substring(3);
          } else if (action === 'swipe' || action === 'scroll') {
            cmd = `adb -s ${actionDeviceId} shell input swipe ${params.x1} ${params.y1} ${params.x2} ${params.y2} ${params.duration || 300}`;
            // Anchor the gesture to the element it started on
            const preXml = await getHierarchyBeforeGesture(actionDeviceId);
            locatorAttr = await getElementAtCoordinates(actionDeviceId, params.x1, params.y1, preXml).catch(() => null);
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
            const pkg = params.packageName || 'com.android.chrome';
            cmd = `adb -s ${deviceId} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`;
          } else if (action === 'orientation') {
            const rot = params.landscape ? 1 : 0;
            await runCmd(`adb -s ${deviceId} shell content insert --uri content://settings/system --bind name:s:accelerometer_rotation --bind value:i:0`);
            cmd = `adb -s ${deviceId} shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:${rot}`;
          }

          if (cmd) {
            await runCmd(cmd);

            // The gesture changed the screen, so the cached hierarchy is stale
            cachedXmlHierarchy = { time: 0, xml: cachedXmlHierarchy.xml };

            await postJson(`${serverUrl}/api/device-agent/upload-logs`, {
              email: userEmail,
              log: `[ADB] Executed ${action.toUpperCase()} on target device ${actionDeviceId}`,
              type: 'info',
              url: 'ADB'
            });

            const labelName = getAndroidElementName(locatorAttr) || 'Unlabelled Android element';
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
                    playwright: buildAppiumScript(action, locatorAttr, params),
                    bounds: locatorAttr?.bounds
                  },
                  alternatives: [
                    locatorAttr?.text ? { type: 'text', value: locatorAttr.text } : null,
                    locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
                    locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
                    locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null
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
                timestamp: Date.now()
              }
            };

            await postJson(`${serverUrl}/api/device-agent/record-event`, stepPayload);
          }
        }
      }
    } catch (err) {
      console.error('Streaming and command loop error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function main() {
  const adbOk = await checkAdb();
  if (adbOk) {
    startHeartbeat();
    startStreamingAndCommandPolling();
    console.log(`\nDevice Agent is fully initialized and listening! Connected to ${serverUrl}. Keep this terminal open.`);
  } else {
    console.log('Ensure Android SDK Platform-Tools are installed and "adb" is in system PATH.');
  }
}

main();
