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
