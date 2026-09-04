import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let browser;
let page;
let recorderSource;

before(async () => {
  recorderSource = await readFile(new URL('../extension/utils.js', import.meta.url), 'utf8');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => browser?.close());

async function locate(html, selector) {
  await page.setContent(html);
  await page.addScriptTag({ content: recorderSource });
  return page.$eval(selector, el => window.QA_RECORDER_UTILS.getElementInfo(el).locator);
}

test('one Login button uses a direct role locator', async () => {
  const locator = await locate('<button>Login</button>', 'button');
  assert.equal(locator.primary.type, 'role');
  assert.equal(locator.primary.matchCount, 1);
  assert.doesNotMatch(locator.primary.playwright, /\.nth\(|\.first\(/);
});

test('duplicate first and second Login buttons preserve exact indexes', async () => {
  const html = '<button>Login</button><button>Login</button>';
  const first = await locate(html, 'button:nth-of-type(1)');
  const second = await locate(html, 'button:nth-of-type(2)');
  assert.match(first.primary.playwright, /\.nth\(0\)$/);
  assert.match(second.primary.playwright, /\.nth\(1\)$/);
  assert.equal(second.primary.matchCount, 2);
});

test('third duplicate uses zero-based nth(2)', async () => {
  const locator = await locate('<button>Login</button><button>Login</button><button>Login</button>', 'button:nth-of-type(3)');
  assert.match(locator.primary.playwright, /\.nth\(2\)$/);
});

test('unique id wins over duplicate role/text', async () => {
  const locator = await locate('<button>Login</button><button id="footer-login">Login</button>', '#footer-login');
  assert.equal(locator.primary.type, 'id');
  assert.equal(locator.primary.value, '#footer-login');
});

test('unique data-testid wins', async () => {
  const locator = await locate('<button>Login</button><button data-testid="footer-login">Login</button>', '[data-testid="footer-login"]');
  assert.equal(locator.primary.type, 'data-testid');
  assert.equal(locator.primary.isUnique, true);
});

test('unique stable class wins over duplicate role/text', async () => {
  const locator = await locate('<button class="header-login">Login</button><button class="footer-login">Login</button>', '.footer-login');
  assert.equal(locator.primary.value, '.footer-login');
});

test('duplicate inputs preserve the second placeholder index', async () => {
  const locator = await locate('<input placeholder="Enter value"><input placeholder="Enter value">', 'input:nth-of-type(2)');
  assert.match(locator.primary.playwright, /\.nth\(1\)$/);
  assert.equal(locator.primary.clickedIndex, 1);
});

test('Gemini contract preserves recorder locator and bans first()', async () => {
  const source = await readFile(new URL('../geminiService.ts', import.meta.url), 'utf8');
  assert.match(source, /locator: origStep\.locator/);
  assert.match(source, /NEVER remove \.nth\(index\), add \.first\(\)/);
});

test('playback selects recorded nth and rejects ambiguous first-match fallback', async () => {
  const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(source, /baseLoc\.nth\(recordedIndex\)/);
  assert.match(source, /count > 1 && recordedIndex === undefined/);
  assert.match(source, /Recorded element could not be uniquely identified/);
});

test('playback never overlays pre-redirect geometry on the destination screenshot', async () => {
  const serverSource = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  const playerSource = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(serverSource, /geometryMatchesScreenshot/);
  assert.match(serverSource, /coordinates: geometryMatchesScreenshot/);
  assert.match(playerSource, /resItem\.geometryMatchesScreenshot !== false/);
  assert.match(playerSource, /showInteractionOverlay && playbackGeometryVisible/);
});

test('failed fill results are not animated or presented as live input', async () => {
  const playerSource = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(playerSource, /resItem\.status === 'passed' && \(step\.action === 'fill'/);
  assert.match(playerSource, /resItem\.status === 'passed' \? 'running' : resItem\.status/);
  assert.match(playerSource, /'Interaction Failed' : 'Live Interaction'/);
});

test('ordinary interactions cannot navigate to a recorded cross-origin URL', async () => {
  const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Multi-page sync: Navigating to step recorded page/);
  assert.match(source, /new URL\(fallbackUrl as string\)\.origin === new URL\(page\.url\(\)\)\.origin/);
  assert.match(source, /An interaction's URL is recording context, not a navigation/);
});

test('captured submit after click or Enter is redundant and non-fatal', async () => {
  const serverSource = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  const playerSource = await readFile(new URL('../components/RecordAndPlay.tsx', import.meta.url), 'utf8');
  assert.match(playerSource, /eventData\.action === 'submit'/);
  assert.match(playerSource, /\['click', 'press'\]\.includes\(lastStep\.action\)/);
  assert.match(serverSource, /Skipping redundant captured submit event/);
  assert.doesNotMatch(serverSource, /'press', 'submit', 'upload'/);
});
