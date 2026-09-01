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

async function getElementAtCoordinates(deviceId, x, y) {
  const tempPath = path.join(__dirname || '.', `window_dump_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.xml`);
  const dumpRes = await runCmd(`adb -s ${deviceId} shell uiautomator dump /sdcard/window_dump.xml`);
  if (!dumpRes.success) return null;

  const pullRes = await runCmd(`adb -s ${deviceId} pull /sdcard/window_dump.xml "${tempPath}"`);
  if (!pullRes.success) return null;

  try {
    if (fs.existsSync(tempPath)) {
      const xmlContent = fs.readFileSync(tempPath, 'utf8');
      fs.unlinkSync(tempPath);

      const nodeRegex = /<node[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>/g;
      let match;
      let bestNodeStr = null;
      let smallestArea = Infinity;

      while ((match = nodeRegex.exec(xmlContent)) !== null) {
        const nodeStr = match[0];
        const x1 = parseInt(match[1], 10);
        const y1 = parseInt(match[2], 10);
        const x2 = parseInt(match[3], 10);
        const y2 = parseInt(match[4], 10);

        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
          const width = x2 - x1;
          const height = y2 - y1;
          const area = width * height;
          if (area < smallestArea) {
            smallestArea = area;
            bestNodeStr = nodeStr;
          }
        }
      }

      if (!bestNodeStr) return null;

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
      if (resourceId) {
        xpath = `//${className}[@resource-id="${resourceId}"]`;
      } else if (text) {
        xpath = `//${className}[@text="${text}"]`;
      } else if (contentDescription) {
        xpath = `//${className}[@content-desc="${contentDescription}"]`;
      } else {
        xpath = `//${className}`;
      }

      return {
        resourceId,
        accessibilityId: contentDescription || resourceId || undefined,
        contentDescription,
        text,
        xpath
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
            cmd = `adb -s ${actionDeviceId} shell input tap ${params.x} ${params.y}`;
            if (action === 'double_tap') {
              cmd += ` && sleep 0.1 && adb -s ${actionDeviceId} shell input tap ${params.x} ${params.y}`;
            } else if (action === 'long_press') {
              cmd = `adb -s ${actionDeviceId} shell input swipe ${params.x} ${params.y} ${params.x} ${params.y} 1000`;
            }
            // Do not block the actual tap on a slow UIAutomator hierarchy dump.
            locatorPromise = getElementAtCoordinates(actionDeviceId, params.x, params.y);
          } else if (action === 'type' || action === 'fill') {
            const escaped = (params.text || '').replace(/ /g, '%s');
            cmd = `adb -s ${actionDeviceId} shell input text "${escaped}"`;
          } else if (action === 'clear') {
            cmd = `adb -s ${actionDeviceId} shell input keyevent 67`.repeat(25).replace(/adb/g, '&& adb').substring(3);
          } else if (action === 'swipe' || action === 'scroll') {
            cmd = `adb -s ${actionDeviceId} shell input swipe ${params.x1} ${params.y1} ${params.x2} ${params.y2} ${params.duration || 300}`;
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

            if (locatorPromise) {
              locatorAttr = await locatorPromise.catch(() => null);
            }

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
                    type: locatorAttr?.accessibilityId ? 'accessibility-id' : locatorAttr?.resourceId ? 'resource-id' : 'xpath',
                    value: locatorAttr?.accessibilityId || locatorAttr?.resourceId || locatorAttr?.xpath || `//android.view.View`,
                    playwright: (action === 'click' || action === 'tap')
                      ? `await driver.touchPerform([{ action: 'tap', options: { x: ${params.x}, y: ${params.y} } }]);`
                      : action === 'fill' || action === 'type'
                        ? `await driver.keys("${params.text || ''}");`
                        : `await driver.pressKeyCode(4);`
                  },
                  alternatives: [
                    locatorAttr?.accessibilityId ? { type: 'accessibility-id', value: locatorAttr.accessibilityId } : null,
                    locatorAttr?.resourceId ? { type: 'resource-id', value: locatorAttr.resourceId } : null,
                    locatorAttr?.xpath ? { type: 'xpath', value: locatorAttr.xpath } : null
                  ].filter(Boolean)
                },
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
