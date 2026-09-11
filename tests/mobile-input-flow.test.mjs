import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agentUrl = new URL('../public/automatiqa-agent.js', import.meta.url);

test('mobile input waits for the original editable target to own focus', async () => {
  const source = await readFile(agentUrl, 'utf8');
  assert.match(source, /async function waitUntilInputReady/);
  assert.match(source, /targetMatchesFocus = sameEditableTarget\(target, focused\)/);
  assert.match(source, /await waitUntilInputReady\(actionDeviceId, params, resolvedInput\)/);
  assert.doesNotMatch(source, /shell input tap \$\{resolvedInput\.x\} \$\{resolvedInput\.y\} && \$\{clearFocusedField\}adb/);
});

test('recorded text preserves the editable target snapshot', async () => {
  const source = await readFile(agentUrl, 'utf8');
  assert.match(source, /elementName: lastFocusedElement\?\.hint/);
  assert.match(source, /target: lastFocusedElement \? \{/);
  assert.match(source, /editable: true, focusable:/);
  assert.match(source, /screenshot: inputScreenshot \|\| lastCapturedFrame/);
});

test('input recovery only refocuses a matching original target', async () => {
  const source = await readFile(agentUrl, 'utf8');
  assert.match(source, /!sameEditableTarget\(resolvedInput, retryTarget\)/);
  assert.match(source, /Refocusing original editable target/);
  assert.match(source, /const deleteExisting = params\.replaceText/);
  assert.doesNotMatch(source, /text: target\.text \|\| params\.text/);
  assert.match(source, /const coordinateInput = Number\.isFinite\(Number\(params\.x\)\)/);
});

test('legacy character clicks use the active focused input instead of stale metadata', async () => {
  const player = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  const agent = await readFile(agentUrl, 'utf8');
  assert.match(player, /const isLegacyCharacterClick = step\.action === 'click'/);
  assert.match(player, /params\.useActiveInputTarget = isLegacyCharacterClick/);
  assert.match(agent, /params\.useActiveInputTarget \? activeFocusedInput/);
});

test('mobile playback bypasses hover and disables recorder feedback', async () => {
  const player = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(player, /step\.action === 'hover' \|\| step\.action === 'focus' \|\| step\.action === 'blur'/);
  assert.match(player, /fetch\('\/api\/device-agent\/stop-recording'/);
});

test('mobile playback executes cursor focus taps without visual verification', async () => {
  const player = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(player, /const isCursorFocusTap = action === 'tap' && Boolean\(nextIsRecordedInput\)/);
  assert.match(player, /cursor focus tap executed; visual verification skipped/);
  assert.match(player, /if \(isCursorFocusTap\)[\s\S]*?continue;[\s\S]*?const verified = expectedFrame/);
});

test('mobile swipe recording is ordered and playback clicks use post-scroll bounds', async () => {
  const agent = await readFile(agentUrl, 'utf8');
  assert.match(agent, /let recordingInteractionQueue = Promise\.resolve\(\)/);
  assert.match(agent, /enqueueRecordingInteraction\(\(\) => handlePhysicalEmulatorSwipe/);
  assert.match(agent, /enqueueRecordingInteraction\(\(\) => handlePhysicalEmulatorTap/);
  assert.match(agent, /clickMethod = resolvedTarget \? 'current_resolved_target' : 'recorded_coordinate_fallback'/);
  assert.match(agent, /tapX = resolvedTarget\?\.x/);
  assert.match(agent, /if \(action === 'swipe' \|\| action === 'scroll'\)[\s\S]*?await refreshCachedXmlHierarchy\(actionDeviceId\)/);
});

test('live device recorder classifies pointer drags as one serialized swipe', async () => {
  const inspector = await readFile(new URL('../components/MobileRecordingInspector.tsx', import.meta.url), 'utf8');
  const capture = await readFile(new URL('../hooks/useMobileStepCapture.ts', import.meta.url), 'utf8');
  const stepBuilder = await readFile(new URL('../utils/mobileRecordingSteps.ts', import.meta.url), 'utf8');
  assert.match(inspector, /onPointerDown=\{handleLiveFramePointerDown\}/);
  assert.match(inspector, /onPointerUp=\{handleLiveFramePointerUp\}/);
  assert.match(inspector, /onRecordElement\(swipeElem, 'swipe'/);
  assert.match(inspector, /executePresetSwipe/);
  assert.match(inspector, /Execute and record Swipe/);
  assert.doesNotMatch(inspector, /onPointerDown=\{handleLiveFrameClick\}/);
  assert.match(capture, /commandQueueRef\.current = commandQueueRef\.current\.then/);
  assert.match(capture, /await waitForMobileDeviceAction\(queued\.actionId\)/);
  assert.match(stepBuilder, /normalizedX1: metrics\?\.normalizedX1/);
  assert.match(stepBuilder, /driver\.performActions/);
});

test('live device recorder locks repeated input while a step is executing', async () => {
  const inspector = await readFile(new URL('../components/MobileRecordingInspector.tsx', import.meta.url), 'utf8');
  const capture = await readFile(new URL('../hooks/useMobileStepCapture.ts', import.meta.url), 'utf8');
  assert.match(inspector, /isStepExecuting/);
  assert.match(inspector, /Executing step\.\.\./);
  assert.match(capture, /if \(isExecutingRef\.current && !metrics\?\.recordOnly\) return/);
  assert.match(capture, /options\.setExecuting\(true\)/);
  assert.match(capture, /options\.setExecuting\(false\)/);
});

test('recorded input steps expose their value editor on touch layouts', async () => {
  const player = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(player, /Edit input value/);
  assert.match(player, /Change this step to type text/);
  assert.match(player, /Changes are saved immediately and used during playback/);
  assert.match(player, /action: 'fill', value, originalValue: value/);
  assert.match(player, /replaceText: true, visualVerificationDisabled: true/);
  assert.match(player, /const expectedFrame = step\.visualVerificationDisabled/);
  assert.match(player, /executed using edited step data \(old screenshot ignored\)/);
  assert.match(player, /This click will be changed to a Fill \/ Type step/);
  assert.match(player, /opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100/);
  assert.match(player, /value: newStepData\.value/);
});

test('agent executes swipes through Appium W3C actions with ADB fallback', async () => {
  const agent = await readFile(agentUrl, 'utf8');
  assert.match(agent, /async function performAppiumSwipe/);
  assert.match(agent, /`\/session\/\$\{encodeURIComponent\(sessionId\)\}\/actions`/);
  assert.match(agent, /origin: 'viewport'/);
  assert.match(agent, /const appiumExecuted = await performAppiumSwipe/);
  assert.match(agent, /appiumExecuted[\s\S]*?'\:'[\s\S]*?adb -s/);
});
