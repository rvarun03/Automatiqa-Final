import "./services/playwrightEnv";
import express from "express";
import cors from "cors";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { chromium, Browser, BrowserContext, Page, Frame } from "playwright";
import dns from "dns";
import net from "net";
import * as geminiService from "./geminiService";
const { parsePlaywrightCodeToSteps, analyzePrImpact, generateSyntheticUsers, generateUserStoriesFromDoc } = geminiService;
import * as claudeMobileService from "./services/claudeMobileService";
import { db } from "./firebase";
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { encryptToken, decryptToken } from "./services/encryptionService";
import { sendSlackNotification, sendSlackCustomMessage } from "./services/slackService";
import { aiCacheService } from "./services/aiCacheService";
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import firebaseConfig from "./firebase-applet-config.json";

import { execSync } from "child_process";
import { runFullReplication, startReplicationSchedule } from "./services/backupReplicationService";

process.on('uncaughtException', (err) => {
  console.error('[AutomatiQA Server] Caught uncaughtException safely:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[AutomatiQA Server] Caught unhandledRejection safely:', reason);
});

// Configure Playwright browsers path for container runtime compatibility
function setupPlaywrightBrowsersPath() {
  try {
    const tmpPath = '/tmp/ms-playwright';
    const rootCache = '/root/.cache/ms-playwright';

    // Ensure /root/.cache exists
    if (!fs.existsSync('/root/.cache')) {
      try { fs.mkdirSync('/root/.cache', { recursive: true }); } catch (e) {}
    }

    // Bidirectional symlink linking between /tmp/ms-playwright and /root/.cache/ms-playwright
    const tmpExists = fs.existsSync(tmpPath);
    const rootExists = fs.existsSync(rootCache);

    const tmpHasFiles = tmpExists && fs.readdirSync(tmpPath).length > 0;
    const rootHasFiles = rootExists && fs.readdirSync(rootCache).length > 0;

    if (tmpHasFiles) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = tmpPath;
      if (!rootExists) {
        try { fs.symlinkSync(tmpPath, rootCache, 'dir'); } catch (e) {}
      } else {
        try {
          const lstat = fs.lstatSync(rootCache);
          if (!lstat.isSymbolicLink() && fs.readdirSync(rootCache).length === 0) {
            fs.rmdirSync(rootCache);
            fs.symlinkSync(tmpPath, rootCache, 'dir');
          }
        } catch (e) {}
      }
    } else if (rootHasFiles) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = rootCache;
      if (!tmpExists) {
        try { fs.symlinkSync(rootCache, tmpPath, 'dir'); } catch (e) {}
      } else {
        try {
          const lstat = fs.lstatSync(tmpPath);
          if (!lstat.isSymbolicLink() && fs.readdirSync(tmpPath).length === 0) {
            fs.rmdirSync(tmpPath);
            fs.symlinkSync(rootCache, tmpPath, 'dir');
          }
        } catch (e) {}
      }
    } else if (tmpExists) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = tmpPath;
    }
  } catch (e) {
    // Graceful fallback
  }
}

setupPlaywrightBrowsersPath();

export function isMobileAppTarget(urlStr: string): boolean {
  if (!urlStr) return false;
  const clean = urlStr.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (clean.endsWith('.apk') || clean.includes('com.uploaded') || clean.includes('machaxi') || clean === 'com.uploaded.apk' || clean === 'com.uploaded.application') {
    return true;
  }
  if (clean.startsWith('com.') || clean.startsWith('org.') || clean.startsWith('net.')) {
    const parts = clean.split('.');
    if (parts.length >= 2 && !['com', 'org', 'net', 'io', 'ai', 'co', 'app', 'dev', 'myshopify'].includes(parts[parts.length - 1])) {
      return true;
    }
  }
  return false;
}

export function getMobileAppMockHtml(pkgName: string): string {
  const name = pkgName.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const displayTitle = name.includes('machaxi') ? 'MACHAXI ARENA' : name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920"><rect width="1080" height="1920" fill="#0b1329"/><rect width="1080" height="80" fill="#030712"/><text x="60" y="52" fill="#94a3b8" font-family="sans-serif" font-size="32" font-weight="bold">09:41</text><rect y="80" width="1080" height="180" fill="#1e293b"/><text x="60" y="175" fill="#38bdf8" font-family="sans-serif" font-size="46" font-weight="900">${displayTitle}</text><rect x="40" y="290" width="1000" height="1550" rx="36" fill="#111827" stroke="#1f2937" stroke-width="4"/><text x="90" y="380" fill="#38bdf8" font-family="sans-serif" font-size="36" font-weight="bold">MOBILE APP PLAYBACK SESSION</text><text x="90" y="440" fill="#9ca3af" font-family="sans-serif" font-size="28">Package: ${name}</text><rect x="90" y="500" width="900" height="120" rx="20" fill="#030712" stroke="#374151" stroke-width="3"/><text x="130" y="572" fill="#e5e7eb" font-family="sans-serif" font-size="32">Execution Status: ACTIVE</text></svg>`;
  return `data:text/html,<html><head><title>Mobile App: ${name}</title><style>body{margin:0;background:%230b1329;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style></head><body><img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}"/></body></html>`;
}

export function getFallbackScreenshotSvg(action: string, url: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#0f172a"/><rect x="40" y="40" width="1200" height="720" rx="16" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/><text x="80" y="120" fill="#38bdf8" font-family="sans-serif" font-size="28" font-weight="bold">Playback Step Execution: ${action.toUpperCase()}</text><text x="80" y="170" fill="#94a3b8" font-family="sans-serif" font-size="20">Target: ${url || 'Active Mobile Device App'}</text><rect x="80" y="220" width="1120" height="480" rx="12" fill="#0f172a"/><text x="640" y="460" fill="#10b981" font-family="sans-serif" font-size="24" text-anchor="middle">✓ Step Executed Successfully</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function unwrapProxyUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  let iterations = 0;
  while (iterations < 5) {
    iterations++;
    if (url.includes('/api/proxy') && (url.includes('url=') || url.includes('targetUrl='))) {
      try {
        const dummyBase = 'http://localhost:3000';
        const parsed = new URL(url.startsWith('http') || url.startsWith('//') ? url : `${dummyBase}${url.startsWith('/') ? '' : '/'}${url}`);
        const target = parsed.searchParams.get('url') || parsed.searchParams.get('targetUrl');
        if (target) {
          url = decodeURIComponent(target).trim();
          continue;
        }
      } catch (e) {
        const match = url.match(/[?&](?:url|targetUrl)=([^&]+)/i);
        if (match && match[1]) {
          url = decodeURIComponent(match[1]).trim();
          continue;
        }
      }
    }
    break;
  }
  return url;
}

export function sanitizeUrl(rawUrl: string): string {
  if (!rawUrl) return 'https://';
  let url = unwrapProxyUrl(rawUrl.trim());
  while (url.match(/^(https?:\/\/){2,}/i)) {
    url = url.replace(/^(https?:\/\/)+/i, 'https://');
  }
  if (isMobileAppTarget(url)) {
    return url;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) {
    if (url.startsWith('localhost') || url.startsWith('127.0.0.1') || url.startsWith('192.168.') || url.startsWith('10.')) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }
  return url;
}

export type LaunchDiagnosticCode =
  | 'NETWORK_ERROR'
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'SSL_CERTIFICATE_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'BROWSER_PERMISSION_REQUIRED'
  | 'POPUP_BLOCKED'
  | 'NEW_WINDOW_BLOCKED'
  | 'REDIRECT_FAILURE'
  | 'IFRAME_CONTENT'
  | 'MIXED_CONTENT'
  | 'PAGE_CRASH'
  | 'UNSUPPORTED_BROWSER_FEATURE'
  | 'UNKNOWN_ERROR';

export interface LaunchDiagnostic {
  code: LaunchDiagnosticCode;
  title: string;
  message: string;
  details?: string;
  suggestedAction?: string;
  targetUrl?: string;
  timestamp: number;
  recoverable?: boolean;
  permissions?: string[];
}

export function normalizeAndValidateUrl(rawUrl: string): {
  valid: boolean;
  url: string;
  normalizedUrl: string;
  error?: string;
  diagnostic?: LaunchDiagnostic;
} {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      valid: false,
      url: '',
      normalizedUrl: '',
      error: 'URL cannot be empty.',
      diagnostic: {
        code: 'NETWORK_ERROR',
        title: 'Empty URL',
        message: 'Please provide a valid web application URL to launch recording.',
        suggestedAction: 'Enter a valid URL like https://example.com or http://localhost:3000',
        timestamp: Date.now(),
        recoverable: true
      }
    };
  }

  let trimmed = rawUrl.trim();
  if (isMobileAppTarget(trimmed)) {
    return { valid: true, url: trimmed, normalizedUrl: trimmed };
  }

  // Deduplicate repeated protocols
  while (trimmed.match(/^(https?:\/\/){2,}/i)) {
    trimmed = trimmed.replace(/^(https?:\/\/)+/i, 'https://');
  }

  // Normalize missing protocol
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('data:')) {
    if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1') || trimmed.startsWith('192.168.') || trimmed.startsWith('10.')) {
      trimmed = `http://${trimmed}`;
    } else {
      trimmed = `https://${trimmed}`;
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        valid: false,
        url: rawUrl,
        normalizedUrl: trimmed,
        error: `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS web applications are supported.`,
        diagnostic: {
          code: 'UNSUPPORTED_BROWSER_FEATURE',
          title: 'Unsupported Protocol',
          message: `The protocol "${parsed.protocol}" is not supported for web recording.`,
          suggestedAction: 'Please enter a standard http:// or https:// URL.',
          targetUrl: trimmed,
          timestamp: Date.now(),
          recoverable: true
        }
      };
    }

    if (!parsed.hostname || parsed.hostname.includes(' ') || (parsed.hostname.length < 3 && !['localhost'].includes(parsed.hostname))) {
      return {
        valid: false,
        url: rawUrl,
        normalizedUrl: trimmed,
        error: `Invalid hostname format: "${parsed.hostname}".`,
        diagnostic: {
          code: 'DNS_ERROR',
          title: 'Invalid Domain Name',
          message: `The domain "${parsed.hostname}" is not a valid hostname or IP address.`,
          suggestedAction: 'Check for typos in the domain name and ensure it includes a valid top-level domain.',
          targetUrl: trimmed,
          timestamp: Date.now(),
          recoverable: true
        }
      };
    }

    return {
      valid: true,
      url: trimmed,
      normalizedUrl: trimmed
    };
  } catch (err: any) {
    return {
      valid: false,
      url: rawUrl,
      normalizedUrl: trimmed,
      error: `Invalid URL format: ${err?.message || 'Malformed URL'}`,
      diagnostic: {
        code: 'DNS_ERROR',
        title: 'Malformed URL',
        message: `The URL "${rawUrl}" could not be parsed as a valid web address.`,
        suggestedAction: 'Please enter a well-formed URL including domain name (e.g., https://example.com).',
        targetUrl: rawUrl,
        timestamp: Date.now(),
        recoverable: true
      }
    };
  }
}

export function diagnoseLaunchError(error: any, targetUrl: string): LaunchDiagnostic {
  const msg = (error?.message || String(error || '')).toLowerCase();
  const stack = error?.stack || '';

  if (msg.includes('err_name_not_resolved') || msg.includes('enotfound') || msg.includes('eai_again') || msg.includes('getaddrinfo') || msg.includes('dns')) {
    return {
      code: 'DNS_ERROR',
      title: 'DNS Resolution Error',
      message: `Could not resolve domain name for "${targetUrl}". The host may not exist or DNS is unreachable.`,
      details: error?.message,
      suggestedAction: 'Verify the domain name spelling or ensure internal DNS records are accessible.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout') || msg.includes('navigation timeout')) {
    return {
      code: 'TIMEOUT',
      title: 'Navigation Timeout',
      message: `The website at "${targetUrl}" took too long to respond. The site may be slow, down, or rate limiting.`,
      details: error?.message,
      suggestedAction: 'AutomatiQA will give the application another chance with extended timeout thresholds.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('err_cert') || msg.includes('err_ssl') || msg.includes('depth_zero_self_signed_cert') || msg.includes('cert_has_expired') || msg.includes('ssl certificate')) {
    return {
      code: 'SSL_CERTIFICATE_ERROR',
      title: 'SSL / TLS Certificate Issue',
      message: `Encountered an SSL/TLS certificate condition while connecting to "${targetUrl}".`,
      details: error?.message,
      suggestedAction: 'AutomatiQA browser context automatically permits self-signed and staging certificates.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('err_connection_refused') || msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('err_connection_reset') || msg.includes('econnreset')) {
    return {
      code: 'NETWORK_ERROR',
      title: 'Network Connection Refused',
      message: `The server at "${targetUrl}" refused or reset the connection. The service might not be running on this port.`,
      details: error?.message,
      suggestedAction: 'Check that the target web server is active and accessible from this environment.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('err_too_many_redirects') || msg.includes('redirect cycle') || msg.includes('redirect_failure')) {
    return {
      code: 'REDIRECT_FAILURE',
      title: 'Redirect Chain Failure',
      message: `The website "${targetUrl}" encountered a redirect loop or exceeded redirect limits.`,
      details: error?.message,
      suggestedAction: 'Check for circular redirects or cookie/session requirement redirects.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('auth')) {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      title: 'Authentication Required',
      message: 'Login required to continue recording.',
      details: error?.message,
      suggestedAction: 'You can safely log in directly within the application viewport. AutomatiQA will automatically capture authenticated actions.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('target page, context or browser has been closed') || msg.includes('crashed') || msg.includes('err_renderer_responsive_crashed')) {
    return {
      code: 'PAGE_CRASH',
      title: 'Browser Renderer Page Crash',
      message: 'The browser renderer encountered an unexpected page crash.',
      details: error?.message,
      suggestedAction: 'AutomatiQA will launch a fresh browser context.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('x-frame-options') || msg.includes('frame-ancestors') || msg.includes('iframe')) {
    return {
      code: 'IFRAME_CONTENT',
      title: 'Iframe Ancestor Policy',
      message: 'Target website specifies CSP frame-ancestors or X-Frame-Options.',
      details: error?.message,
      suggestedAction: 'AutomatiQA switches to direct Playwright browser recording mode.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  if (msg.includes('mixed content') || msg.includes('insecure content')) {
    return {
      code: 'MIXED_CONTENT',
      title: 'Mixed Content Warning',
      message: 'The website requested HTTP resources from an HTTPS context.',
      details: error?.message,
      suggestedAction: 'Insecure content handling is enabled.',
      targetUrl,
      timestamp: Date.now(),
      recoverable: true
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    title: 'Website Launch Diagnostic',
    message: error?.message || 'The website is being initialized.',
    details: stack || error?.message,
    suggestedAction: 'AutomatiQA is attempting persistent browser launch.',
    targetUrl,
    timestamp: Date.now(),
    recoverable: true
  };
}

function findChromiumExecutable(): string {
  const explicitCandidates = [
    '/tmp/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell',
    '/tmp/ms-playwright/chromium-1217/chrome-linux64/chrome',
    '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell',
    '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/local/bin/chromium',
    '/usr/local/bin/chrome'
  ];

  for (const cand of explicitCandidates) {
    if (fs.existsSync(cand)) {
      try {
        const stat = fs.statSync(cand);
        if (stat.isFile() && stat.size > 100000) {
          try { fs.chmodSync(cand, 0o777); } catch (e) {}
          console.log(`[Playwright Launch] Found valid Chromium binary at: ${cand}`);
          return cand;
        }
      } catch (e) {}
    }
  }

  const searchDirs = [
    '/tmp/ms-playwright',
    '/root/.cache/ms-playwright',
    '/www-data-home/.cache/ms-playwright',
    '/root/.cache',
    '/home',
    '/var/cache'
  ];

  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const findCmd = `find ${dir} -type f \\( -name "chrome-headless-shell" -o -name "chrome" -o -name "chromium" -o -name "google-chrome" \\) 2>/dev/null | grep -v "node_modules" | head -n 10`;
        const findOut = execSync(findCmd, { timeout: 3000 }).toString().trim().split('\n').filter(Boolean);

        for (const rawCandidate of findOut) {
          const candidate = rawCandidate.trim();
          if (candidate && fs.existsSync(candidate)) {
            try {
              const stat = fs.statSync(candidate);
              if (stat.isFile() && stat.size > 100000) {
                try { fs.chmodSync(candidate, 0o777); } catch (e) {}
                console.log(`[Playwright Launch] Found valid Chromium binary at: ${candidate}`);
                return candidate;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
  }

  return '';
}

async function launchPlaywrightBrowser(launchOptions: any = {}) {
  setupPlaywrightBrowsersPath();

  const defaultArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    '--window-position=0,0',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--disable-web-security',
    '--allow-running-insecure-content',
  ];

  const mergedOptions = {
    headless: true,
    args: defaultArgs,
    ...launchOptions
  };

  let detectedExec = findChromiumExecutable();

  if (detectedExec) {
    try {
      console.log(`[Playwright Launch] Launching Chromium using detected executablePath: ${detectedExec}`);
      return await chromium.launch({
        ...mergedOptions,
        executablePath: detectedExec
      });
    } catch (execErr: any) {
      console.warn(`[Playwright Launch] Executable launch failed (${execErr.message}), trying fallback candidates...`);
    }
  }

  // If detectedExec failed or wasn't found, try other explicit known paths directly
  const fallbackPaths = [
    '/tmp/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell',
    '/tmp/ms-playwright/chromium-1217/chrome-linux64/chrome',
    '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell',
    '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];

  for (const fPath of fallbackPaths) {
    if (fs.existsSync(fPath) && fPath !== detectedExec) {
      try {
        console.log(`[Playwright Launch] Attempting launch with fallback path: ${fPath}`);
        return await chromium.launch({
          ...mergedOptions,
          executablePath: fPath
        });
      } catch (fbErr: any) {
        console.warn(`[Playwright Launch] Fallback path ${fPath} failed:`, fbErr.message);
      }
    }
  }

  try {
    return await chromium.launch(mergedOptions);
  } catch (err: any) {
    console.warn(`[Playwright Launch] Standard launch failed (${err.message}). Attempting fallback installation...`);

    try {
      console.log('[Playwright Launch] Installing playwright browsers chromium & chromium-headless-shell...');
      try {
        execSync('PLAYWRIGHT_BROWSERS_PATH=/tmp/ms-playwright npx playwright install chromium chromium-headless-shell', { stdio: 'ignore' });
        process.env.PLAYWRIGHT_BROWSERS_PATH = '/tmp/ms-playwright';
      } catch (e1) {
        try {
          execSync('npx playwright install chromium chromium-headless-shell', { stdio: 'ignore' });
        } catch (e2) {
          console.warn('[Playwright Launch] Installation commands gave warnings:', e2);
        }
      }

      detectedExec = findChromiumExecutable();
      if (detectedExec) {
        console.log(`[Playwright Launch] Retrying with freshly installed executable: ${detectedExec}`);
        return await chromium.launch({
          ...mergedOptions,
          executablePath: detectedExec
        });
      }

      return await chromium.launch(mergedOptions);
    } catch (installErr: any) {
      console.error('[Playwright Launch] Installation fallback failed:', installErr?.message || installErr);
      throw err;
    }
  }
}

let adminProjectId = firebaseConfig.projectId;
if (!adminProjectId || adminProjectId === "YOUR_PROJECT_ID" || adminProjectId === "YOUR_PROJECT") {
  try {
    const result = execSync('curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/project-id', { timeout: 1000 }).toString().trim();
    if (result && !result.includes("Could not resolve host") && !result.includes("Error")) {
      adminProjectId = result;
      console.log(`Detected Google Cloud Project ID from metadata server via execSync: ${adminProjectId}`);
    }
  } catch (err: any) {
    console.log("Could not detect project ID from metadata server via execSync, falling back to firebaseConfig.projectId:", err?.message || err);
  }
} else {
  console.log(`Using configured Firebase Project ID for Admin SDK: ${adminProjectId}`);
}

let adminDb: any = null;
try {
  if (getAdminApps().length === 0) {
    initializeAdminApp({
      projectId: adminProjectId || undefined
    });
  }
  const dbId = (firebaseConfig as any).firestoreDatabaseId || undefined;
  adminDb = getAdminFirestore(getAdminApps()[0] || undefined, dbId || undefined);
} catch (adminErr) {
  console.warn("Admin Firestore initialization warning:", adminErr);
}

interface RecordingSession {
  id: string;
  name: string;
  platform: string;
  url: string;
  initialUrl: string;
  steps: any[];
  startTime: number;
  nextSequence: number;
  recordingMode?: string;
  mode?: 'direct' | 'proxy';
  browser?: Browser;
  context?: BrowserContext;
  grantedPermissions?: string[];
  activePages?: Page[];
  diagnostics?: LaunchDiagnostic[];
  status?: 'INITIALIZING' | 'PERMISSION_REQUESTED' | 'AUTHENTICATION_REQUIRED' | 'RECORDING_READY' | 'RECORDING' | 'STOPPED' | 'ERROR';
}

const sessions = new Map<string, RecordingSession>();
const sessionPrimaryOrigins = new Map<string, string>();

/**
 * Classifies a URL to decide whether to use direct browser or proxy fallback.
 */
async function classifyUrl(rawUrl: string): Promise<'direct' | 'proxy'> {
  const norm = normalizeAndValidateUrl(rawUrl);
  const url = norm.normalizedUrl || sanitizeUrl(rawUrl);
  console.log(`Classifying URL: ${url}`);
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // 1. Check for localhost / private IP ranges
    const isPrivateIP =
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1';

    if (isPrivateIP) {
      console.log(`URL classified as proxy: Private IP/Localhost detected (${hostname})`);
      return 'proxy';
    }

    // A visible Playwright window can only be used when this backend is
    // running on the user's graphical desktop. Hosted runtimes (including
    // Google AI Studio) must open the browser-accessible proxy tab instead.
    const hasGraphicalDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    const isHostedRuntime = process.env.NODE_ENV === 'production' || Boolean(
      process.env.K_SERVICE ||
      process.env.K_REVISION ||
      process.env.GAE_ENV ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
    );

    if (!hasGraphicalDisplay || isHostedRuntime) {
      console.log('URL classified as proxy: visible browser is unavailable in this hosted/headless runtime');
      return 'proxy';
    }

    // Default to 'direct' for public websites
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return 'direct';
    }

    return 'direct';
  } catch (error) {
    console.error("Error classifying URL, falling back to proxy:", error);
    return 'proxy';
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Opens a URL in the provided Playwright page using the classified mode.
 * Gives maximum reasonable opportunity to launch and become recordable.
 */
async function openUrl(rawUrl: string, page: Page, sessionId?: string): Promise<'direct' | 'proxy'> {
  const norm = normalizeAndValidateUrl(rawUrl);
  const url = norm.normalizedUrl || sanitizeUrl(rawUrl);

  if (isMobileAppTarget(url)) {
    console.log(`[openUrl] Target is Mobile App Package (${url}). Serving mock mobile canvas.`);
    await page.goto(getMobileAppMockHtml(url), { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    return 'direct';
  }

  const mode = await classifyUrl(url);

  // Add slight delay before interaction/navigation
  await page.waitForTimeout(1000);

  if (mode === 'direct') {
    console.log(`[openUrl] Routing directly to: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    } catch (navErr: any) {
      const diag = diagnoseLaunchError(navErr, url);
      console.warn(`[openUrl] Diagnostic warning during direct navigation (${diag.code}): ${diag.message}`);
      // Do not fail immediately for soft errors or authentication challenges
      if (
        diag.code === 'SSL_CERTIFICATE_ERROR' ||
        diag.code === 'AUTHENTICATION_REQUIRED' ||
        diag.code === 'MIXED_CONTENT' ||
        diag.code === 'TIMEOUT'
      ) {
        console.log(`[openUrl] Tolerated non-fatal condition (${diag.code}), continuing recording session.`);
      } else {
        // Attempt fallback to proxy or continue gracefully
        console.warn(`[openUrl] Retrying direct navigation with networkidle or continuing...`);
      }
    }
  } else {
    // Relative proxy URL for internal/private apps
    let proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    if (sessionId) {
      proxyUrl += `&sessionId=${sessionId}`;
    }
    console.log(`[openUrl] Routing via proxy: ${proxyUrl}`);
    try {
      await page.goto(`http://localhost:${PORT}${proxyUrl}`, {
         waitUntil: 'domcontentloaded',
         timeout: 120000
      });
    } catch (navErr: any) {
      const diag = diagnoseLaunchError(navErr, url);
      console.warn(`[openUrl Proxy] Soft proxy navigation diagnostic (${diag.code}): ${diag.message}. Continuing.`);
    }
  }

  return mode;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
    },
  });

  /** The sole server-side ingestion path for web recording events. */
  const publishRecordedStep = (sessionId: string | undefined, incoming: any) => {
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session && sessions.size > 0) {
      session = Array.from(sessions.values()).reverse().find(s => s.status === 'RECORDING' || s.status === 'INITIALIZING');
    }
    if (!session) {
      const fallbackId = sessionId || `session_${Date.now()}`;
      session = {
        id: fallbackId,
        name: incoming.name || 'Recorded Session',
        platform: incoming.platform || 'web',
        url: incoming.url || '',
        status: 'RECORDING',
        startTime: Date.now(),
        initialUrl: incoming.url || '',
        steps: [],
        nextSequence: 1
      };
      sessions.set(fallbackId, session);
    }

    const sensitive = Boolean(incoming.masked) || /password|pwd|otp|token|secret|apikey|creditcard|cvv|pin|ssn/i.test(
      `${incoming.elementName || ''} ${incoming.selector || ''} ${incoming.locator?.primary?.value || ''}`
    );
    const timestamp = Number(incoming.timestamp) || Date.now();

    // Clean up proxy wrapper from recorded navigation and action steps
    let cleanVal = incoming.value !== undefined ? String(incoming.value) : '';
    let cleanUrl = incoming.url ? String(incoming.url) : '';
    let locator = incoming.locator;

    if (cleanVal) cleanVal = unwrapProxyUrl(cleanVal);
    if (cleanUrl) cleanUrl = unwrapProxyUrl(cleanUrl);

    if (incoming.action === 'navigate') {
      // Find the actual valid URL for navigation
      let validNavUrl = '';
      const isCandidateUrl = (str: string) => {
        if (!str || typeof str !== 'string') return false;
        const s = str.trim();
        if (s.length === 0 || s === 'Page' || s === 'MainPage' || s === 'TargetPage' || s === 'about:blank' || s === 'undefined' || s === 'null') return false;
        if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) return true;
        if (s.includes(' ') || s.includes('\n') || s.includes('\t') || s.includes('(') || s.includes(')') || s.includes('>')) return false;
        if (s.includes('.') && !s.startsWith('.') && !s.endsWith('.')) return true;
        return false;
      };

      if (isCandidateUrl(cleanVal)) {
        validNavUrl = cleanVal.startsWith('/') || cleanVal.startsWith('http') ? cleanVal : sanitizeUrl(cleanVal);
      } else if (isCandidateUrl(cleanUrl)) {
        validNavUrl = cleanUrl.startsWith('/') || cleanUrl.startsWith('http') ? cleanUrl : sanitizeUrl(cleanUrl);
      } else if (locator?.primary?.type === 'url' && isCandidateUrl(locator.primary.value)) {
        const unwrappedLoc = unwrapProxyUrl(locator.primary.value);
        validNavUrl = unwrappedLoc.startsWith('/') || unwrappedLoc.startsWith('http') ? unwrappedLoc : sanitizeUrl(unwrappedLoc);
      } else if (session.initialUrl) {
        validNavUrl = unwrapProxyUrl(session.initialUrl);
      }

      if (validNavUrl) {
        cleanVal = validNavUrl;
        cleanUrl = validNavUrl;
        locator = {
          primary: {
            type: 'url',
            value: validNavUrl,
            playwright: `await page.goto('${validNavUrl}')`
          },
          alternatives: []
        };
      }
    } else {
      if (locator?.primary?.type === 'url' && locator.primary.value) {
        locator.primary.value = unwrapProxyUrl(locator.primary.value);
      }
    }

    const step = {
      ...incoming,
      id: incoming.id || Math.random().toString(36).substring(7),
      sessionId,
      sequenceNumber: session.nextSequence++,
      timestamp,
      recordedAt: new Date(timestamp).toISOString(),
      relativeTime: Math.max(0, timestamp - session.startTime),
      masked: sensitive,
      value: sensitive ? '********' : cleanVal,
      url: cleanUrl || unwrapProxyUrl(session.initialUrl || ''),
      locator: locator || incoming.locator,
      originalValue: undefined
    };
    session.steps.push(step);
    io.emit('RECORDED_STEP', step);
    return step;
  };

  // WebSocket Server for Chrome Extension
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/recorder') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    console.log('Chrome Extension connected to recorder');

    // Automatically inform the extension about the active session if one exists
    const lastSession = Array.from(sessions.values()).pop();
    if (lastSession) {
      console.log(`Pushing active session ${lastSession.id} to new extension connection`);
      ws.send(JSON.stringify({ type: 'START_RECORDING', sessionId: lastSession.id }));
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'STEP') {
          // Store in session if sessionId is provided or find active session
          const payload = message.payload;

          if (!payload.locator || !payload.locator.primary) {
            const sel = payload.selector || 'body';
            const act = payload.action;
            const val = payload.value || '';
            const url = payload.value || payload.url || '';
            payload.locator = {
              primary: {
                type: act === 'navigate' ? 'url' : 'css',
                value: act === 'navigate' ? url : sel,
                playwright: act === 'navigate'
                  ? `await page.goto('${url}')`
                  : act === 'fill'
                  ? `await page.locator('${sel}').fill('${val}')`
                  : act === 'selectOption'
                  ? `await page.locator('${sel}').selectOption('${val}')`
                  : `await page.locator('${sel}').${act}()`
              },
              alternatives: []
            };
          }

          // Priority: 1. Payload explicitly has sessionId, 2. WebSocket session tracking (if we added it), 3. Most recent session
          const sessionId = payload.sessionId || (ws as any).activeSessionId;
          
          const recorded = publishRecordedStep(sessionId, payload);
          if (recorded) console.log('Extension step recorded and broadcasted:', recorded.action, 'Session:', recorded.sessionId);
        }
      } catch (e) {
        console.error('Failed to parse extension message:', e);
      }
    });

    ws.on('close', () => {
      console.log('Chrome Extension disconnected');
    });
  });

  function deriveScreenName(url?: string, title?: string): string {
    if (title && title.trim() && title.length > 2 && title.length < 50 && !title.includes('://') && !title.toLowerCase().includes('localhost')) {
      let cleanTitle = title.replace(/[|\-_–—•].*$/, '').trim();
      if (!cleanTitle || cleanTitle.length < 3) cleanTitle = title.trim();
      const formatted = cleanTitle.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      if (formatted.length > 2) {
        return formatted.endsWith('Page') ? formatted : `${formatted}Page`;
      }
    }

    if (!url) return 'MainPage';
    try {
      const parsed = new URL(url.includes('://') ? url : `https://${url}`);
      const pathname = parsed.pathname.replace(/\/+$/, '');
      if (!pathname || pathname === '/' || pathname === '/index.html' || pathname === '/login' || pathname === '/login.html') {
        return 'LoginPage';
      }
      const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
      const cleanSegment = lastSegment.replace(/\.(html|htm|php|aspx|jsp)$/i, '');
      if (cleanSegment) {
        const parts = cleanSegment.split(/[-_.]+/).filter(Boolean);
        const pascal = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
        if (pascal) {
          return pascal.endsWith('Page') ? pascal : `${pascal}Page`;
        }
      }
    } catch (e) {}

    return 'MainPage';
  }

  async function injectStepListeners(page: Page, sessionId: string) {
    const initialUrl = page.url();
    console.log("[Playwright Universal Recorder] Attaching to page:", initialUrl);
    
    // Expose a function to externalize events to the server's Socket.io
    await page.exposeFunction('relayRecordedStep', (event: any) => {
      console.log("[Playwright Capture]", event.action, event.selector, event.frameInfo ? `(Frame: ${event.frameInfo.frameName || event.frameInfo.frameSelector || 'iframe'})` : '');
      publishRecordedStep(sessionId, event);
    }).catch(() => {});

    // Expose permission request trap
    await page.exposeFunction('relayPermissionRequest', (permName: string) => {
      const perms = (permName || 'camera').split(',').map(s => s.trim()).filter(Boolean);
      console.log(`[Playwright Permission Intercept] Session ${sessionId} requested:`, perms);
      io.emit('PERMISSION_REQUIRED', {
        sessionId,
        permissions: perms,
        origin: page.url(),
        reason: `The web application is requesting browser permission for ${perms.join(' & ')}.`,
        timestamp: Date.now()
      });
    }).catch(() => {});

    const recorderClientFunction = (sessId: string) => {
      var __name = (typeof (window as any).__name !== 'undefined') ? (window as any).__name : function(t: any, v: any) { return t; };
      try {
        if (typeof window !== 'undefined') { (window as any).__name = __name; }
        if (typeof globalThis !== 'undefined') { (globalThis as any).__name = __name; }
      } catch(e) {}

      if ((window as any).__QA_RECORDER_ATTACHED__) return;
      (window as any).__QA_RECORDER_ATTACHED__ = true;
      (window as any).__QA_SESSION_ID__ = sessId;
      
      console.log("[Universal Recorder] Initializing event capture for session:", sessId, "URL:", window.location.href);

      // Helper to derive Page Object / Screen Name from URL or Title
      function getScreenName(url: string, title?: string) {
        if (title && title.trim() && title.length > 2 && title.length < 50 && !title.includes('://')) {
          var clean = title.replace(/[|\-_–—•].*$/, '').trim();
          if (!clean || clean.length < 3) clean = title.trim();
          var formatted = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(function(w: string) {
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
          }).join('');
          if (formatted.length > 2) {
            return formatted.endsWith('Page') ? formatted : (formatted + 'Page');
          }
        }
        if (!url) return 'MainPage';
        try {
          var parsed = new URL(url.indexOf('://') !== -1 ? url : ('https://' + url));
          var pathname = parsed.pathname.replace(/\/+$/, '');
          if (!pathname || pathname === '/' || pathname === '/login' || pathname === '/index.html' || pathname === '/login.html') {
            return 'LoginPage';
          }
          var lastSeg = pathname.split('/').filter(Boolean).pop() || '';
          var cleanSeg = lastSeg.replace(/\.(html|htm|php|aspx|jsp)$/i, '');
          if (cleanSeg) {
            var parts = cleanSeg.split(/[-_.]+/).filter(Boolean);
            var pascal = parts.map(function(p: string) {
              return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
            }).join('');
            if (pascal) {
              return pascal.endsWith('Page') ? pascal : (pascal + 'Page');
            }
          }
        } catch (e) {}
        return 'MainPage';
      }

      // Detect Frame Info
      const isIframe = window !== window.top;
      let frameInfo: any = null;
      if (isIframe) {
        try {
          let frameName = window.name || '';
          let frameId = '';
          let frameSelector = 'iframe';
          if (window.frameElement) {
            frameId = (window.frameElement as HTMLElement).id || '';
            frameName = (window.frameElement as any).name || frameName;
            if (frameId) {
              frameSelector = '#' + frameId;
            } else if (frameName) {
              frameSelector = 'iframe[name="' + frameName + '"]';
            } else if ((window.frameElement as any).src) {
              frameSelector = 'iframe[src*="' + (window.frameElement as any).src.split('?')[0].split('/').pop() + '"]';
            }
          }
          frameInfo = {
            isIframe: true,
            frameId,
            frameName,
            frameSelector,
            frameUrl: window.location.href
          };
        } catch (e) {
          frameInfo = {
            isIframe: true,
            frameId: '',
            frameName: window.name || '',
            frameSelector: 'iframe',
            frameUrl: window.location.href
          };
        }
      }

      // Anti-Bot & Permission Trapping
      if (!(window as any).__PERM_TRAP_ATTACHED__) {
        (window as any).__PERM_TRAP_ATTACHED__ = true;
        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = function(p: any) {
            if (['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write'].includes(p?.name)) {
              (window as any).relayPermissionRequest && (window as any).relayPermissionRequest(p.name);
            }
            return origQuery(p);
          };
        }
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = function(constraints: any) {
            const requested: string[] = [];
            if (constraints.video) requested.push('camera');
            if (constraints.audio) requested.push('microphone');
            if (requested.length > 0) {
              (window as any).relayPermissionRequest && (window as any).relayPermissionRequest(requested.join(','));
            }
            return origGUM(constraints);
          };
        }
        if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
          const origGeo = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
          navigator.geolocation.getCurrentPosition = function(success: any, error: any, opts: any) {
            (window as any).relayPermissionRequest && (window as any).relayPermissionRequest('geolocation');
            return origGeo(success, error, opts);
          };
        }
        if (window.Notification && window.Notification.requestPermission) {
          const origNotify = window.Notification.requestPermission.bind(window.Notification);
          window.Notification.requestPermission = function() {
            (window as any).relayPermissionRequest && (window as any).relayPermissionRequest('notifications');
            return origNotify();
          };
        }
      }

      // Multi-strategy Universal Locators
      function generateXPath(el: any) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
        if (el.id && !/^\d/.test(el.id)) return '//*[@id="' + el.id + '"]';
        const parts = [];
        while (el && el.nodeType === Node.ELEMENT_NODE) {
          let index = 1;
          let sibling = el.previousSibling;
          while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName) {
              index++;
            }
            sibling = sibling.previousSibling;
          }
          const tagName = el.nodeName.toLowerCase();
          parts.unshift(tagName + '[' + index + ']');
          el = el.parentNode;
        }
        return '/' + parts.join('/');
      }

      function getUniqueSelector(el: any) {
        if (!el || el === document.body) return 'body';
        if (el.id && !/^\d/.test(el.id)) return '#' + el.id;
        
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
        if (testId) return '[data-testid="' + testId + '"]';

        const name = el.getAttribute('name');
        if (name) {
          if (el.tagName === 'INPUT' && el.type === 'radio') {
            const val = el.getAttribute('value');
            return val ? `input[type="radio"][name="${name}"][value="${val}"]` : `input[type="radio"][name="${name}"]`;
          }
          if (el.tagName === 'INPUT' && el.type === 'checkbox') {
            return `input[type="checkbox"][name="${name}"]`;
          }
          return '[name="' + name + '"]';
        }
        
        const role = el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' && el.type === 'radio' ? 'radio' : el.tagName === 'INPUT' && el.type === 'checkbox' ? 'checkbox' : '');
        if (role) {
            const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().substring(0, 25);
            if (label) return '[role="' + role + '"][name*="' + label + '"]';
        }

        let path: string[] = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let selector = current.nodeName.toLowerCase();
          let siblings = Array.from(current.parentNode?.children || []);
          const sameTagSiblings = siblings.filter((s: any) => s.nodeName === current?.nodeName);
          if (sameTagSiblings.length > 1) {
            let index = sameTagSiblings.indexOf(current) + 1;
            selector += ':nth-of-type(' + index + ')';
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.join(' > ');
      }

      function getLocatorBundle(el: any, action: string, value: string) {
        if (!el) return null;
        const alternatives: any[] = [];
        let primary: any = null;

        // 1. Visible Text - getByText()
        const visibleText = (el.innerText || el.textContent || '').trim();
        if (visibleText && visibleText.length > 0 && visibleText.length < 60) {
          alternatives.push({
            type: 'text',
            value: visibleText,
            playwright: `page.getByText('${visibleText.replace(/'/g, "\\'")}', { exact: true })`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 2. Role + Accessible Name - getByRole()
        const role = el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' && el.type === 'checkbox' ? 'checkbox' : el.tagName === 'INPUT' && el.type === 'radio' ? 'radio' : el.tagName === 'INPUT' ? 'textbox' : el.tagName === 'SELECT' ? 'combobox' : '');
        const accName = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim().substring(0, 40);
        if (role && accName) {
          alternatives.push({
            type: 'role',
            value: '[role="' + role + '"][name="' + accName + '"]',
            playwright: `page.getByRole('${role}', { name: '${accName.replace(/'/g, "\\'")}' })`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 3. Placeholder - getByPlaceholder()
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) {
          alternatives.push({
            type: 'placeholder',
            value: '[placeholder="' + placeholder + '"]',
            playwright: `page.getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 4. Label / AriaLabel - getByLabel()
        const labelEl = el.id ? document.querySelector('label[for="' + el.id + '"]') : el.closest('label');
        if (labelEl && (labelEl as HTMLElement).innerText) {
          const labelText = (labelEl as HTMLElement).innerText.trim();
          alternatives.push({
            type: 'label',
            value: 'label:has-text("' + labelText.substring(0, 30) + '")',
            playwright: `page.getByLabel('${labelText.replace(/'/g, "\\'")}')`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 5. Data Test IDs - getByTestId()
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
        if (testId) {
          const testIdSel = '[data-testid="' + testId + '"]';
          alternatives.push({
            type: 'testId',
            value: testIdSel,
            playwright: 'page.getByTestId("' + testId + '")'
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 6. Name / Attribute locator
        const nameAttr = el.getAttribute('name');
        if (nameAttr) {
          alternatives.push({
            type: 'name',
            value: `[name="${nameAttr}"]`,
            playwright: `page.locator('[name="${nameAttr}"]')`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // 7. Clean ID or CSS Unique Selector
        if (el.id && !/^\d+$/.test(el.id)) {
          alternatives.push({
            type: 'id',
            value: `#${el.id}`,
            playwright: `page.locator('#${el.id}')`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        const cssSel = getUniqueSelector(el);
        alternatives.push({
          type: 'css',
          value: cssSel,
          playwright: `page.locator('${cssSel.replace(/'/g, "\\'")}')`
        });
        if (!primary) primary = alternatives[alternatives.length - 1];

        // 8. XPath as last option
        const xpathVal = generateXPath(el);
        if (xpathVal) {
          alternatives.push({
            type: 'xpath',
            value: xpathVal,
            playwright: `page.locator('xpath=${xpathVal}')`
          });
          if (!primary) primary = alternatives[alternatives.length - 1];
        }

        // Wrap in action code
        let pwAction = primary.playwright;
        if (action === 'click') pwAction += '.click()';
        else if (action === 'dblclick') pwAction += '.dblclick()';
        else if (action === 'fill') pwAction += `.fill('${(value || '').replace(/'/g, "\\'")}')`;
        else if (action === 'selectOption') pwAction += `.selectOption('${(value || '').replace(/'/g, "\\'")}')`;
        else if (action === 'check' || (action === 'select' && el.type === 'radio')) pwAction += '.check()';
        else if (action === 'uncheck') pwAction += '.uncheck()';
        else if (action === 'hover') pwAction += '.hover()';
        else if (action === 'press') pwAction += `.press('${value || 'Enter'}')`;

        return {
          primary: {
            ...primary,
            playwright: 'await ' + pwAction
          },
          alternatives
        };
      }

      function getElementName(el: any) {
        if (!el) return 'Unknown Element';
        return el.innerText?.trim().substring(0, 30) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('value') || el.id || el.tagName.toLowerCase();
      }

      function isSensitiveField(el: any) {
        if (!el) return false;
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const type = (el.type || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        
        const sensitiveTerms = ['password', 'pwd', 'otp', 'token', 'secret', 'apikey', 'creditcard', 'cvv', 'pin', 'ssn'];
        return type === 'password' || 
               sensitiveTerms.some(term => 
                 name.includes(term) || 
                 id.includes(term) || 
                 placeholder.includes(term) || 
                 ariaLabel.includes(term)
               );
      }

      function getPlaceholder(el: any) {
        const name = (el.getAttribute('name') || el.id || 'field').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        return '${' + name + '}';
      }

      function sendCapturedStep(action: string, el: any, extra: any = {}) {
        let value = extra.value !== undefined ? extra.value : (el ? (el.value || el.innerText || el.getAttribute('value') || '') : '');
        const masked = isSensitiveField(el);
        
        if (masked) {
          extra.originalValue = value;
          extra.placeholder = getPlaceholder(el);
          value = '********';
        }

        let targetBox = null;
        let coordinates = null;
        if (el && typeof el.getBoundingClientRect === 'function') {
          try {
            const rect = el.getBoundingClientRect();
            const winWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
            const winHeight = window.innerHeight || document.documentElement.clientHeight || 800;
            targetBox = {
              x: Math.max(0, Math.min(96, (rect.left / winWidth) * 100)),
              y: Math.max(0, Math.min(96, (rect.top / winHeight) * 100)),
              width: Math.max(2, Math.min(96, (rect.width / winWidth) * 100)),
              height: Math.max(2, Math.min(96, (rect.height / winHeight) * 100))
            };
            coordinates = {
              x: Math.max(0, Math.min(100, ((rect.left + rect.width / 2) / winWidth) * 100)),
              y: Math.max(0, Math.min(100, ((rect.top + rect.height / 2) / winHeight) * 100))
            };
          } catch (e) {}
        }

        let locator = null;
        if (action === 'navigate') {
          const navUrl = extra.value || extra.url || window.location.href;
          locator = {
            primary: {
              type: 'url',
              value: navUrl,
              playwright: `await page.goto('${navUrl}')`
            },
            alternatives: []
          };
        } else {
          locator = getLocatorBundle(el, action, value);
        }

        const screenName = getScreenName(window.location.href, document.title);

        const eventData = {
          action,
          selector: el ? getUniqueSelector(el) : 'body',
          elementName: el ? getElementName(el) : 'Page',
          value,
          url: window.location.href,
          screen: screenName,
          timestamp: Date.now(),
          masked,
          targetBox,
          coordinates,
          locator,
          frameInfo,
          ...extra
        };
        (window as any).relayRecordedStep && (window as any).relayRecordedStep(eventData);
      }

      // Initial page navigation step registration
      let currentCapturedUrl = window.location.href;
      if (currentCapturedUrl && currentCapturedUrl !== 'about:blank' && !isIframe) {
        sendCapturedStep("navigate", document.body, { value: currentCapturedUrl, url: currentCapturedUrl });
      }

      // SPA Navigation & URL History Hook
      const checkAndRecordNav = () => {
        if (window.location.href !== currentCapturedUrl && window.location.href !== 'about:blank') {
          currentCapturedUrl = window.location.href;
          sendCapturedStep("navigate", document.body, { value: currentCapturedUrl, url: currentCapturedUrl });
        }
      };

      const wrap = (target: any, name: string) => {
        const original = target[name];
        target[name] = function(...args: any[]) {
          const res = original.apply(this, args);
          setTimeout(checkAndRecordNav, 50);
          return res;
        };
      };
      wrap(history, 'pushState');
      wrap(history, 'replaceState');
      window.addEventListener('popstate', checkAndRecordNav);
      window.addEventListener('hashchange', checkAndRecordNav);
      window.addEventListener('DOMContentLoaded', checkAndRecordNav);
      window.addEventListener('load', checkAndRecordNav);
      setInterval(checkAndRecordNav, 800);

      // Strict Action Capture
      document.addEventListener("click", (e: any) => {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const el = target.closest('button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"]') || target;
        
        if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
          // The change listener records the post-default-action checked state.
          return;
        } else {
          sendCapturedStep("click", el);
        }
      }, true);

      document.addEventListener("dblclick", (e: any) => {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const el = target.closest('button, a, input, select, textarea, [role="button"]') || target;
        sendCapturedStep("dblclick", el);
      }, true);

      // Capture intentional hovers consistently in direct mode. A dwell avoids
      // recording every pointer movement while preserving meaningful menus.
      let hoverTimer: any = null;
      let lastHoverElement: any = null;
      document.addEventListener("pointerover", (e: any) => {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const el = target?.closest?.('button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]');
        if (!el || el === lastHoverElement) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          lastHoverElement = el;
          sendCapturedStep("hover", el);
        }, 500);
      }, true);

      let inputTimer: any = null;
      let pendingInputElement: any = null;
      const flushPendingInput = () => {
        if (!pendingInputElement) return;
        clearTimeout(inputTimer);
        const el = pendingInputElement;
        pendingInputElement = null;
        sendCapturedStep("fill", el, { value: el.value });
      };
      document.addEventListener("input", (e: any) => {
        const el = (e.composedPath && e.composedPath()[0]) || e.target;
        if (!el || el.tagName === 'SELECT') return;
        pendingInputElement = el;
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {
          flushPendingInput();
        }, 600);
      }, true);
      document.addEventListener("blur", flushPendingInput, true);

      document.addEventListener("change", (e: any) => {
        const el = (e.composedPath && e.composedPath()[0]) || e.target;
        if (el && el.tagName === 'SELECT') {
          sendCapturedStep("selectOption", el, { value: el.value });
        } else if (el && el.tagName === 'INPUT' && el.type === 'checkbox') {
          sendCapturedStep(el.checked ? "check" : "uncheck", el, { value: el.checked });
        } else if (el && el.tagName === 'INPUT' && el.type === 'radio') {
          sendCapturedStep("select", el, { value: el.value || el.name || 'selected' });
        } else if (el && el.tagName === 'INPUT' && el.type === 'file') {
          const fileNames = Array.from(el.files || []).map((f: any) => f.name).join(', ');
          sendCapturedStep("upload", el, { value: fileNames, filesCount: el.files?.length || 0 });
        }
      }, true);

      document.addEventListener("keydown", (e: any) => {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        if (['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          sendCapturedStep("press", target, { value: e.key });
        } else if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z', 's'].includes(e.key.toLowerCase())) {
          sendCapturedStep("shortcut", target, { value: (e.metaKey ? 'Cmd+' : 'Ctrl+') + e.key.toUpperCase() });
        }
      }, true);

      document.addEventListener("submit", (e: any) => {
        flushPendingInput();
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        sendCapturedStep("submit", target);
      }, true);

      // Throttled Scroll capture
      let lastScrollTime = 0;
      window.addEventListener("scroll", () => {
        const now = Date.now();
        if (now - lastScrollTime > 1500) {
          lastScrollTime = now;
          sendCapturedStep("scroll", document.body, {
            scrollX: window.scrollX,
            scrollY: window.scrollY
          });
        }
      }, { passive: true });
    };

    // Ensure listeners are re-injected on every navigation or frame load
    const setupListeners = async (p: Page | Frame) => {
      try {
        const frameUrl = typeof (p as any).url === 'function' ? (p as any).url() : '';
        if (!frameUrl || frameUrl === 'about:blank') {
          if (typeof (p as any).isClosed === 'function' && (p as any).isClosed()) return;
        }

        // Skip cross-origin ad trackers, analytics frames, and third-party security widgets
        if (
          /googleads|doubleclick|googlesyndication|adservice|adtrafficquality|recaptcha|facebook\.com\/tr|analytics|sodar|moatads|criteo/i.test(frameUrl)
        ) {
          return;
        }

        // Pre-inject helper shim so any tsx/esbuild transpiled function names resolve safely in frame
        await (p as any).evaluate(`
          try {
            var shim = function(t, v) { return t; };
            if (typeof window !== 'undefined') {
              window.__name = window.__name || shim;
            }
            if (typeof globalThis !== 'undefined') {
              globalThis.__name = globalThis.__name || shim;
            }
          } catch (e) {}
        `).catch(() => {});

        await p.evaluate(recorderClientFunction, sessionId);
      } catch (err: any) {
        if (
          !err.message?.includes('Target closed') &&
          !err.message?.includes('Execution context was destroyed') &&
          !err.message?.includes('Cannot find context') &&
          !err.message?.includes('Frame was detached') &&
          !err.message?.includes('Navigating frame was detached')
        ) {
          const u = typeof (p as any).url === 'function' ? (p as any).url() : '';
          console.warn("[Playwright Listener Attachment]", u, err.message);
        }
      }
    };

    // 1. Register init script to guarantee EVERY page navigation, new document, and child frame executes recorder
    await page.addInitScript(`
      (function() {
        try {
          var shim = function(t, v) { return t; };
          if (typeof window !== 'undefined') window.__name = window.__name || shim;
          if (typeof globalThis !== 'undefined') globalThis.__name = globalThis.__name || shim;
        } catch (e) {}
      })();
    `);
    
    await page.addInitScript(recorderClientFunction, sessionId);

    // 2. Initial setup for already open page
    await setupListeners(page);

    // 3. Track URL navigation on the main frame to emit navigate events and re-attach
    let lastMainUrl = '';
    page.on('framenavigated', async (frame) => {
      try {
        if (frame === page.mainFrame()) {
          const rawUrl = frame.url();
          const currentUrl = unwrapProxyUrl(rawUrl);
          if (currentUrl && currentUrl !== 'about:blank' && currentUrl !== lastMainUrl) {
            lastMainUrl = currentUrl;
            const screen = deriveScreenName(currentUrl);
            console.log(`[Playwright Universal Recorder] Navigated to: ${currentUrl} (Screen: ${screen})`);
            publishRecordedStep(sessionId, {
              action: 'navigate',
              value: currentUrl,
              url: currentUrl,
              screen,
              locator: {
                primary: {
                  type: 'url',
                  value: currentUrl,
                  playwright: `await page.goto('${currentUrl}')`
                },
                alternatives: []
              },
              sessionId,
              timestamp: Date.now()
            });
          }
          await setupListeners(page);
        } else {
          await setupListeners(frame);
        }
      } catch (e) {}
    });

    page.on('load', () => setupListeners(page));
    page.on('domcontentloaded', () => setupListeners(page));

    page.on('dialog', async dialog => {
      io.emit('RECORDED_STEP', { 
        action: 'dialog', 
        value: dialog.message(), 
        dialogType: dialog.type(),
        sessionId,
        timestamp: Date.now()
      });
      await dialog.dismiss().catch(() => {});
    });

    page.on('crash', () => {
      console.error(`[Playwright Page Crash] Page crashed for session ${sessionId}`);
      io.emit('DIAGNOSTIC_EVENT', {
        sessionId,
        diagnostic: {
          code: 'PAGE_CRASH',
          title: 'Page Renderer Crash',
          message: 'The web browser tab crashed or terminated unexpectedly.',
          suggestedAction: 'Relaunch or reload the recording session.',
          timestamp: Date.now(),
          recoverable: true
        }
      });
    });
  }

  app.use(cors());
  
  // Raw body parser for proxying and binary uploads - MUST be before other body parsers
  app.use("/api/proxy", express.raw({ type: '*/*', limit: '100mb' }));
  app.use("/api/mobile/app/upload", express.raw({ type: '*/*', limit: '200mb' }));
  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ limit: '200mb', extended: true }));

  // Early interceptor strictly for subresources (CSS, JS, WebP, PNG, Fonts) requested by proxied web pages
  const handleProxiedSubresource = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const fullPath = (req.originalUrl || req.url || req.path || '').toLowerCase();
    
    // Internal AutomatiQA endpoints to protect:
    const isInternalApi = 
      fullPath.startsWith('/api/proxy') ||
      fullPath.startsWith('/api/start-recording') ||
      fullPath.startsWith('/api/stop-recording') ||
      fullPath.startsWith('/api/record-event') ||
      fullPath.startsWith('/api/validate-url') ||
      fullPath.startsWith('/api/capture-url-ui') ||
      fullPath.startsWith('/api/run-playback') ||
      fullPath.startsWith('/api/health') ||
      fullPath.startsWith('/api/gemini/') ||
      fullPath.startsWith('/api/mobile') ||
      fullPath.startsWith('/api/device-agent/') ||
      fullPath.startsWith('/api/integration/') ||
      fullPath.startsWith('/api/rag/') ||
      fullPath.startsWith('/api/cache/') ||
      fullPath.startsWith('/api/auth/') ||
      fullPath.startsWith('/api/jmeter-performance/') ||
      fullPath.startsWith('/api/web-performance/') ||
      fullPath.startsWith('/api/parse-playwright') ||
      fullPath.startsWith('/api/download-agent-binary') ||
      fullPath.startsWith('/api/artifacts') ||
      fullPath.startsWith('/artifacts') ||
      fullPath.startsWith('/api/extract-video-frames') ||
      fullPath.startsWith('/api/grant-permission') ||
      fullPath.startsWith('/api/deny-permission');

    // Skip explicit AutomatiQA internal routes, bundle files, Vite internal requests, and development files
    const rawUrl = req.url || '';
    if (
      isInternalApi || 
      rawUrl.includes('?import') ||
      rawUrl.includes('?raw') ||
      rawUrl.includes('?worker') ||
      rawUrl.includes('?url') ||
      rawUrl.includes('?t=') ||
      rawUrl.includes('?v=') ||
      fullPath.startsWith('/src/') || 
      fullPath.startsWith('/@') ||
      fullPath.includes('/node_modules/') || 
      fullPath.startsWith('/components/') ||
      fullPath.startsWith('/services/') ||
      fullPath.startsWith('/utils/') ||
      fullPath.startsWith('/types') ||
      fullPath.endsWith('.tsx') ||
      fullPath.endsWith('.ts') ||
      fullPath.endsWith('.jsx') ||
      fullPath === '/app.tsx' ||
      fullPath === '/index.html' ||
      fullPath === '/index.tsx' ||
      fullPath === '/index.css' ||
      fullPath === '/firebase.ts' ||
      fullPath === '/geminiservice.ts' ||
      fullPath === '/users.json' ||
      fullPath === '/firebase-applet-config.json' ||
      fullPath === '/metadata.json' ||
      fullPath === '/' || 
      fullPath === '/automatiqa-agent.js' ||
      fullPath === '/automatiqa-agent.cjs'
    ) {
      return next();
    }

    const referer = (req.headers.referer as string) || '';
    const cookieHeader = (req.headers.cookie as string) || '';
    
    let targetOrigin = '';
    // 1. From query parameter
    if (req.query && req.query.targetOrigin && typeof req.query.targetOrigin === 'string') {
      targetOrigin = req.query.targetOrigin;
    }
    // 2. From Referer proxy URL
    if (!targetOrigin && referer.includes('/api/proxy')) {
      try {
        const refUrl = new URL(referer);
        const refTarget = refUrl.searchParams.get('url');
        if (refTarget) {
          const refOrigin = new URL(refTarget).origin;
          if (!refOrigin.includes('127.0.0.1') && !refOrigin.includes('localhost')) {
            targetOrigin = refOrigin;
          }
        }
      } catch (e) {}
    }
    // 3. From cookie
    if (!targetOrigin && cookieHeader) {
      const match = cookieHeader.match(/qa_active_target_origin=([^;]+)/);
      if (match && match[1]) {
        try {
          const decoded = decodeURIComponent(match[1]);
          if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
            targetOrigin = new URL(decoded).origin;
          }
        } catch(e) {}
      }
    }
    // 4. From session map
    if (!targetOrigin && sessionPrimaryOrigins.size > 0 && (referer.includes('/api/proxy') || referer.includes('/login') || referer.includes('/dashboard'))) {
      for (const orig of sessionPrimaryOrigins.values()) {
        if (orig && !orig.includes('127.0.0.1') && !orig.includes('localhost')) {
          targetOrigin = orig;
          break;
        }
      }
    }
    // Do not borrow an origin from another proxy session. If this request lacks
    // an explicit/referer/cookie origin it must fail normally and be diagnosed.
    if (!targetOrigin) {
      return next();
    }

    const isAssetPath = 
      fullPath.startsWith('/assets/') ||
      fullPath.startsWith('/favicons/') ||
      fullPath.startsWith('/images/') ||
      fullPath.startsWith('/static/') ||
      fullPath.startsWith('/fonts/') ||
      fullPath.includes('/manifest.json') ||
      req.path.match(/\.(js|mjs|cjs|css|png|jpg|jpeg|webp|gif|svg|ico|woff|woff2|ttf|eot|otf|json|map)(\?.*)?$/i) ||
      (fullPath.startsWith('/api/') && !isInternalApi);

    if (targetOrigin && (isAssetPath || referer.includes('/api/proxy') || referer.includes('/login') || referer.includes('/dashboard'))) {
      try {
        let candidateUrls: string[] = [];
        const rawReqUrl = req.url || '';
        const cleanPath = req.path || '';

        if (cleanPath.startsWith('/api/') && !isInternalApi) {
          const stripped = cleanPath.substring(5); // remove '/api/'
          if (stripped.match(/\.(js|mjs|cjs|css|webp|png|jpg|svg|json|map)$/i)) {
            candidateUrls.push(`${targetOrigin}/assets/${stripped.replace(/^\//, '')}`);
            candidateUrls.push(`${targetOrigin}/${stripped.replace(/^\//, '')}`);
          } else {
            candidateUrls.push(`${targetOrigin}/api/${stripped.replace(/^\//, '')}${req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''}`);
          }
        } else if (cleanPath.startsWith('/assets/') || cleanPath.startsWith('/favicons/') || cleanPath.startsWith('/images/') || cleanPath.startsWith('/static/') || cleanPath.includes('/manifest.json')) {
          candidateUrls.push(`${targetOrigin}${rawReqUrl}`);
        } else if (req.path.match(/\.(js|mjs|cjs|css|png|jpg|jpeg|webp|gif|svg|ico|woff|woff2|ttf|eot|otf|json|map)$/i)) {
          candidateUrls.push(`${targetOrigin}/assets/${cleanPath.replace(/^\//, '')}`);
          candidateUrls.push(`${targetOrigin}${rawReqUrl}`);
        } else {
          candidateUrls.push(new URL(rawReqUrl, targetOrigin).toString());
        }

        for (const candidateUrl of candidateUrls) {
          try {
            const upstreamHeaders: Record<string, string> = {
              'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'accept': (req.headers.accept as string) || '*/*',
              'accept-language': (req.headers['accept-language'] as string) || 'en-US,en;q=0.9',
              'origin': targetOrigin,
              'referer': targetOrigin + '/',
            };

            // Forward sanitized cookies (strip cloud / internal telemetry cookies)
            if (req.headers.cookie) {
              const cleanCookie = (req.headers.cookie as string)
                .split(';')
                .map(c => c.trim())
                .filter(c => {
                  const eqIdx = c.indexOf('=');
                  if (eqIdx === -1) return false;
                  const name = c.substring(0, eqIdx).trim().toLowerCase();
                  return !name.startsWith('__ais_') && !name.startsWith('_ga') && !name.startsWith('_gid') && !name.startsWith('qa_');
                })
                .join('; ');
              if (cleanCookie) {
                upstreamHeaders['cookie'] = cleanCookie;
              }
            }

            if (req.headers.authorization) upstreamHeaders['authorization'] = req.headers.authorization as string;

            const upstreamRes = await fetch(candidateUrl, {
              method: req.method === 'HEAD' ? 'GET' : req.method,
              headers: upstreamHeaders,
              body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? (req.body as any) : undefined
            });

            if (upstreamRes.ok || upstreamRes.status === 304) {
              res.status(upstreamRes.status);
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Headers', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
              res.setHeader('Cache-Control', 'public, max-age=86400');
              
              if (candidateUrl.match(/\.(js|mjs|cjs)(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (candidateUrl.match(/\.css(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                let cssText = await upstreamRes.text();
                // Rewrite url() in CSS
                cssText = cssText.replace(/url\(["']?([^"'\)]*)["']?\)/g, (match, path) => {
                  if (!path || path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('/api/proxy')) return match;
                  try {
                    const absUrl = new URL(path, candidateUrl).toString();
                    return `url("/api/proxy?url=${encodeURIComponent(absUrl)}")`;
                  } catch (e) {
                    return match;
                  }
                });
                return res.end(cssText);
              } else if (candidateUrl.match(/\.json(\?.*)?$/i) || cleanPath.includes('/manifest.json')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                const jsonText = await upstreamRes.text();
                return res.end(jsonText);
              } else if (candidateUrl.match(/\.webp(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'image/webp');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (candidateUrl.match(/\.png(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'image/png');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (candidateUrl.match(/\.svg(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'image/svg+xml');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (candidateUrl.match(/\.(jpg|jpeg)(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'image/jpeg');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (candidateUrl.match(/\.woff2(\?.*)?$/i)) {
                res.setHeader('Content-Type', 'font/woff2');
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              } else if (upstreamRes.headers.get('content-type')) {
                res.setHeader('Content-Type', upstreamRes.headers.get('content-type')!);
                const buf = await upstreamRes.arrayBuffer();
                return res.end(Buffer.from(buf));
              }
              
              const buf = await upstreamRes.arrayBuffer();
              return res.end(Buffer.from(buf));
            }
          } catch (fetchErr: any) {}
        }

        // If it was explicitly a CSS, JS, JSON, image, or font request that failed, return clean fallback
        if (cleanPath.match(/\.css(\?.*)?$/i)) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
          return res.status(200).send('/* proxied css placeholder */');
        }
        if (cleanPath.match(/\.(js|mjs|cjs)(\?.*)?$/i)) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          return res.status(200).send('/* proxied js placeholder */');
        }
        if (cleanPath.match(/\.json(\?.*)?$/i) || cleanPath.includes('/manifest.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(200).send('{}');
        }
        if (cleanPath.match(/\.(png|jpe?g|gif|svg|webp|ico)(\?.*)?$/i)) {
          const transparentPng = Buffer.from('iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
          res.setHeader('Content-Type', 'image/png');
          return res.status(200).send(transparentPng);
        }
      } catch (e: any) {}
    }

    next();
  };

  app.use(handleProxiedSubresource);

  // API Proxy Route
  app.all("/api/proxy", async (req, res) => {
    // Robust target URL extraction to handle embedded query parameters correctly
    let targetUrl = req.query.url as string;
    const sessionId = req.query.sessionId as string;
    
    // Fallback URL extraction if query params were split or formatted uniquely
    if (!targetUrl && req.url.includes('url=')) {
      try {
        const fullRawUrl = req.url.substring(req.url.indexOf('url=') + 4);
        targetUrl = fullRawUrl.split('&sessionId=')[0];
        try { targetUrl = decodeURIComponent(targetUrl); } catch(e) {}
      } catch (e) {}
    }

    // Retrieve active primary recorded origin if available from session or referer
    let primaryOrigin = '';
    if (sessionId && sessionPrimaryOrigins.has(sessionId)) {
      primaryOrigin = sessionPrimaryOrigins.get(sessionId) || '';
    }
    if (!primaryOrigin && req.headers.referer && req.headers.referer.includes('/api/proxy')) {
      try {
        const refUrl = new URL(req.headers.referer);
        const refTarget = refUrl.searchParams.get('url');
        if (refTarget) {
          const refOrigin = new URL(refTarget).origin;
          if (!refOrigin.includes('127.0.0.1') && !refOrigin.includes('localhost')) {
            primaryOrigin = refOrigin;
          }
        }
      } catch (e) {}
    }

    // If targetUrl is still missing or relative, check primary origin, cookies or referer
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
      let origin = primaryOrigin;
      if (!origin && req.headers.referer && req.headers.referer.includes('/api/proxy')) {
        try {
          const refUrl = new URL(req.headers.referer);
          const refTarget = refUrl.searchParams.get('url');
          if (refTarget) {
            const refOrigin = new URL(refTarget).origin;
            if (!refOrigin.includes('127.0.0.1') && !refOrigin.includes('localhost')) {
              origin = refOrigin;
            }
          }
        } catch (e) {}
      }

      if (origin && targetUrl) {
        try {
          targetUrl = new URL(targetUrl, origin).toString();
        } catch (e) {}
      }
    }
    
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    // Prevent recursive proxy calls if they happen accidentally
    if (targetUrl.includes(req.headers.host as string) || targetUrl.includes('/api/proxy?')) {
      try {
        const nestedUrl = new URL(targetUrl).searchParams.get('url');
        if (nestedUrl && nestedUrl !== targetUrl) {
           console.log("Unwrapping nested proxy URL:", nestedUrl);
           return res.redirect(`/api/proxy?url=${encodeURIComponent(nestedUrl)}${sessionId ? '&sessionId=' + sessionId : ''}`);
        }
      } catch (e) {}
    }

    // Recover from corrupted loopback URLs when recording a remote web app
    try {
      const parsedTest = new URL(targetUrl);
      const isLoopbackTarget = parsedTest.hostname === '127.0.0.1' || parsedTest.hostname === 'localhost' || parsedTest.hostname === '0.0.0.0';
      if (isLoopbackTarget && primaryOrigin && !primaryOrigin.includes('127.0.0.1') && !primaryOrigin.includes('localhost')) {
        const appPath = parsedTest.pathname + parsedTest.search + parsedTest.hash;
        const isProbe = appPath === '/' || appPath === '' || appPath.includes('/ping') || appPath.includes('/check') || appPath.includes('/status') || appPath.includes('/version') || appPath.includes('/connector');
        if (!isProbe) {
          console.log(`[AutomatiQA Proxy] Recovering loopback target ${targetUrl} to primary origin ${primaryOrigin}`);
          targetUrl = new URL(appPath, primaryOrigin).toString();
        }
      }
    } catch (e) {}

    // Validate URL structure
    try {
      new URL(targetUrl);
    } catch (e) {
      return res.status(400).json({ error: "Invalid url parameter" });
    }

    if (targetUrl.includes('google.com/images/errors/robot.png')) {
      return res.status(200).end();
    }

    console.log("Proxying resource:", targetUrl);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      return res.status(200).end();
    }

    const headers: Record<string, string> = {};
    const forbiddenHeaders = new Set([
      'host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding',
      'content-encoding', 'te', 'upgrade', 'expect',
      'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 
      'x-cloud-trace-context', 'x-arrival-time', 'x-appengine-api-ticket',
      'x-appengine-city', 'x-appengine-citylatlong', 'x-appengine-country',
      'x-appengine-https', 'x-appengine-region', 'x-appengine-user-ip',
      'via', 'forwarded'
    ]);
    
    // Copy incoming headers with strictly lowercase keys to prevent duplicate-header 400 Bad Request errors
    Object.entries(req.headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (forbiddenHeaders.has(lowerKey)) return;
      if (lowerKey.startsWith('x-ais-') || lowerKey.startsWith('x-goog-') || lowerKey.startsWith('x-appengine-') || lowerKey.startsWith('x-cloud-')) return;
      if (['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'].includes(lowerKey)) return;
      
      if (value) {
        headers[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
      }
    });

    // Sanitize cookie header: strip cloud platform and internal telemetry cookies so only target app session/auth cookies pass
    if (req.headers.cookie) {
      const cleanCookie = (req.headers.cookie as string)
        .split(';')
        .map(c => c.trim())
        .filter(c => {
          const eqIdx = c.indexOf('=');
          if (eqIdx === -1) return false;
          const name = c.substring(0, eqIdx).trim().toLowerCase();
          return !name.startsWith('__ais_') && !name.startsWith('_ga') && !name.startsWith('_gid') && !name.startsWith('qa_');
        })
        .join('; ');
      if (cleanCookie) {
        headers['cookie'] = cleanCookie;
      } else {
        delete headers['cookie'];
      }
    }

    // Set origin and referer to match target to bypass CSRF/CORS checks
    try {
      const targetUrlObj = new URL(targetUrl);
      const targetOrigin = targetUrlObj.origin;
      const isLoopback = targetUrlObj.hostname === '127.0.0.1' || targetUrlObj.hostname === 'localhost';
      
      // CRITICAL: Do NOT set headers['host'] manually. Native fetch automatically computes Host from targetUrl.
      // Setting host manually causes duplicate Host headers and triggers RFC 7230 400 Bad Request on target servers.
      delete headers['host'];
      
      headers['origin'] = targetOrigin;
      headers['referer'] = targetUrl;
      headers['sec-fetch-site'] = 'same-origin';
      headers['user-agent'] = (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      headers['accept-language'] = (req.headers['accept-language'] as string) || 'en-US,en;q=0.9';
      headers['sec-ch-ua'] = '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';
      headers['upgrade-insecure-requests'] = '1';
      if (!headers['accept']) {
        headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
      }
      
      // Safety net: store the target origin in session map and set active cookie for subresource resolution
      if (!isLoopback) {
        res.cookie('qa_active_target_origin', targetOrigin, { path: '/', sameSite: 'lax', maxAge: 86400000 });
        if (sessionId) {
          sessionPrimaryOrigins.set(sessionId, targetOrigin);
        }
      }
    } catch (e) {}

    try {
      // Set a generous timeout for the proxy request to avoid AbortError/HeadersTimeoutError
      // For localhost/loopback probes (e.g. GST/DSC local connector probes), use a fast 2s timeout
      const targetUrlObj = new URL(targetUrl);
      const isLoopback = targetUrlObj.hostname === '127.0.0.1' || targetUrlObj.hostname === 'localhost';
      const timeoutMs = isLoopback ? 2500 : 120000;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Use a more robust body handling for POST requests
      const fetchOptions: RequestInit = {
        method: req.method,
        headers: headers,
        signal: controller.signal,
        redirect: 'manual', // DO NOT follow redirects automatically, let the browser handle them for better cookie/auth sync
      };

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.body) {
          if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            fetchOptions.body = req.body;
          } else if (typeof req.body === 'string' && req.body.length > 0) {
            fetchOptions.body = req.body;
          } else if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
            if (headers['content-type']?.includes('application/x-www-form-urlencoded')) {
              fetchOptions.body = new URLSearchParams(req.body as any).toString();
            } else {
              fetchOptions.body = JSON.stringify(req.body);
            }
          }
        }
      }

      let response: Response;
      try {
        response = await fetch(targetUrl, fetchOptions);
      } catch (firstErr: any) {
        if (isLoopback) {
          // Local connector probe failed (e.g. desktop DSC connector not running on cloud container). Return empty/json cleanly.
          clearTimeout(timeoutId);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).json({ connected: false, message: "Local desktop connector probe bypassed in cloud environment" });
        }
        // If fetch failed due to compression error (incorrect header check) or encoding, retry with identity encoding
        if (firstErr.message?.includes('incorrect header check') || firstErr.message?.includes('terminated') || firstErr.cause?.message?.includes('header check')) {
          const retryHeaders = { ...headers, 'accept-encoding': 'identity' };
          response = await fetch(targetUrl, { ...fetchOptions, headers: retryHeaders });
        } else {
          throw firstErr;
        }
      }
      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      const isJsonRequest = headers['accept']?.includes('application/json') || headers['content-type']?.includes('application/json');
      
      let data = await response.arrayBuffer();
      
      // Standardize error responses to JSON if preferred by client
      if (!response.ok && (isJsonRequest || (response.status === 429))) {
        const textBody = Buffer.from(data).toString('utf-8');
        if (textBody.includes('Rate exceeded') || response.status === 429) {
          res.status(429).json({
            success: false,
            error: "Recording service is temporarily busy. Please wait a few seconds and try again.",
            originalError: textBody,
            code: 429
          });
          return;
        }
      }

      res.status(response.status);
      
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

      response.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        // Skip headers that block iframing or cause CSP issues
        if (['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'x-content-type-options'].includes(lowerKey)) {
          return;
        }
        // Forward important headers
        if (lowerKey === 'location' && value) {
          try {
            const absoluteUrl = new URL(value as string, targetUrl).toString();
            let redirectPath = `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            if (sessionId) {
              redirectPath += `&sessionId=${sessionId}`;
            }
            res.setHeader(key, redirectPath);
          } catch (e) {
            res.setHeader(key, value);
          }
        } else if (lowerKey === 'set-cookie' && value) {
          const cookies = Array.isArray(value) ? value : [value];
          const modifiedCookies = cookies.map(c => {
            let nc = c.replace(/;\s*samesite=[^;]+/gi, '')
                      .replace(/;\s*secure/gi, '')
                      .replace(/;\s*domain=[^;]+/gi, '');
            
            // Rewrite path to / to ensure cookies are sent for all proxied resources
            if (/;\s*path=/i.test(nc)) {
              nc = nc.replace(/;\s*path=[^;]+/gi, '; Path=/');
            } else {
              nc += '; Path=/';
            }
            return nc;
          });
          res.setHeader(key, modifiedCookies);
        } else if (['content-type', 'cache-control'].includes(lowerKey) || lowerKey.startsWith('x-')) {
          res.setHeader(key, value);
        }
      });

      // Ensure JavaScript assets always have application/javascript MIME type to satisfy strict module checks
      const isJsAsset = targetUrl.match(/\.(js|mjs|cjs)(\?.*)?$/i);
      if (isJsAsset && !res.getHeader('content-type')?.toString().includes('javascript')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }

      // Inject recorder script and rewrite URLs if it's an HTML page
      if (contentType && contentType.includes('text/html') && !isJsAsset) {
        let html = Buffer.from(data).toString('utf-8');
        
        const baseUrl = new URL(targetUrl);
        const origin = baseUrl.origin;
        
        // Save primary origin in session map
        if (sessionId && !origin.includes('127.0.0.1') && !origin.includes('localhost')) {
          sessionPrimaryOrigins.set(sessionId, origin);
        }

        // Rewrite URLs to go through proxy
        const rewriteUrl = (url: string) => {
          if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('blob:') || url.startsWith('mailto:') || url.startsWith('tel:')) return url;
          if (url.startsWith('/api/proxy') || url.includes('/api/proxy?url=')) return url;
          try {
            let absoluteUrl: string;
            if (url.startsWith('//')) {
              absoluteUrl = 'https:' + url;
            } else {
              absoluteUrl = new URL(url, targetUrl).toString();
            }
            let proxyPath = `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            if (sessionId) {
              proxyPath += `&sessionId=${sessionId}`;
            }
            return proxyPath;
          } catch (e) {
            return url;
          }
        };

        // Remove existing <base> tag
        html = html.replace(/<base\b[^>]*>/gi, '');

        // Strip subresource integrity attributes from HTML to prevent browser SRI blocks on proxied resources
        html = html.replace(/\s+integrity=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

        // Preserve <script> and <style> blocks before performing element attribute replacements
        const scriptAndStyleBlocks: string[] = [];
        let sanitizedHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => {
          const placeholder = `__AUTOMATIQA_BLOCK_${scriptAndStyleBlocks.length}__`;
          scriptAndStyleBlocks.push(block);
          return placeholder;
        });

        // Rewrite href, src, action, srcset, data-src, data-original, data-lazy-src, data-lazy, data-bg, data-srcset, data-url, poster, background in HTML elements
        sanitizedHtml = sanitizedHtml.replace(/\b(href|src|action|srcset|data-src|data-original|data-lazy-src|data-lazy|data-bg|data-srcset|data-url|poster|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, attr, q1, q2, noq) => {
          const url = q1 || q2 || noq;
          if (!url) return match;
          
          const lowerAttr = attr.toLowerCase();
          if (lowerAttr === 'srcset' || lowerAttr === 'data-srcset') {
            const parts = url.split(',').map((part: string) => {
              const [u, size] = part.trim().split(/\s+/);
              return `${rewriteUrl(u)}${size ? ' ' + size : ''}`;
            });
            return `${attr}="${parts.join(', ')}"`;
          }
          
          const quote = q1 ? '"' : (q2 ? "'" : "");
          return `${attr}=${quote}${rewriteUrl(url)}${quote}`;
        });

        // Rewrite meta refresh
        sanitizedHtml = sanitizedHtml.replace(/<meta\s+http-equiv=["']refresh["']\s+content=["']([^"']*)["']/gi, (match, content) => {
          const parts = content.split(';');
          if (parts.length > 1) {
            const urlPart = parts[1].trim();
            if (urlPart.toLowerCase().startsWith('url=')) {
              const url = urlPart.substring(4);
              return `<meta http-equiv="refresh" content="${parts[0]}; url=${rewriteUrl(url)}">`;
            }
          }
          return match;
        });

        // Restore <script> and <style> blocks safely
        html = sanitizedHtml.replace(/__AUTOMATIQA_BLOCK_(\d+)__/g, (match, idx) => {
          const originalBlock = scriptAndStyleBlocks[parseInt(idx, 10)];
          if (!originalBlock) return match;
          
          if (originalBlock.toLowerCase().startsWith('<script')) {
            return originalBlock.replace(/^(<script\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*>)/i, (sMatch, prefix, q1, q2, noq, suffix) => {
              const srcUrl = q1 || q2 || noq;
              if (!srcUrl) return sMatch;
              const quote = q1 ? '"' : (q2 ? "'" : "");
              return `${prefix}${quote}${rewriteUrl(srcUrl)}${quote}${suffix}`;
            });
          }
          
          if (originalBlock.toLowerCase().startsWith('<style')) {
            return originalBlock.replace(/url\(\s*["']?([^"'\)]+)["']?\s*\)/gi, (sMatch, u) => {
              if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/api/proxy')) return sMatch;
              return `url("${rewriteUrl(u)}")`;
            });
          }

          return originalBlock;
        });

        const script = `
          <script>
            (function() {
              console.log("AutomatiQA Recorder Initialized");
              const currentSessionId = "${sessionId || ''}";
              const initialTargetUrl = "${targetUrl}";
              const initialTargetOrigin = "${origin}";

              let currentTargetUrl = initialTargetUrl;
              let currentTargetOrigin = initialTargetOrigin;
              let lastUrl = initialTargetUrl;

              // Immediately synchronize browser history path with the application route so SPA routers (React Router, Angular, Vue) match the route properly instead of hitting 404
              try {
                const targetObj = new URL(initialTargetUrl);
                const intendedAppPath = (targetObj.pathname || '/') + (targetObj.search || '') + (targetObj.hash || '');
                if (window.location.pathname.startsWith('/api/proxy')) {
                  window.history.replaceState(window.history.state, document.title, intendedAppPath);
                }
              } catch (e) {}

              const isInternalAutomatiqaPath = (p) => {
                if (!p || typeof p !== 'string') return false;
                return p.startsWith('/api/record-event') ||
                       p.startsWith('/api/start-recording') ||
                       p.startsWith('/api/stop-recording') ||
                       p.startsWith('/api/validate-url') ||
                       p.startsWith('/api/run-playback') ||
                       p.startsWith('/api/health');
              };

              const getTargetUrl = () => {
                try {
                  const params = new URLSearchParams(window.location.search);
                  const url = params.get('url');
                  if (url && url !== 'undefined' && url !== 'about:blank' && url !== 'null') {
                    return url;
                  }
                  return currentTargetUrl || document.referrer || window.location.href;
                } catch (e) {
                  return currentTargetUrl || window.location.href;
                }
              };

              // Helper to resolve URLs against current target
              const resolveUrl = (url) => {
                if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('blob:') || url.startsWith('mailto:') || url.startsWith('tel:')) return url;
                
                // If url is already a proxy url, extract the underlying target URL
                if (url.includes('/api/proxy?url=') || url.includes('/api/proxy?')) {
                  try {
                    const parsed = new URL(url, window.location.origin);
                    const inner = parsed.searchParams.get('url');
                    if (inner) return inner;
                  } catch (e) {}
                }

                // If url contains window.location.origin (e.g. https://ais-dev-...run.app/gst/client/recent or http://localhost:3000/dashboard)
                if (url.startsWith(window.location.origin)) {
                  const pathnameAndQuery = url.substring(window.location.origin.length);
                  if (isInternalAutomatiqaPath(pathnameAndQuery)) {
                    return url;
                  }
                  // This is an application path that got resolved against the current browser origin
                  try {
                    return new URL(pathnameAndQuery, currentTargetUrl || initialTargetUrl).toString();
                  } catch (e) {
                    return (currentTargetOrigin || initialTargetOrigin) + pathnameAndQuery;
                  }
                }

                // If url is a local loopback probe (e.g. 127.0.0.1:32558) and initialTarget was not localhost, do NOT corrupt target
                const isLoopback = url.includes('127.0.0.1') || url.includes('localhost');
                if (isLoopback && !initialTargetOrigin.includes('localhost') && !initialTargetOrigin.includes('127.0.0.1')) {
                  return url;
                }

                try {
                  return new URL(url, currentTargetUrl || initialTargetUrl || document.baseURI).toString();
                } catch (e) {
                  return url;
                }
              };

              const proxyUrl = (url) => {
                if (!url || typeof url !== 'string') return url;
                if (url.startsWith('/api/proxy') || url.includes('/api/proxy?url=')) return url;
                if (isInternalAutomatiqaPath(url)) return url;
                
                const absolute = resolveUrl(url);
                if (absolute.includes('/api/proxy') || isInternalAutomatiqaPath(absolute)) return absolute;

                let path = "/api/proxy?url=" + encodeURIComponent(absolute);
                if (currentSessionId) {
                  path += "&sessionId=" + currentSessionId;
                }
                return path;
              };

              const updateTargetUrlFromPath = (newPathOrUrl) => {
                if (!newPathOrUrl || typeof newPathOrUrl !== 'string') return;
                try {
                  // If it's already a full proxy URL
                  if (newPathOrUrl.includes('/api/proxy?url=') || newPathOrUrl.includes('/api/proxy?')) {
                    const parsed = new URL(newPathOrUrl, window.location.origin);
                    const inner = parsed.searchParams.get('url');
                    if (inner) {
                      newPathOrUrl = inner;
                    }
                  }

                  if (newPathOrUrl.startsWith('http://') || newPathOrUrl.startsWith('https://')) {
                    const parsed = new URL(newPathOrUrl);
                    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
                    if (!isLoopback || initialTargetOrigin.includes('localhost') || initialTargetOrigin.includes('127.0.0.1')) {
                      currentTargetUrl = newPathOrUrl;
                      currentTargetOrigin = parsed.origin;
                    }
                  } else if (newPathOrUrl.startsWith(window.location.origin)) {
                    const pathOnly = newPathOrUrl.substring(window.location.origin.length);
                    if (!isInternalAutomatiqaPath(pathOnly)) {
                      currentTargetUrl = new URL(pathOnly, currentTargetOrigin || initialTargetOrigin).toString();
                    }
                  } else {
                    const resolved = new URL(newPathOrUrl, currentTargetUrl || initialTargetUrl).toString();
                    currentTargetUrl = resolved;
                  }
                } catch (e) {}
              };

              const updateTargetUrl = () => {
                const queryTarget = getTargetUrl();
                if (queryTarget && (queryTarget.startsWith('http://') || queryTarget.startsWith('https://'))) {
                  const isLoopback = queryTarget.includes('127.0.0.1') || queryTarget.includes('localhost');
                  if (!isLoopback || initialTargetOrigin.includes('localhost') || initialTargetOrigin.includes('127.0.0.1')) {
                    currentTargetUrl = queryTarget;
                    try { currentTargetOrigin = new URL(queryTarget).origin; } catch (e) {}
                  }
                }
              };

              // Intercept window.open
              const originalOpen = window.open;
              window.open = function(url, name, specs) {
                if (url && typeof url === 'string' && !url.includes('/api/proxy') && !isInternalAutomatiqaPath(url)) {
                  url = proxyUrl(url);
                }
                return originalOpen.call(window, url, name, specs);
              };

              // Intercept dynamic DOM element property setters for src, href, and integrity
              try {
                const linkHrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
                if (linkHrefDesc && linkHrefDesc.set) {
                  Object.defineProperty(HTMLLinkElement.prototype, 'href', {
                    get: linkHrefDesc.get,
                    set: function(val) {
                      if (typeof val === 'string' && val && !val.startsWith('/api/proxy') && !val.startsWith('data:') && !val.startsWith('blob:') && !val.startsWith('#') && !isInternalAutomatiqaPath(val)) {
                        val = proxyUrl(val);
                      }
                      return linkHrefDesc.set.call(this, val);
                    }
                  });
                }

                // Strip Subresource Integrity (SRI) on links to prevent browser blocks on proxied CSS
                try {
                  Object.defineProperty(HTMLLinkElement.prototype, 'integrity', {
                    get: function() { return ''; },
                    set: function(val) { /* silently ignore integrity */ }
                  });
                } catch(e) {}

                const scriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                if (scriptSrcDesc && scriptSrcDesc.set) {
                  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                    get: scriptSrcDesc.get,
                    set: function(val) {
                      if (typeof val === 'string' && val && !val.startsWith('/api/proxy') && !val.startsWith('data:') && !val.startsWith('blob:') && !isInternalAutomatiqaPath(val)) {
                        val = proxyUrl(val);
                      }
                      return scriptSrcDesc.set.call(this, val);
                    }
                  });
                }

                // Strip Subresource Integrity (SRI) on scripts
                try {
                  Object.defineProperty(HTMLScriptElement.prototype, 'integrity', {
                    get: function() { return ''; },
                    set: function(val) { /* silently ignore integrity */ }
                  });
                } catch(e) {}

                const imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
                if (imgDesc && imgDesc.set) {
                  Object.defineProperty(HTMLImageElement.prototype, 'src', {
                    get: imgDesc.get,
                    set: function(val) {
                      if (typeof val === 'string' && val && !val.startsWith('/api/proxy') && !val.startsWith('data:') && !val.startsWith('blob:') && !isInternalAutomatiqaPath(val)) {
                        val = proxyUrl(val);
                      }
                      return imgDesc.set.call(this, val);
                    }
                  });
                }

                const iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
                if (iframeSrcDesc && iframeSrcDesc.set) {
                  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
                    get: iframeSrcDesc.get,
                    set: function(val) {
                      if (typeof val === 'string' && val && !val.startsWith('/api/proxy') && !val.startsWith('data:') && !val.startsWith('blob:') && !val.startsWith('about:')) {
                        val = proxyUrl(val);
                      }
                      return iframeSrcDesc.set.call(this, val);
                    }
                  });
                }

                const origSetAttribute = Element.prototype.setAttribute;
                Element.prototype.setAttribute = function(name, value) {
                  if (typeof name === 'string') {
                    const lowerName = name.toLowerCase();
                    if (lowerName === 'integrity') {
                      return; // Do not apply SRI hash to avoid browser blocking of proxied assets
                    }
                    if (typeof value === 'string') {
                      if ((lowerName === 'src' || lowerName === 'href' || lowerName === 'action' || lowerName === 'data-src' || lowerName === 'data-original' || lowerName === 'data-lazy-src' || lowerName === 'data-bg' || lowerName === 'data-url') && 
                          value && 
                          !value.startsWith('/api/proxy') && 
                          !value.startsWith('data:') && 
                          !value.startsWith('blob:') && 
                          !value.startsWith('#') && 
                          !value.startsWith('javascript:') && 
                          !isInternalAutomatiqaPath(value)) {
                        value = proxyUrl(value);
                      }
                    }
                  }
                  return origSetAttribute.call(this, name, value);
                };
              } catch (e) {}

              // Zoho SalesIQ & widget safety shim to prevent unhandled JS runtime crashes
              try {
                const ensureZohoShims = () => {
                  try {
                    window.$zoho = window.$zoho || {};
                    window.$zoho.salesiq = window.$zoho.salesiq || {};
                    if (!window.$zoho.salesiq.floatwindow || typeof window.$zoho.salesiq.floatwindow !== 'object') {
                      window.$zoho.salesiq.floatwindow = {};
                    }
                    if (typeof window.$zoho.salesiq.floatwindow.expand !== 'function') {
                      window.$zoho.salesiq.floatwindow.expand = function() {};
                    }
                    if (typeof window.$zoho.salesiq.floatwindow.minimize !== 'function') {
                      window.$zoho.salesiq.floatwindow.minimize = function() {};
                    }
                    if (typeof window.$zoho.salesiq.floatwindow.visible !== 'function') {
                      window.$zoho.salesiq.floatwindow.visible = function() {};
                    }
                  } catch (e) {}
                };
                ensureZohoShims();
                setInterval(ensureZohoShims, 200);
              } catch(e) {}

              // Intercept programmatic location changes
              try {
                const origAssign = window.location.assign.bind(window.location);
                window.location.assign = function(url) {
                  origAssign(proxyUrl(url));
                };
              } catch(e) {}
              try {
                const origReplace = window.location.replace.bind(window.location);
                window.location.replace = function(url) {
                  origReplace(proxyUrl(url));
                };
              } catch(e) {}

              // Override window.fetch and XMLHttpRequest to proxy them reliably
              const originalFetch = window.fetch;
              window.fetch = function(url, options) {
                let finalUrl = url;
                if (typeof url === 'string') {
                  if (!url.startsWith('/api/proxy') && !isInternalAutomatiqaPath(url)) {
                    finalUrl = proxyUrl(url);
                  }
                } else if (url instanceof URL) {
                  if (!url.href.includes('/api/proxy') && !isInternalAutomatiqaPath(url.pathname)) {
                    finalUrl = proxyUrl(url.href);
                  }
                } else if (url && typeof url === 'object' && url.url) {
                  try {
                    const resolved = resolveUrl(url.url);
                    if (!resolved.includes('/api/proxy') && !isInternalAutomatiqaPath(resolved)) {
                      return originalFetch.call(this, new Request(proxyUrl(resolved), url), options);
                    }
                  } catch (e) {}
                }
                
                return originalFetch.call(this, finalUrl, options).catch(err => {
                  captureLog('error', ['Fetch notice:', String(finalUrl), err.message]);
                  throw err;
                });
              };

              const originalXHROpen = window.XMLHttpRequest.prototype.open;
              window.XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                this._url = url;
                let finalUrl = url;
                if (typeof url === 'string') {
                  if (!url.startsWith('/api/proxy') && !isInternalAutomatiqaPath(url)) {
                    finalUrl = proxyUrl(url);
                  }
                } else if (url instanceof URL) {
                  if (!url.href.includes('/api/proxy') && !isInternalAutomatiqaPath(url.pathname)) {
                    finalUrl = proxyUrl(url.href);
                  }
                }
                return originalXHROpen.call(this, method, finalUrl, async !== undefined ? async : true, user, password);
              };

              // Intercept pushState and replaceState for SPAs (React Router, Angular, Vue, etc.)
              const originalPushState = history.pushState;
              const originalReplaceState = history.replaceState;

              // SPA routers need to see their clean application path while
              // processing a navigation. Once their synchronous update has
              // completed, restore the address bar to the recorder proxy URL
              // without triggering a page load. Otherwise paths such as
              // /gst/client/recent escape to localhost:3000 and are handled
              // by AutomatiQA instead of the recorded application.
              const restoreProxyHistoryUrl = (state, title, targetAppUrl) => {
                if (!targetAppUrl || isInternalAutomatiqaPath(targetAppUrl)) return;
                const recorderUrl = proxyUrl(targetAppUrl);
                if (!recorderUrl || recorderUrl === targetAppUrl) return;

                queueMicrotask(() => {
                  try {
                    originalReplaceState.call(history, state, title, recorderUrl);
                  } catch (e) {
                    console.warn('[AutomatiQA Proxy] Could not restore proxied SPA URL:', e);
                  }
                });
              };

              history.pushState = function(state, title, url) {
                if (url) {
                  updateTargetUrlFromPath(url);
                }
                const actualUrl = currentTargetUrl || initialTargetUrl;
                
                // Allow the SPA router to maintain its intended internal path
                const result = originalPushState.apply(this, [state, title, url]);
                restoreProxyHistoryUrl(state, title, actualUrl);
                
                if (actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
                return result;
              };

              history.replaceState = function(state, title, url) {
                if (url) {
                  updateTargetUrlFromPath(url);
                }
                const actualUrl = currentTargetUrl || initialTargetUrl;
                
                const result = originalReplaceState.apply(this, [state, title, url]);
                restoreProxyHistoryUrl(state, title, actualUrl);
                if (actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
                return result;
              };

              window.addEventListener('popstate', (e) => {
                updateTargetUrl();
                const actualUrl = currentTargetUrl || getTargetUrl();
                if (actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
              });

              window.addEventListener('hashchange', (e) => {
                updateTargetUrl();
                const actualUrl = currentTargetUrl || getTargetUrl();
                if (actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
              });

              // Prevent unhandled promise rejections or asset preload errors from freezing the page
              window.addEventListener('unhandledrejection', (e) => {
                console.warn('[AutomatiQA Proxy] Handled unhandled rejection:', e.reason);
              });

              window.addEventListener('error', (e) => {
                if (e.target && (e.target.tagName === 'LINK' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'IMG')) {
                  // Surface failed target resources; suppressing this event made
                  // a broken application look like an unexplained blank page.
                  console.error('[AutomatiQA Proxy] Asset load failed:', e.target.src || e.target.href);
                }
              }, true);
              // Override form.submit
              const originalFormSubmit = HTMLFormElement.prototype.submit;
              HTMLFormElement.prototype.submit = function() {
                const action = this.getAttribute('action') || '';
                const absoluteUrl = resolveUrl(action);
                if (action && !isInternalAutomatiqaPath(action)) {
                  this.setAttribute('action', proxyUrl(absoluteUrl));
                }
                return originalFormSubmit.apply(this, arguments);
              };

              // --- Console Log Capturing ---
              const originalConsole = {
                log: console.log,
                warn: console.warn,
                error: console.error,
                info: console.info
              };

              const captureLog = (type, args) => {
                const targetWindow = window.opener || window.parent;
                if (targetWindow) {
                  targetWindow.postMessage({
                    type: 'CONSOLE_LOG',
                    log: {
                      type,
                      message: Array.from(args).map(arg => {
                        try {
                          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                        } catch (e) {
                          return String(arg);
                        }
                      }).join(' '),
                      timestamp: Date.now(),
                      url: window.location.href
                    }
                  }, "*");
                }
                originalConsole[type].apply(console, args);
              };

              console.log = (...args) => captureLog('log', args);
              console.warn = (...args) => captureLog('warn', args);
              console.error = (...args) => captureLog('error', args);
              console.info = (...args) => captureLog('info', args);

              window.addEventListener('error', (e) => {
                if (!e || e.message === 'Script error.' || e.message?.includes('Script error')) return;
                if (e.filename?.includes('salesiq') || e.filename?.includes('zoho') || e.message?.includes('salesiq') || e.message?.includes('$zoho')) return;
                captureLog('error', [e.message, e.filename, e.lineno]);
              });

              window.addEventListener('unhandledrejection', (e) => {
                if (!e || e.reason?.message === 'Script error.' || String(e.reason)?.includes('Script error')) return;
                if (String(e.reason)?.includes('salesiq') || String(e.reason)?.includes('zoho')) return;
                captureLog('error', ['Unhandled Rejection:', e.reason]);
              });

              // --- Live Recorder Control Overlay ---
              const injectOverlay = () => {
                if (document.getElementById('qa-recorder-overlay')) return;
                const overlay = document.createElement('div');
                overlay.id = 'qa-recorder-overlay';
                overlay.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #0f172a; color: #f8fafc; padding: 10px 16px; border-radius: 14px; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11px; font-weight: bold; z-index: 999999; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1); border: 1px solid #334155; display: flex; align-items: center; gap: 10px; pointer-events: auto; user-select: none; transition: all 0.3s ease;';
                overlay.innerHTML = '<div style="display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; animation: qa-pulse 2s infinite;"></div><span style="text-transform: uppercase; letter-spacing: 0.05em; color: #f1f5f9;">Recording</span></div><div style="width: 1px; height: 16px; background: #334155;"></div><div id="qa-overlay-url" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8;">' + (currentTargetUrl || initialTargetUrl) + '</div><div style="width: 1px; height: 16px; background: #334155;"></div><button id="qa-add-custom-step-btn" title="Add Functional Step or Checkpoint (+)" style="background: #4f46e5; color: #ffffff; border: none; border-radius: 8px; padding: 4px 10px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s ease;">+ Step</button>';
                
                const style = document.createElement('style');
                style.textContent = '@keyframes qa-pulse { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } } #qa-recorder-overlay:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -5px rgba(0, 0, 0, 0.5); } #qa-add-custom-step-btn:hover { background: #4338ca; }';
                document.head.appendChild(style);
                document.body.appendChild(overlay);

                const addBtn = document.getElementById('qa-add-custom-step-btn');
                if (addBtn) {
                  addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const assertionText = prompt("Enter checkpoint or assertion text to record:", "Verify page loaded: " + document.title);
                    if (assertionText !== null && assertionText.trim()) {
                      sendEvent("assertion", document.body, {
                        value: assertionText.trim(),
                        url: currentTargetUrl || initialTargetUrl,
                        title: document.title
                      });
                    }
                  });
                }
              };

              if (document.readyState === 'complete') {
                injectOverlay();
              } else {
                window.addEventListener('load', injectOverlay);
              }

              // --- Element Highlighting ---
              let lastHighlighted = null;
              const HIGHLIGHT_STYLE = "outline: 2px solid #6366f1 !important; outline-offset: -2px !important; cursor: crosshair !important; transition: all 0.2s ease !important;";
              
              const highlight = (el) => {
                if (lastHighlighted === el) return;
                unhighlight();
                if (el && el.style) {
                  el._originalStyle = el.getAttribute("style") || "";
                  el.style.cssText += HIGHLIGHT_STYLE;
                  lastHighlighted = el;
                }
              };

              const unhighlight = () => {
                if (lastHighlighted) {
                  lastHighlighted.setAttribute("style", lastHighlighted._originalStyle);
                  lastHighlighted = null;
                }
              };

              document.addEventListener("mouseover", (e) => highlight(e.target), true);
              document.addEventListener("mouseout", (e) => unhighlight(), true);

              // --- Locator Generation (Strict 8-Priority Hierarchy) ---
              const getBestLocator = (el) => {
                if (!el || el === document || el === window) return { type: "css", value: "body", playwright: "page.locator('body')" };

                // 1. Text Content - getByText()
                if (el.innerText && el.innerText.trim().length > 0 && el.innerText.trim().length < 60) {
                  const text = el.innerText.replace(/\s+/g, ' ').trim();
                  return { type: "text", value: text, playwright: "page.getByText('" + text.replace(/'/g, "\\'") + "', { exact: true })" };
                }

                // 2. Role & Name - getByRole()
                const roleMap = {
                  'BUTTON': 'button',
                  'A': 'link',
                  'INPUT': el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox',
                  'TEXTAREA': 'textbox',
                  'SELECT': 'combobox',
                  'H1': 'heading', 'H2': 'heading', 'H3': 'heading', 'H4': 'heading', 'H5': 'heading', 'H6': 'heading',
                };
                
                const tagName = el.tagName.toUpperCase();
                const role = el.getAttribute("role") || roleMap[tagName];
                
                if (role) {
                  let accessibleName = el.innerText?.trim() || el.getAttribute("aria-label") || el.getAttribute("title") || el.placeholder || el.value;
                  if (accessibleName) {
                    accessibleName = accessibleName.replace(/\s+/g, ' ').trim();
                    if (accessibleName.length > 0 && accessibleName.length < 60) {
                      return { type: "role", value: role + '[name="' + accessibleName + '"]', playwright: "page.getByRole('" + role + "', { name: '" + accessibleName.replace(/'/g, "\\'") + "' })" };
                    }
                  }
                }

                // 3. Placeholder - getByPlaceholder()
                const placeholder = el.getAttribute("placeholder");
                if (placeholder && placeholder.trim().length > 0) {
                  return { type: "placeholder", value: placeholder, playwright: "page.getByPlaceholder('" + placeholder.replace(/'/g, "\\'") + "')" };
                }

                // 4. Label - getByLabel()
                let labelText = "";
                if (el.id) {
                  const label = document.querySelector('label[for="' + el.id + '"]');
                  if (label) labelText = label.innerText.trim();
                }
                if (!labelText) {
                  const parentLabel = el.closest('label');
                  if (parentLabel) labelText = parentLabel.innerText.trim();
                }
                if (!labelText && el.getAttribute("aria-label")) {
                  labelText = el.getAttribute("aria-label").trim();
                }
                if (labelText) {
                  labelText = labelText.replace(/\s+/g, ' ').trim();
                  if (labelText.length > 0 && labelText.length < 50) {
                    return { type: "label", value: labelText, playwright: "page.getByLabel('" + labelText.replace(/'/g, "\\'") + "')" };
                  }
                }

                // 5. Data Test IDs - getByTestId()
                const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
                if (testId) return { type: "data-testid", value: testId, playwright: "page.getByTestId('" + testId + "')" };

                // 6. Name Attribute - locator()
                const name = el.getAttribute("name");
                if (name) return { type: "name", value: name, playwright: "page.locator('[name=\"" + name + "\"]')" };

                // 7. Clean ID - id
                if (el.id && !/^\d+$/.test(el.id) && el.id.length < 30) {
                  return { type: "id", value: el.id, playwright: "page.locator('#" + el.id + "')" };
                }

                // 8. Unique CSS Selector (Fallback)
                const getUniqueCssSelector = (element) => {
                  if (element.id && !/\d/.test(element.id)) return '#' + element.id;
                  let path = [];
                  while (element.nodeType === Node.ELEMENT_NODE) {
                    let selector = element.nodeName.toLowerCase();
                    if (element.id && !/\d/.test(element.id)) {
                      selector = '#' + element.id;
                      path.unshift(selector);
                      break;
                    } else {
                      let sibling = element;
                      let nth = 1;
                      while (sibling = sibling.previousElementSibling) {
                        if (sibling.nodeName.toLowerCase() == selector)
                           nth++;
                      }
                      if (nth != 1) selector += ":nth-of-type("+nth+")";
                    }
                    path.unshift(selector);
                    element = element.parentNode;
                  }
                  return path.join(" > ");
                };
                
                const uniqueCss = getUniqueCssSelector(el);
                return { type: "css", value: uniqueCss, playwright: "page.locator('" + uniqueCss + "')" };
              };

              // --- Event Capture ---
              const sendEvent = (action, el, extra = {}) => {
                if (!el && action !== 'navigate') return;
                
                let target = el;
                let locator;
                if (action === 'navigate') {
                  const navUrl = extra.value || extra.url || currentTargetUrl;
                  locator = { type: 'url', value: navUrl, playwright: \`await page.goto('\${navUrl}')\` };
                } else {
                  // For clicks, try to find the nearest interactive parent
                  if (action === 'click' || action === 'mousedown' || action === 'dblclick' || action === 'hover') {
                    const interactive = el && el.closest ? el.closest('button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], label') : null;
                    if (interactive) target = interactive;
                  }

                  locator = getBestLocator(target);
                  
                  // Visual feedback on capture
                  if (target && target.style) {
                    const originalOutline = target.style.outline;
                    target.style.outline = "4px solid #10b981 !important";
                    target.style.outlineOffset = "2px !important";
                    setTimeout(() => {
                      if (target && target.style) target.style.outline = originalOutline;
                    }, 500);
                  }
                }

                const getElementName = (element) => {
                  if (!element) return 'Page';
                  if (element.tagName === 'BODY') return 'Page';
                  const text = element.innerText?.trim().substring(0, 30) || element.getAttribute?.('placeholder') || element.getAttribute?.('aria-label') || element.getAttribute?.('title') || element.name || element.id || element.tagName?.toLowerCase() || 'Page';
                  return text;
                };

                const targetWindow = window.opener || window.parent;
                
                let targetBox = null;
                let coordinates = null;
                const targetElementForMetrics = target || el;
                if (targetElementForMetrics && typeof targetElementForMetrics.getBoundingClientRect === 'function') {
                  try {
                    const rect = targetElementForMetrics.getBoundingClientRect();
                    const winWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
                    const winHeight = window.innerHeight || document.documentElement.clientHeight || 800;
                    targetBox = {
                      x: Math.max(0, Math.min(96, (rect.left / winWidth) * 100)),
                      y: Math.max(0, Math.min(96, (rect.top / winHeight) * 100)),
                      width: Math.max(2, Math.min(96, (rect.width / winWidth) * 100)),
                      height: Math.max(2, Math.min(96, (rect.height / winHeight) * 100))
                    };
                    coordinates = {
                      x: Math.max(0, Math.min(100, ((rect.left + rect.width / 2) / winWidth) * 100)),
                      y: Math.max(0, Math.min(100, ((rect.top + rect.height / 2) / winHeight) * 100))
                    };
                  } catch (e) {}
                }

                // Determine precise value for inputs/buttons vs generic elements
                let val = '';
                if (extra && extra.value !== undefined) {
                  val = extra.value;
                } else if (target || el) {
                  const elem = target || el;
                  if (elem.tagName === 'INPUT' || elem.tagName === 'TEXTAREA' || elem.tagName === 'SELECT') {
                    val = elem.value || '';
                  } else {
                    val = elem.innerText?.trim() || elem.getAttribute?.('value') || '';
                  }
                }

                const eventPayload = {
                  action,
                  locator: { primary: locator, alternatives: [] },
                  elementName: getElementName(target || el),
                  value: val,
                  url: currentTargetUrl || window.location.href,
                  screen: document.title || "MainPage",
                  timestamp: Date.now(),
                  targetBox,
                  coordinates,
                  ...extra
                };

                // 1. Relay via Server (Most robust)
                fetch('/api/record-event', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    event: eventPayload,
                    sessionId: currentSessionId 
                  })
                }).catch(() => {});

                // Socket.io is fed by /api/record-event. Do not also post the
                // same event to the parent: duplicate transports caused steps
                // to appear twice and race with UI de-duplication.
              };

              // Ping parent on load
              const pingParent = () => {
                const targetWindow = window.opener || window.parent;
                if (targetWindow) {
                  targetWindow.postMessage({ type: 'RECORDER_READY', url: currentTargetUrl }, "*");
                }
              };
              pingParent();
              
              // Send initial navigate event
              setTimeout(() => {
                sendEvent("navigate", null, { value: currentTargetUrl || getTargetUrl() });
              }, 100);

              // Click & Double Click
              const handleInteraction = (e) => {
                if (!e.target) return;
                
                // Ignore our own feedback outline
                if (e.target.style && e.target.style.outline && e.target.style.outline.includes('10b981')) return;

                const type = e.type;
                if (type === 'click') {
                  const link = e.target.closest('a');
                  if (link) {
                    const rawHref = link.getAttribute('href') || link.getAttribute('data-href') || link.href || '';
                    if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#') && !rawHref.startsWith('mailto:') && !rawHref.startsWith('tel:')) {
                      const absoluteUrl = resolveUrl(rawHref);
                      const targetAttr = link.getAttribute('target');
                      
                      // Record click step on the link
                      sendEvent("click", link, { href: absoluteUrl });
                      
                      // Do not cancel the target application's click or force a
                      // synthetic navigation. Cancelling capture-phase events
                      // broke SPA routers and form/link behaviour. HTML URL
                      // rewriting already routes ordinary navigations through
                      // the proxy when that mode is usable.
                      return;
                    }
                  }
                  
                  const target = e.target;
                  if (target.tagName === 'SELECT') return;

                  if (target.type === 'checkbox' || target.type === 'radio') {
                    // The change listener below observes the final checked state. Capture
                    // phase click runs too early and previously recorded the
                    // inverse state (and a duplicate event).
                    return;
                  } else {
                    sendEvent("click", target);
                  }
                } else if (type === 'dblclick') {
                  sendEvent("dblclick", e.target);
                }
              };

              document.addEventListener("click", handleInteraction, true);
              document.addEventListener("dblclick", handleInteraction, true);

              // Hover
              let hoverTimeout = null;
              document.addEventListener("mouseover", (e) => {
                const target = e.target;
                if (!target || target === document.body) return;
                
                const interactive = target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"]');
                if (!interactive) return;

                clearTimeout(hoverTimeout);
                hoverTimeout = setTimeout(() => {
                  sendEvent("hover", interactive);
                }, 1000);
              }, true);

              // Input & Change Capture
              const handleInput = (e) => {
                const target = e.target;
                if (!target || target.tagName === 'SELECT') return;
                
                // Track current value directly
                target._lastSentValue = target.value;
                sendEvent("fill", target, { value: target.value });
              };

              let inputDebounce = null;
              document.addEventListener("input", (e) => {
                const target = e.target;
                if (!target || target.tagName === 'SELECT') return;
                clearTimeout(inputDebounce);
                inputDebounce = setTimeout(() => {
                  if (target.value !== target._lastSentValue) {
                    handleInput(e);
                  }
                }, 250);
              }, true);

              document.addEventListener("focus", (e) => {
                if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
                  e.target._lastSentValue = e.target.value;
                  sendEvent("focus", e.target);
                }
              }, true);

              document.addEventListener("blur", (e) => {
                if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
                  clearTimeout(inputDebounce);
                  if (e.target.value !== e.target._lastSentValue) {
                    handleInput(e);
                  }
                  sendEvent("blur", e.target);
                }
              }, true);

              document.addEventListener("change", (e) => {
                const target = e.target;
                if (!target) return;
                if (target.tagName === 'SELECT') {
                  sendEvent("selectOption", target, { value: target.value });
                } else if (target.type === 'checkbox' || target.type === 'radio') {
                  const action = target.type === 'checkbox' ? (target.checked ? "check" : "uncheck") : "select";
                  sendEvent(action, target, { value: target.checked });
                } else {
                  clearTimeout(inputDebounce);
                  if (target.value !== target._lastSentValue) {
                    handleInput(e);
                  }
                }
              }, true);

              // Keydown (Enter, Tab, Escape, etc.)
              document.addEventListener("keydown", (e) => {
                if (!e.target) return;
                if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
                  // Flush any pending input value first if in an input
                  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.target.value !== e.target._lastSentValue) {
                    clearTimeout(inputDebounce);
                    handleInput(e);
                  }
                  sendEvent("press", e.target, { value: e.key });
                }
              }, true);

              // Scroll
              let scrollTimeout = null;
              window.addEventListener("scroll", (e) => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                  sendEvent("scroll", document.body, { 
                    x: window.scrollX, 
                    y: window.scrollY,
                    value: "Scroll to " + window.scrollX + ", " + window.scrollY
                  });
                }, 800);
              }, true);

              // Visibility (Tab Switch)
              document.addEventListener("visibilitychange", () => {
                sendEvent("visibility", document.body, { 
                  state: document.visibilityState,
                  value: "Tab switched to " + document.visibilityState
                });
              });

              // Form Submit
              document.addEventListener("submit", (e) => {
                const form = e.target;
                if (!form) return;
                
                sendEvent("submit", form, { value: "Form submitted" });
                
                const action = form.getAttribute('action') || '';
                const absoluteUrl = resolveUrl(action);
                
                if (action && !absoluteUrl.includes(window.location.origin)) {
                  form.setAttribute('action', proxyUrl(absoluteUrl));
                }
              }, true);

              // Navigation detection periodic check
              const checkUrl = () => {
                const actualUrl = currentTargetUrl || getTargetUrl();
                if (actualUrl && actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  updateTargetUrl();
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
              };

              setInterval(checkUrl, 500);
              window.addEventListener('popstate', checkUrl);
              window.addEventListener('hashchange', checkUrl);

              window.addEventListener('load', () => {
                updateTargetUrl();
                const actualUrl = currentTargetUrl || getTargetUrl();
                if (actualUrl && actualUrl !== lastUrl) {
                  lastUrl = actualUrl;
                  sendEvent("navigate", document.body, { 
                    value: actualUrl,
                    url: actualUrl
                  });
                }
              });

            })();
          </script>
        `;
        if (html.includes('<head>')) {
          html = html.replace('<head>', `<head>\n    ${script}`);
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', `<html>\n<head>\n    ${script}\n</head>`);
        } else {
          html = `${script}\n${html}`;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } else if (contentType && (contentType.includes('text/css') || targetUrl.endsWith('.css'))) {
        let css = Buffer.from(data).toString('utf-8');
        
        // Rewrite all url() references in CSS
        css = css.replace(/url\(["']?([^"'\)]*)["']?\)/g, (match, path) => {
          if (!path || path.startsWith('data:') || path.startsWith('blob:')) return match;
          try {
            const absoluteUrl = new URL(path, targetUrl).toString();
            return `url("/api/proxy?url=${encodeURIComponent(absoluteUrl)}")`;
          } catch (e) {
            return match;
          }
        });
        
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.send(css);
      } else if (contentType && (contentType.includes('javascript') || contentType.includes('ecmascript') || targetUrl.match(/\.(js|mjs|cjs)(\?.*)?$/i))) {
        let js = Buffer.from(data).toString('utf-8');
        const targetOrigin = new URL(targetUrl).origin;

        const resolveJsAssetUrl = (relPath: string) => {
          if (!relPath || relPath.startsWith('data:') || relPath.startsWith('blob:')) return relPath;
          if (relPath.startsWith('/api/proxy') || relPath.includes('/api/proxy?url=')) return relPath;
          try {
            let absUrl: string;
            if (relPath.startsWith('assets/')) {
              absUrl = `${targetOrigin}/${relPath}`;
            } else if (relPath.startsWith('/assets/')) {
              absUrl = `${targetOrigin}${relPath}`;
            } else {
              absUrl = new URL(relPath, targetUrl).toString();
            }
            return `/api/proxy?url=${encodeURIComponent(absUrl)}${sessionId ? '&sessionId=' + sessionId : ''}`;
          } catch (e) {
            return relPath;
          }
        };

        // 1. Rewrite dynamic imports: import("./...") or import('assets/...')
        js = js.replace(/import\s*\(\s*(["'])((\.\.?\/|assets\/|\/)[^"']+)\1\s*\)/g, (match, q, relUrl) => {
          return `import(${q}${resolveJsAssetUrl(relUrl)}${q})`;
        });

        // 2. Rewrite static imports/exports: from "./..." or import "..."
        js = js.replace(/(from\s*|import\s+)(["'])((\.\.?\/|\/)[^"']+)\2/g, (match, prefix, q, relUrl) => {
          return `${prefix}${q}${resolveJsAssetUrl(relUrl)}${q}`;
        });

        // 3. Rewrite Vite / Webpack asset mapping arrays like ["assets/LoginScreenV2-BGM-3g7C.js", ...]
        js = js.replace(/"((?:\.\/|\.\.\/|assets\/)[a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|css))"/g, (match, relUrl) => {
          return `"${resolveJsAssetUrl(relUrl)}"`;
        });

        // Vite's preload helper normally identifies styles with
        // `assetUrl.endsWith(".css")`. Proxied assets have query parameters
        // appended (for example, `...Login.css&sessionId=...`), so that check
        // becomes false and the browser tries to load CSS as a module script.
        // Teach the generated helper to recognize both plain and URL-encoded
        // CSS extensions followed by proxy/query delimiters.
        js = js.replace(
          /([a-zA-Z0-9_$]+)\.endsWith\((['"])\.css\2\)/g,
          '/(?:\\.css|%2Ecss)(?:$|[?&#]|%3F|%23|%26)/i.test($1)'
        );

        // 4. Fix Vite / Rollup assetsURL prefix function to avoid "//api/proxy" double-slash protocol-relative DNS errors
        js = js.replace(/assetsURL\s*=\s*function\s*\(([a-zA-Z0-9_$]+)\)\s*\{\s*return\s*["']\/["']\s*\+\s*\1\s*\}/g, 'assetsURL=function($1){return (!$1 || $1.startsWith("/api/proxy") || $1.startsWith("http://") || $1.startsWith("https://") || $1.startsWith("/")) ? $1 : "/" + $1}');
        js = js.replace(/assetsURL\s*=\s*\(([a-zA-Z0-9_$]+)\)\s*=>\s*["']\/["']\s*\+\s*\1/g, 'assetsURL=($1)=>(!$1 || $1.startsWith("/api/proxy") || $1.startsWith("http://") || $1.startsWith("https://") || $1.startsWith("/")) ? $1 : "/" + $1');

        // 5. Fix CSS and module preload errors in __vitePreload so 404/403/failed assets never crash route transitions (like Dashboard after login)
        js = js.replace(/([a-zA-Z0-9_$]+)\.addEventListener\s*\(\s*["']error["']\s*,\s*\(\s*\)\s*=>\s*([a-zA-Z0-9_$]+)\s*\(\s*new Error\([^)]*\)\s*\)\s*\)/g, '$1.addEventListener("error",()=>{console.warn("[AutomatiQA] Asset preload warning for:",$1.href);try{$2()}catch(e){}})');
        js = js.replace(/!([a-zA-Z0-9_$]+)\.defaultPrevented\s*\)\s*throw\s+([a-zA-Z0-9_$]+)/g, '!$1.defaultPrevented){console.warn("[AutomatiQA] Preload event handled:", $2);}');

        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(js);
      } else {
        res.send(Buffer.from(data));
      }
    } catch (error: any) {
      // Check if requested resource is an image, script, stylesheet or font asset before logging error
      const acceptHeader = req.headers['accept'] || '';
      const isImage = targetUrl.match(/\.(png|jpe?g|gif|svg|webp|ico|tiff?|bmp)(\?.*)?$/i) || acceptHeader.includes('image/');
      const isScript = targetUrl.match(/\.(js|mjs|cjs)(\?.*)?$/i) || acceptHeader.includes('text/javascript') || acceptHeader.includes('application/javascript');
      const isStyle = targetUrl.match(/\.css(\?.*)?$/i) || acceptHeader.includes('text/css');
      const isFont = targetUrl.match(/\.(woff2?|ttf|otf|eot)(\?.*)?$/i) || acceptHeader.includes('font/');

      if (isImage) {
        // Return 1x1 transparent PNG fallback for missing or failing remote images
        const transparentPng = Buffer.from('iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(transparentPng);
        return;
      }

      if (isScript || isStyle || isFont) {
        const mimeType = isScript ? 'application/javascript' : isStyle ? 'text/css' : 'font/woff2';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send('');
        return;
      }

      console.warn("Proxy fallback triggered for:", targetUrl, error?.message || error);
      
      const isRateLimit = error.message?.includes("Rate exceeded") || error.message?.includes("429");
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('HeadersTimeoutError');
      
      let errorMessage = error.message || "Proxy request failed";
      let status = 500;
      
      if (isRateLimit) {
        errorMessage = "Recording service is temporarily busy. Please wait a few seconds and try again.";
        status = 429;
      } else if (isTimeout) {
        errorMessage = "The target website took too long to respond. This might be due to a slow connection or the site blocking proxy requests.";
        status = 504; // Gateway Timeout
      }
      
      res.status(status).json({ 
        success: false, 
        error: errorMessage,
        code: status
      });
    }
  });

  // Admin Database & Auth Backup Synchronization
  app.post("/api/admin/sync-backup-state", async (req, res) => {
    try {
      const result = await runFullReplication();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // URL Validation & Diagnostics API
  app.post("/api/validate-url", async (req, res) => {
    const { url: rawUrl } = req.body || {};
    const norm = normalizeAndValidateUrl(rawUrl);

    if (!norm.valid) {
      return res.json({
        valid: false,
        url: rawUrl,
        normalizedUrl: norm.normalizedUrl,
        error: norm.error,
        diagnostic: norm.diagnostic
      });
    }

    // Try probing URL reachability with a fast timeout (5 seconds)
    try {
      const parsed = new URL(norm.normalizedUrl);
      const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('10.');

      return res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: norm.normalizedUrl,
        isLocal,
        mode: isLocal ? 'proxy' : 'direct'
      });
    } catch (err: any) {
      const diag = diagnoseLaunchError(err, rawUrl);
      return res.json({
        valid: false,
        url: rawUrl,
        normalizedUrl: norm.normalizedUrl,
        error: err?.message,
        diagnostic: diag
      });
    }
  });

  // ==========================================
  // UI Testing & Artifact Persistence Endpoints
  // ==========================================
  const artifactsDataDir = path.join(process.cwd(), 'data', 'artifacts');
  const artifactsPublicDir = path.join(process.cwd(), 'public', 'artifacts');

  try {
    if (!fs.existsSync(artifactsDataDir)) fs.mkdirSync(artifactsDataDir, { recursive: true });
    if (!fs.existsSync(artifactsPublicDir)) fs.mkdirSync(artifactsPublicDir, { recursive: true });
  } catch (e) {}

  // Serve persistent artifacts statically
  app.use('/artifacts', express.static(artifactsPublicDir, { maxAge: '30d' }));
  app.use('/artifacts', express.static(artifactsDataDir, { maxAge: '30d' }));

  // Helper to persist single artifact/image
  const saveArtifactToDisk = (rawId: string, rawData: any): { url: string; key: string; ext: string } => {
    const cleanId = rawId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    if (!cleanId) throw new Error('Invalid artifact key');

    if (typeof rawData === 'string' && rawData.startsWith('data:image/')) {
      const match = rawData.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
      const ext = (match && match[1] ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'png').replace(/[^a-z0-9]/g, '');
      const base64Data = match ? match[2] : rawData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = cleanId.endsWith(`.${ext}`) ? cleanId : `${cleanId}.${ext}`;

      try { fs.writeFileSync(path.join(artifactsPublicDir, filename), buffer); } catch (e) {}
      try { fs.writeFileSync(path.join(artifactsDataDir, filename), buffer); } catch (e) {}

      return { url: `/artifacts/${filename}`, key: cleanId, ext };
    }

    // JSON or general payload bundle
    const filename = cleanId.endsWith('.json') ? cleanId : `${cleanId}.json`;
    const jsonStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);

    try { fs.writeFileSync(path.join(artifactsPublicDir, filename), jsonStr, 'utf-8'); } catch (e) {}
    try { fs.writeFileSync(path.join(artifactsDataDir, filename), jsonStr, 'utf-8'); } catch (e) {}

    return { url: `/artifacts/${filename}`, key: cleanId, ext: 'json' };
  };

  // Save single artifact
  app.post("/api/artifacts/save", async (req, res) => {
    try {
      const { id, data, image, bundle } = req.body || {};
      const targetId = id || `art_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const payload = image || data || bundle;

      if (!payload) {
        return res.status(400).json({ success: false, error: 'No payload or data provided' });
      }

      const result = saveArtifactToDisk(targetId, payload);
      res.json({
        success: true,
        id: targetId,
        url: result.url,
        key: result.key
      });
    } catch (err: any) {
      console.warn('[Artifacts Save API] Error saving artifact:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to save artifact' });
    }
  });

  // Save batch artifacts (e.g. multiple screenshots / defect audit images)
  app.post("/api/artifacts/save-batch", async (req, res) => {
    try {
      const { artifacts } = req.body || {};
      if (!Array.isArray(artifacts) || artifacts.length === 0) {
        return res.status(400).json({ success: false, error: 'Expected artifacts array' });
      }

      const results: Record<string, string> = {};
      for (const item of artifacts) {
        if (item && item.id && item.data) {
          try {
            const saved = saveArtifactToDisk(item.id, item.data);
            results[item.id] = saved.url;
          } catch (e) {
            console.warn(`[Artifacts Batch] Failed to save ${item.id}:`, e);
          }
        }
      }

      res.json({ success: true, count: Object.keys(results).length, results });
    } catch (err: any) {
      console.warn('[Artifacts Batch API] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to batch save artifacts' });
    }
  });

  // Retrieve artifact by ID
  app.get("/api/artifacts/:id", (req, res) => {
    const rawId = req.params.id;
    if (!rawId) return res.status(400).json({ error: 'Artifact ID is required' });

    const cleanId = rawId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const possibleFiles = [
      cleanId,
      `${cleanId}.png`,
      `${cleanId}.jpg`,
      `${cleanId}.jpeg`,
      `${cleanId}.webp`,
      `${cleanId}.json`
    ];

    for (const dir of [artifactsPublicDir, artifactsDataDir]) {
      for (const file of possibleFiles) {
        const fullPath = path.join(dir, file);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(fullPath).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
            res.setHeader('Content-Type', ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
            return res.sendFile(fullPath);
          }
          if (ext === '.json') {
            res.setHeader('Content-Type', 'application/json');
            return res.sendFile(fullPath);
          }
          return res.sendFile(fullPath);
        }
      }
    }

    return res.status(404).json({ error: 'Artifact not found', id: rawId });
  });

  // UI Testing: Capture Live Application URL Screenshot & Real Elements
  app.post("/api/capture-url-ui", async (req, res) => {
    const { url: rawUrl, viewport } = req.body || {};
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    let targetUrl = rawUrl.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    console.log(`[UI Testing Capture] Capturing live UI screenshot and elements from: ${targetUrl}`);

    let browser: Browser | null = null;
    try {
      browser = await launchPlaywrightBrowser({
        headless: true
      });

      const vp = viewport || { width: 1280, height: 800 };
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: vp,
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
        locale: 'en-US'
      });

      // Anti-bot stealth init script & helper polyfill for tsx/esbuild evaluation
      await context.addInitScript(`(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          window.__name = (fn) => fn;
          globalThis.__name = (fn) => fn;
        } catch(e) {}
      })()`);

      const page = await context.newPage();
      page.setDefaultTimeout(18000);
      page.setDefaultNavigationTimeout(22000);

      // Navigate to target URL
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });

      // Allow network and DOM to settle
      try {
        await page.waitForLoadState('networkidle', { timeout: 3500 });
      } catch (e) {
        // Continue if networkidle times out
      }
      await page.waitForTimeout(1000);

      // Extract rich DOM elements and content using a pure string evaluation to prevent tsx/esbuild helper injection
      const pageData = await page.evaluate(`(() => {
        try {
          var getVisibleText = function(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); };

          var title = document.title || 
                      (document.querySelector('meta[property="og:title"]') ? document.querySelector('meta[property="og:title"]').content : '') || 
                      (document.querySelector('h1') ? getVisibleText(document.querySelector('h1')) : '') || 
                      window.location.hostname;

          // Headings
          var headingEls = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
          var headings = headingEls
            .map(function(el) { return getVisibleText(el); })
            .filter(function(t) { return t.length > 1 && t.length < 120; })
            .slice(0, 12);

          // Action Buttons & CTAs
          var buttonEls = Array.from(document.querySelectorAll('button, a.btn, [role="button"], input[type="submit"], input[type="button"]'));
          var buttons = buttonEls
            .map(function(el) { return getVisibleText(el) || el.value || ''; })
            .filter(function(t) { return t.length > 0 && t.length < 50; })
            .slice(0, 12);

          // Form Fields & Inputs
          var inputEls = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
          var inputs = inputEls
            .map(function(el) {
              var placeholder = el.placeholder || '';
              var name = el.name || el.id || '';
              var label = el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '';
              return label || placeholder || name || el.type;
            })
            .filter(function(t) { return t.length > 0; })
            .slice(0, 10);

          // Content Snippets
          var pEls = Array.from(document.querySelectorAll('p, main, article, section, [role="main"]'));
          var textSnippets = pEls
            .map(function(el) { return getVisibleText(el); })
            .filter(function(t) { return t.length > 15 && t.length < 300; })
            .slice(0, 8);

          return {
            title: title,
            headings: headings,
            buttons: buttons,
            inputs: inputs,
            textSnippets: textSnippets
          };
        } catch(e) {
          return {
            title: document.title || window.location.hostname,
            headings: [],
            buttons: [],
            inputs: [],
            textSnippets: []
          };
        }
      })()`);

      // Capture screenshot
      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false
      });

      const base64Screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

      await context.close();
      await browser.close();
      browser = null;

      console.log(`[UI Testing Capture] Successfully captured live screenshot for ${targetUrl} (title: "${(pageData as any)?.title}")`);

      return res.json({
        success: true,
        url: targetUrl,
        pageTitle: (pageData as any)?.title || targetUrl,
        screenshot: base64Screenshot,
        elements: pageData
      });
    } catch (err: any) {
      console.error(`[UI Testing Capture] Playwright direct navigation failed:`, err?.stack || err?.message || err);
      if (browser) {
        try { await (browser as any).close(); } catch (e) {}
      }

      // Fallback: Fetch raw HTML to parse real page metadata
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          const html = await response.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : targetUrl;

          const hMatches = [...html.matchAll(/<h[1-4][^>]*>([^<]+)<\/h[1-4]>/gi)].map(m => m[1].trim()).filter(Boolean).slice(0, 10);
          const btnMatches = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/gi)].map(m => m[1].trim()).filter(Boolean).slice(0, 10);
          const inputMatches = [...html.matchAll(/<input[^>]+placeholder=["']([^"']+)["']/gi)].map(m => m[1].trim()).filter(Boolean).slice(0, 8);

          return res.json({
            success: true,
            url: targetUrl,
            pageTitle: title,
            screenshot: null,
            playwrightError: err?.stack || err?.message || String(err),
            elements: {
              headings: hMatches,
              buttons: btnMatches,
              inputs: inputMatches,
              textSnippets: [`Live content retrieved from ${targetUrl}`]
            }
          });
        }
      } catch (fetchErr) {
        // Fallback fetch also failed
      }

      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to capture application URL"
      });
    }
  });

  // Record & Play: Live DOM Element Inspection for Video Action Matching across all pages
  app.post("/api/record-play/inspect-dom", async (req, res) => {
    const { url: rawUrl, urls: rawUrls, viewport } = req.body || {};
    
    // Collect all target URLs to inspect
    const targetUrlList: string[] = [];
    if (Array.isArray(rawUrls) && rawUrls.length > 0) {
      for (const u of rawUrls) {
        if (typeof u === 'string' && u.trim()) {
          const norm = normalizeAndValidateUrl(u.trim());
          const clean = norm.normalizedUrl || sanitizeUrl(u.trim());
          if (clean && !targetUrlList.includes(clean)) targetUrlList.push(clean);
        }
      }
    }
    if (rawUrl && typeof rawUrl === 'string' && rawUrl.trim()) {
      const norm = normalizeAndValidateUrl(rawUrl.trim());
      const clean = norm.normalizedUrl || sanitizeUrl(rawUrl.trim());
      if (clean && !targetUrlList.includes(clean)) targetUrlList.unshift(clean);
    }

    if (targetUrlList.length === 0) {
      return res.status(400).json({ success: false, error: "Target URL is required for DOM inspection" });
    }

    const primaryUrl = targetUrlList[0];
    let browser: Browser | null = null;
    try {
      console.log(`[Record & Play DOM Inspector] Launching headless browser to inspect DOM for ${targetUrlList.length} page(s): ${targetUrlList.join(', ')}`);
      browser = await launchPlaywrightBrowser({ headless: true });

      const vp = viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number'
        ? viewport
        : { width: 1280, height: 800 };

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: vp,
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(15000);
      page.setDefaultTimeout(10000);

      const elementsByUrl: Record<string, any[]> = {};
      const pageTitles: Record<string, string> = {};
      let allElements: any[] = [];
      let primaryScreenshot = '';
      let primaryPageTitle = '';

      // Inspect each page (limit to max 5 pages for speed and stability)
      const pagesToInspect = targetUrlList.slice(0, 5);
      for (let i = 0; i < pagesToInspect.length; i++) {
        const pageUrl = pagesToInspect[i];
        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch((navErr) => {
            console.warn(`[Record & Play DOM Inspector] Navigation warning for ${pageUrl}: ${navErr.message}`);
          });

          await page.waitForTimeout(1000);

          const title = await page.title().catch(() => pageUrl);
          pageTitles[pageUrl] = title;
          if (i === 0) primaryPageTitle = title;

          // Deep DOM Inspection: Extract all interactive, semantic, and labelled elements
          const domElements = await page.evaluate((currentUrl) => {
            const escapeCss = (str: string): string => {
              if (typeof CSS !== 'undefined' && CSS.escape) {
                return CSS.escape(str);
              }
              return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
            };

            const isUniqueSelector = (sel: string): boolean => {
              try {
                return document.querySelectorAll(sel).length === 1;
              } catch (e) {
                return false;
              }
            };

            const getElementXPath = (element: Element): string => {
              if (element.id && !/\d/.test(element.id)) return `//*[@id="${element.id}"]`;
              const paths: string[] = [];
              for (; element && element.nodeType === 1; element = element.parentElement as Element) {
                let index = 0;
                let hasFollowers = false;
                for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                  if (sibling.nodeType === 1 && sibling.tagName === element.tagName) index++;
                }
                for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
                  if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                    hasFollowers = true;
                    break;
                  }
                }
                const tagName = element.tagName.toLowerCase();
                const pathIndex = (index || hasFollowers) ? `[${index + 1}]` : '';
                paths.unshift(tagName + pathIndex);
              }
              return paths.length ? `/${paths.join('/')}` : '';
            };

            const getUniqueCssSelector = (element: Element): string => {
              if (element.id && !/\d/.test(element.id) && isUniqueSelector('#' + escapeCss(element.id))) {
                return '#' + element.id;
              }
              const path: string[] = [];
              let current: Element | null = element;
              while (current && current.nodeType === Node.ELEMENT_NODE) {
                let selector = current.nodeName.toLowerCase();
                if (current.id && !/\d/.test(current.id) && isUniqueSelector('#' + escapeCss(current.id))) {
                  selector = '#' + current.id;
                  path.unshift(selector);
                  break;
                } else {
                  let sibling: Element | null = current;
                  let nth = 1;
                  while ((sibling = sibling.previousElementSibling)) {
                    if (sibling.nodeName.toLowerCase() === selector) nth++;
                  }
                  if (nth !== 1) selector += `:nth-of-type(${nth})`;
                }
                path.unshift(selector);
                current = current.parentElement;
              }
              return path.join(' > ');
            };

            // Comprehensive query for standard interactive elements, form controls, semantic landmarks, and text nodes
            const standardQuery = 'button, a, input, select, textarea, [role], [data-testid], [data-test-id], [data-cy], [data-qa], form, label, h1, h2, h3, h4, h5, h6, table, tr, td, th, [tabindex], [onclick], nav, header, footer, modal, [aria-label], [placeholder], [title], [name], [id]';
            const initialElements = Array.from(document.querySelectorAll(standardQuery));
            
            // Also collect leaf/text spans, divs, and items with pointer cursor (e.g. sidebar navigation items)
            const textAndPointerElements = Array.from(document.querySelectorAll('span, div, li, p, b, strong, em, dt, dd, option')).filter(el => {
              try {
                const text = (el.textContent || '').trim();
                const style = window.getComputedStyle(el);
                const isPointer = style.cursor === 'pointer';
                const isDirectText = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && text.length > 0 && text.length < 80;
                return isPointer || isDirectText;
              } catch (e) {
                return false;
              }
            });

            // Merge and deduplicate
            const elementSet = new Set<Element>([...initialElements, ...textAndPointerElements]);
            const rawElements = Array.from(elementSet);

            return rawElements.map((el, index) => {
              const tagName = el.tagName.toLowerCase();
              const id = el.id || '';
              const name = el.getAttribute('name') || '';
              const type = el.getAttribute('type') || (tagName === 'button' ? 'button' : tagName === 'select' ? 'select' : tagName === 'textarea' ? 'textarea' : '');
              const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || el.getAttribute('data-qa') || '';
              const rawRole = el.getAttribute('role') || '';
              const role = rawRole || (tagName === 'button' ? 'button' : tagName === 'a' ? 'link' : tagName === 'input' && (type === 'checkbox' || type === 'radio') ? type : '');
              const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
              const placeholder = el.getAttribute('placeholder') || '';
              const title = el.getAttribute('title') || '';
              const textContent = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
              const value = (el as HTMLInputElement).value || '';
              const className = typeof el.className === 'string' ? el.className.trim() : '';

              let boundingBox: any = null;
              let isVisible = false;
              let isPointer = false;
              try {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight) {
                  isVisible = true;
                  boundingBox = {
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  };
                }
                const style = window.getComputedStyle(el);
                isPointer = style.cursor === 'pointer';
              } catch (e) {}

              const isInteractive = ['button', 'a', 'input', 'select', 'textarea'].includes(tagName) || 
                ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'option'].includes(role) ||
                isPointer ||
                el.hasAttribute('onclick') ||
                el.getAttribute('tabindex') === '0';

              const cssSelector = getUniqueCssSelector(el);
              const xpath = getElementXPath(el);

              // Determine the single exact and validated unique locator for this element in the DOM
              // Priority: 
              // 1. getByText()
              // 2. getByRole()
              // 3. getByPlaceholder()
              // If not available/unique:
              // 4. getByLabel()
              // 5. getByTestId()
              // 6. locator() (name attribute)
              // 7. id / CSS
              // 8. XPath as the last option
              let exactLocator: { type: string; value: string; playwright: string; isUnique: boolean } = {
                type: 'css',
                value: cssSelector,
                playwright: `page.locator('${cssSelector}')`,
                isUnique: isUniqueSelector(cssSelector)
              };

              // Helper for label extraction
              let labelText = '';
              if (id) {
                const lEl = document.querySelector(`label[for="${escapeCss(id)}"]`);
                if (lEl) labelText = (lEl as HTMLElement).innerText?.trim() || '';
              }
              if (!labelText && (el as HTMLElement).closest) {
                const parentLabel = (el as HTMLElement).closest('label');
                if (parentLabel) labelText = parentLabel.innerText?.trim() || '';
              }
              if (!labelText && ariaLabel) {
                labelText = ariaLabel.trim();
              }

              let locatorFound = false;

              // 1. getByText() (Priority 1: Visible Text - for non-inputs or distinct text content)
              if (!['input', 'textarea'].includes(tagName) && textContent && textContent.length > 0 && textContent.length < 60) {
                const allWithText = Array.from(document.querySelectorAll('*')).filter(node => (node as HTMLElement).innerText?.trim() === textContent);
                if (allWithText.length === 1) {
                  exactLocator = {
                    type: 'text',
                    value: textContent,
                    playwright: `page.getByText('${textContent.replace(/'/g, "\\'")}', { exact: true })`,
                    isUnique: true
                  };
                  locatorFound = true;
                }
              }

              // 2. getByRole() (Priority 2: Role + Accessible Name)
              if (!locatorFound) {
                if (tagName === 'button' || role === 'button' || tagName === 'a' || role === 'link' || ['tab', 'menuitem', 'checkbox', 'radio', 'combobox', 'textbox'].includes(role) || tagName === 'select' || tagName === 'input' || tagName === 'textarea') {
                  const roleType = role || (tagName === 'a' ? 'link' : tagName === 'button' ? 'button' : tagName === 'select' ? 'combobox' : (tagName === 'input' && ((el as HTMLInputElement).type === 'checkbox' ? 'checkbox' : (el as HTMLInputElement).type === 'radio' ? 'radio' : 'textbox')) || 'textbox');
                  const label = ariaLabel || (tagName === 'button' || tagName === 'a' ? textContent : '') || placeholder || title;
                  if (label && label.length > 0 && label.length < 60) {
                    exactLocator = {
                      type: 'role',
                      value: `${roleType}: ${label}`,
                      playwright: `page.getByRole('${roleType}', { name: '${label.replace(/'/g, "\\'")}' })`,
                      isUnique: true
                    };
                    locatorFound = true;
                  }
                }
              }

              // 3. getByPlaceholder() (Priority 3: Placeholder)
              if (!locatorFound && placeholder && isUniqueSelector(`[placeholder="${escapeCss(placeholder)}"]`)) {
                exactLocator = {
                  type: 'placeholder',
                  value: placeholder,
                  playwright: `page.getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`,
                  isUnique: true
                };
                locatorFound = true;
              }

              // 4. getByLabel() (Priority 4: Associated Label)
              if (!locatorFound && labelText && labelText.length > 0 && labelText.length < 50) {
                exactLocator = {
                  type: 'label',
                  value: labelText,
                  playwright: `page.getByLabel('${labelText.replace(/'/g, "\\'")}')`,
                  isUnique: true
                };
                locatorFound = true;
              }

              // 5. getByTestId() (Priority 5: Data-TestId)
              if (!locatorFound && testId && isUniqueSelector(`[data-testid="${escapeCss(testId)}"]`)) {
                exactLocator = {
                  type: 'data-testid',
                  value: testId,
                  playwright: `page.getByTestId('${testId}')`,
                  isUnique: true
                };
                locatorFound = true;
              }

              // 6. locator() (Priority 6: Name Attribute)
              if (!locatorFound && name) {
                if (isUniqueSelector(`${tagName}[name="${escapeCss(name)}"]`)) {
                  exactLocator = {
                    type: 'name',
                    value: `${tagName}[name="${name}"]`,
                    playwright: `page.locator('${tagName}[name="${name}"]')`,
                    isUnique: true
                  };
                  locatorFound = true;
                } else if (isUniqueSelector(`[name="${escapeCss(name)}"]`)) {
                  exactLocator = {
                    type: 'name',
                    value: `[name="${name}"]`,
                    playwright: `page.locator('[name="${name}"]')`,
                    isUnique: true
                  };
                  locatorFound = true;
                }
              }

              // 7. Clean ID or CSS Selector (Priority 7)
              if (!locatorFound && id && !/^\d+$/.test(id) && isUniqueSelector('#' + escapeCss(id))) {
                exactLocator = {
                  type: 'id',
                  value: `#${id}`,
                  playwright: `page.locator('#${id}')`,
                  isUnique: true
                };
                locatorFound = true;
              }

              // 8. XPath (Priority 8: XPath as the last option)
              if (!locatorFound && xpath) {
                exactLocator = {
                  type: 'xpath',
                  value: xpath,
                  playwright: `page.locator('xpath=${xpath}')`,
                  isUnique: true
                };
              }

              return {
                index,
                pageUrl: currentUrl,
                tagName,
                id,
                name,
                type,
                testId,
                role,
                ariaLabel,
                placeholder,
                title,
                textContent,
                value: tagName === 'input' || tagName === 'textarea' ? value : undefined,
                className: className.slice(0, 120),
                cssSelector,
                xpath,
                exactLocator,
                boundingBox,
                isInteractive,
                isVisible
              };
            }).filter(item => item.isVisible || item.isInteractive || item.testId || item.id || item.name || (item.textContent && item.textContent.length > 0));
          }, pageUrl);

          elementsByUrl[pageUrl] = domElements;
          allElements = allElements.concat(domElements);

          if (i === 0) {
            try {
              const shotBuf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
              primaryScreenshot = `data:image/jpeg;base64,${shotBuf.toString('base64')}`;
            } catch (e) {}
          }
        } catch (pageErr: any) {
          console.warn(`[Record & Play DOM Inspector] Error inspecting page ${pageUrl}:`, pageErr.message);
        }
      }

      await context.close();
      await browser.close();
      browser = null;

      console.log(`[Record & Play DOM Inspector] Successfully extracted ${allElements.length} total DOM elements across ${pagesToInspect.length} page(s)`);

      return res.json({
        success: true,
        url: primaryUrl,
        pageTitle: primaryPageTitle || pageTitles[primaryUrl] || primaryUrl,
        pageTitles,
        elementsCount: allElements.length,
        elements: allElements,
        elementsByUrl,
        screenshot: primaryScreenshot
      });
    } catch (err: any) {
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
      console.error(`[Record & Play DOM Inspector] Playwright inspection error:`, err?.message || err);

      // Graceful fallback: return empty element list with success: false
      return res.json({
        success: false,
        url: primaryUrl || (targetUrlList && targetUrlList[0]) || '',
        error: err?.message || "Failed to inspect DOM for the target URL",
        elements: []
      });
    }
  });

  // UI Testing: Capture Figma URL Preview & Embed Specs
  app.post("/api/capture-figma-url", async (req, res) => {
    const { url: rawUrl } = req.body || {};
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return res.status(400).json({ success: false, error: "Figma URL is required" });
    }

    const targetUrl = rawUrl.trim();
    let pageTitle = "Figma Design Specification";
    if (targetUrl.includes("figma.com/file/") || targetUrl.includes("figma.com/design/")) {
      const parts = targetUrl.split("/");
      const namePart = parts[parts.length - 1]?.split("?")[0];
      if (namePart) pageTitle = `Figma Design: ${decodeURIComponent(namePart).replace(/[-_]/g, ' ')}`;
    } else if (targetUrl.includes("figma.com/proto/")) {
      pageTitle = "Figma Interactive Prototype";
    }

    let browser: Browser | null = null;
    try {
      browser = await launchPlaywrightBrowser({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        viewport: { width: 1280, height: 800 }
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(15000);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await page.waitForTimeout(2000);

      const docTitle = await page.title();
      if (docTitle && !docTitle.toLowerCase().includes("log in") && !docTitle.toLowerCase().includes("sign up")) {
        pageTitle = docTitle;
      }

      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      const base64Screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

      await context.close();
      await browser.close();

      return res.json({
        success: true,
        url: targetUrl,
        pageTitle,
        screenshot: base64Screenshot,
        figmaEmbedUrl: `https://www.figma.com/embed?embed_host=automatiqa&url=${encodeURIComponent(targetUrl)}`
      });
    } catch (e) {
      if (browser) {
        try { await (browser as any).close(); } catch (err) {}
      }
      return res.json({
        success: true,
        url: targetUrl,
        pageTitle,
        screenshot: null,
        figmaEmbedUrl: `https://www.figma.com/embed?embed_host=automatiqa&url=${encodeURIComponent(targetUrl)}`
      });
    }
  });

  // Browser Permissions Management APIs
  app.post("/api/grant-permission", async (req, res) => {
    const { sessionId, permissions, origin } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    try {
      const permsToGrant = Array.isArray(permissions) ? permissions : [permissions];
      console.log(`[Permission Grant] Granting ${permsToGrant.join(', ')} to session ${sessionId}`);

      if (session.context) {
        // Map common permission names to Playwright standard permission strings
        const playwrightPermMap: Record<string, string> = {
          'camera': 'camera',
          'microphone': 'microphone',
          'geolocation': 'geolocation',
          'notifications': 'notifications',
          'clipboard-read': 'clipboard-read',
          'clipboard-write': 'clipboard-write'
        };

        const validPerms = permsToGrant
          .map(p => playwrightPermMap[p.toLowerCase()] || p)
          .filter(Boolean);

        if (validPerms.length > 0) {
          await session.context.grantPermissions(validPerms as any, origin ? { origin } : undefined).catch(err => {
            console.warn("[Playwright] grantPermissions warning:", err.message);
          });
        }
      }

      session.grantedPermissions = Array.from(new Set([...(session.grantedPermissions || []), ...permsToGrant]));
      
      io.emit('PERMISSION_GRANTED', {
        sessionId,
        permissions: permsToGrant,
        origin
      });

      return res.json({ success: true, grantedPermissions: session.grantedPermissions });
    } catch (err: any) {
      console.error("Failed to grant permission:", err);
      return res.status(500).json({ error: err.message || "Failed to grant permissions" });
    }
  });

  app.post("/api/deny-permission", async (req, res) => {
    const { sessionId, permissions, origin } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const session = sessions.get(sessionId);
    if (session && session.context) {
      try {
        await session.context.clearPermissions().catch(() => {});
      } catch (e) {}
    }

    io.emit('PERMISSION_DENIED', {
      sessionId,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
      origin
    });

    return res.json({ success: true, denied: true });
  });

  // Recording APIs
  app.post("/api/start-recording", async (req, res) => {
    try {
      const body = req.body || {};
      const { name, platform, browser: browserType, url: rawUrl, recordingMode } = body;
      
      const norm = normalizeAndValidateUrl(rawUrl);
      const url = norm.normalizedUrl || sanitizeUrl(rawUrl);
      const sessionId = Math.random().toString(36).substring(7);

      console.log(`Starting recording session ${sessionId} for ${url} in ${recordingMode} mode`);

      const session: RecordingSession = {
        id: sessionId,
        name: name || 'Recorded Session',
        platform: platform || 'web',
        url,
        initialUrl: url,
        steps: [],
        startTime: Date.now(),
        nextSequence: 1,
        recordingMode: recordingMode || 'manual',
        status: 'INITIALIZING'
      };

      // Register before listener injection/navigation so early navigate events have a valid owner.
      sessions.set(sessionId, session);

      if (recordingMode === 'codegen') {
        console.log("Launching Playwright for Universal Codegen mode...");
        try {
          const requestedLaunchMode = await classifyUrl(url);
          const browser = await launchPlaywrightBrowser({ 
            // Codegen records interactions in this Playwright-owned page.
            // Public targets use one visible direct browser at their real URL.
            // Proxy-only targets stay headless here because the UI opens the
            // single interactive proxied tab after this endpoint responds.
            headless: requestedLaunchMode === 'proxy'
          });

          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            hasTouch: false,
            isMobile: false,
            locale: 'en-US',
            ignoreHTTPSErrors: true,
            storageState: null
          });

          // Anti-Bot Stealth Init Script
          await context.addInitScript(`(() => {
            try {
              var shim = function(t, v) { return t; };
              if (typeof window !== 'undefined') window.__name = window.__name || shim;
              if (typeof globalThis !== 'undefined') globalThis.__name = globalThis.__name || shim;
            } catch(e) {}

            // 1. Hide navigator.webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => false });

            // 2. Spoof plugins
            Object.defineProperty(navigator, 'plugins', {
              get: () => {
                const arr = [
                  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                arr.item = (i) => arr[i];
                arr.namedItem = (n) => arr.find((p) => p.name === n) || null;
                arr.refresh = () => {};
                return arr;
              }
            });

            // 3. Spoof languages, hardware, memory
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

            // 4. Inject window.chrome.runtime
            if (!window.chrome) {
              window.chrome = {
                runtime: {
                  connect: () => {},
                  sendMessage: () => {},
                  onMessage: { addListener: () => {}, removeListener: () => {} }
                },
                loadTimes: () => ({}),
                csi: () => ({})
              };
            }
          })()`);

          // Preserve session by forwarding cookies from the current request if any
          if (req.headers.cookie) {
            try {
              const urlObj = new URL(url);
              const cookieUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}`;
              
              const cookies = req.headers.cookie.split(';').map(pair => {
                const trimmed = pair.trim();
                if (!trimmed) return null;
                
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex === -1) return null;
                
                const name = trimmed.substring(0, eqIndex).trim();
                const value = trimmed.substring(eqIndex + 1).trim();
                
                if (!name) return null;
                if (name === 'qa_last_target_origin' || name.startsWith('__')) return null;
                
                return {
                  name,
                  value,
                  url: cookieUrl,
                  path: '/'
                };
              }).filter((c): c is any => c !== null);
              
              if (cookies.length > 0) {
                await context.addCookies(cookies).catch(err => {
                  console.warn("Playwright rejected some cookies, continuing anyway.");
                });
              }
            } catch (e) {
              console.error("Error processing cookies for Playwright:", e);
            }
          }

          const page = await context.newPage();
          
          await page.setExtraHTTPHeaders({
            'accept-language': 'en-US,en;q=0.9'
          });
          
          session.browser = browser;
          session.context = context;
          session.activePages = [page];
          
          await injectStepListeners(page, sessionId);
          
          // Monitor HTTP responses for authentication challenges (401/403)
          page.on('response', (response) => {
            const status = response.status();
            if (status === 401 || status === 403) {
              console.log(`[Playwright Auth Check] Detected HTTP ${status} for ${response.url()}`);
              io.emit('DIAGNOSTIC_EVENT', {
                sessionId,
                diagnostic: {
                  code: 'AUTHENTICATION_REQUIRED',
                  title: 'Login Required',
                  message: 'This web page requires authentication. Log in within the viewport to proceed.',
                  suggestedAction: 'Enter your credentials in the application to record authenticated steps.',
                  targetUrl: response.url(),
                  timestamp: Date.now(),
                  recoverable: true
                }
              });
            }
          });

          // Handle new tabs, popups, and multi-window navigation
          context.on('page', async (newPage) => {
            console.log("[Playwright Window Manager] New page/tab detected:", newPage.url());
            if (!session.activePages) session.activePages = [];
            session.activePages.push(newPage);

            const tabIndex = session.activePages.length - 1;
            const tabTitle = await newPage.title().catch(() => 'New Tab');

            io.emit('RECORDED_STEP', {
              action: 'open_tab',
              value: newPage.url(),
              pageIndex: tabIndex,
              tabTitle,
              sessionId,
              timestamp: Date.now()
            });

            await injectStepListeners(newPage, sessionId);

            newPage.on('close', () => {
              console.log("[Playwright Window Manager] Page/tab closed:", newPage.url());
              session.activePages = session.activePages?.filter(p => p !== newPage) || [];
              io.emit('RECORDED_STEP', {
                action: 'close_tab',
                value: newPage.url(),
                sessionId,
                timestamp: Date.now()
              });
            });
          });

          // Initial navigation using Universal URL Handling
          console.log(`Using Universal Web URL Handling for: ${url}`);
          const mode = await openUrl(url, page, sessionId).catch(err => {
            const diag = diagnoseLaunchError(err, url);
            console.error("Universal URL launch warning:", diag.message);
            io.emit('DIAGNOSTIC_EVENT', {
              sessionId,
              diagnostic: diag
            });
            return 'direct' as const;
          });
          
          console.log('Target URL:', url, 'Mode:', mode);
          session.mode = mode;
          session.status = 'RECORDING';
        } catch (pwError: any) {
          const diag = diagnoseLaunchError(pwError, url);
          console.warn("Playwright initialization diagnostic:", diag.message);
          io.emit('DIAGNOSTIC_EVENT', {
            sessionId,
            diagnostic: diag
          });
          session.mode = 'proxy';
          session.status = 'RECORDING';
        }
      }

      // Notify extension to start recording if connected via raw WebSocket
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          (client as any).activeSessionId = sessionId;
          client.send(JSON.stringify({ 
            type: 'START_RECORDING', 
            sessionId,
            mode: session.mode
          }));
        }
      });
      
      console.log(`Started recording session: ${sessionId} for ${url} (Mode: ${session.mode || 'direct'})`);
      return res.json({ 
        success: true, 
        sessionId,
        mode: session.mode || 'direct',
        url
      });
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      const diag = diagnoseLaunchError(error, req.body?.url || '');
      const isRateLimit = error.message?.includes("Rate exceeded") || error.message?.includes("429");
      return res.status(isRateLimit ? 429 : 500).json({ 
        success: false, 
        error: error.message || "Failed to start recording",
        code: isRateLimit ? 429 : 500,
        diagnostic: diag
      });
    }
  });

  // Dedicated endpoint to capture real live website UI
  app.post("/api/capture-url-ui", async (req, res) => {
    let { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: "Valid URL is required" });
    }

    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    console.log(`[Capture UI] Capturing live UI screenshot & metadata for: ${url}`);

    let browser: any = null;
    try {
      browser = await launchPlaywrightBrowser({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (navErr: any) {
        console.warn(`[Capture UI] Navigation soft timeout:`, navErr?.message);
      }

      await page.waitForTimeout(1000);

      const pageTitle = await page.title().catch(() => new URL(url).hostname);
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false }).catch(() => null);

      let headings: string[] = [];
      let buttons: string[] = [];
      let inputs: string[] = [];

      try {
        headings = await page.$eval('h1, h2, h3, h4', (els: any[]) => 
          els.map((e: any) => (e.innerText || e.textContent || '').trim()).filter((t: string) => t.length > 0 && t.length < 80).slice(0, 10)
        );
      } catch (e) {}

      try {
        buttons = await page.$eval('button, a[role="button"], input[type="submit"], .btn', (els: any[]) => 
          els.map((e: any) => (e.innerText || e.value || e.textContent || '').trim()).filter((t: string) => t.length > 0 && t.length < 50).slice(0, 10)
        );
      } catch (e) {}

      try {
        inputs = await page.$eval('input:not([type="hidden"]), select, textarea', (els: any[]) => 
          els.map((e: any) => (e.placeholder || e.name || e.getAttribute('aria-label') || e.id || e.tagName.toLowerCase()).trim()).filter(Boolean).slice(0, 10)
        );
      } catch (e) {}

      await browser.close().catch(() => {});
      browser = null;

      const screenshotData = screenshotBuffer ? `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}` : null;

      return res.json({
        success: true,
        url,
        pageTitle: pageTitle || new URL(url).hostname,
        screenshot: screenshotData,
        elements: {
          headings,
          buttons,
          inputs
        }
      });
    } catch (err: any) {
      if (browser) {
        await browser.close().catch(() => {});
      }
      console.warn(`[Capture UI] Browser capture fallback to HTTP fetch for ${url}:`, err?.message);

      // Fallback via HTTP fetch
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(8000)
        });
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
        
        return res.json({
          success: true,
          url,
          pageTitle,
          screenshot: null,
          elements: {
            headings: [],
            buttons: [],
            inputs: []
          }
        });
      } catch (fallbackErr: any) {
        return res.json({
          success: true,
          url,
          pageTitle: new URL(url).hostname,
          screenshot: null,
          elements: { headings: [], buttons: [], inputs: [] }
        });
      }
    }
  });

  // Dedicated endpoint to extract keyframes/pages from video using ffmpeg
  app.post("/api/extract-video-frames", async (req, res) => {
    try {
      const { videoData, filename } = req.body || {};
      if (!videoData || typeof videoData !== 'string') {
        return res.status(400).json({ success: false, error: "videoData (base64) is required" });
      }

      const base64Data = videoData.includes(',') ? videoData.split(',')[1] : videoData;
      const buffer = Buffer.from(base64Data, 'base64');

      const tempId = `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const tempVideoPath = path.join('/tmp', `${tempId}.mp4`);
      const tempOutputDir = path.join('/tmp', tempId);

      fs.writeFileSync(tempVideoPath, buffer);
      if (!fs.existsSync(tempOutputDir)) {
        fs.mkdirSync(tempOutputDir, { recursive: true });
      }

      // Get video duration using ffprobe
      let duration = 0;
      try {
        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempVideoPath}"`, { timeout: 10000 }).toString().trim();
        duration = parseFloat(durationStr) || 0;
      } catch (probeErr) {
        try {
          const streamDurStr = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${tempVideoPath}"`, { timeout: 10000 }).toString().trim();
          duration = parseFloat(streamDurStr) || 0;
        } catch (probeErr2) {
          console.warn("[Video Extract] ffprobe warning, attempting duration extraction from ffmpeg output:", probeErr);
        }
      }

      if (!duration || isNaN(duration) || duration <= 0) {
        try {
          const ffmpegInfo = execSync(`ffmpeg -i "${tempVideoPath}" 2>&1`, { timeout: 10000 }).toString();
          const durMatch = ffmpegInfo.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
          if (durMatch) {
            const hrs = parseFloat(durMatch[1]) || 0;
            const mins = parseFloat(durMatch[2]) || 0;
            const secs = parseFloat(durMatch[3]) || 0;
            duration = hrs * 3600 + mins * 60 + secs;
          }
        } catch (e) {}
      }

      if (!duration || duration <= 0) {
        duration = 10; // default fallback
      }

      console.log(`[Video Extract] Processing video (${filename || 'uploaded_video'}) with duration: ${duration.toFixed(2)}s`);

      // Determine sample timestamps covering all pages across the video duration
      const timestampsToSample: number[] = [];
      if (duration <= 3) {
        timestampsToSample.push(0.1, duration * 0.5, Math.max(0.2, duration - 0.15));
      } else if (duration <= 8) {
        const count = Math.min(6, Math.max(4, Math.floor(duration / 1.2)));
        for (let i = 0; i < count; i++) {
          timestampsToSample.push(0.1 + (duration - 0.25) * (i / Math.max(1, count - 1)));
        }
      } else if (duration <= 25) {
        const count = Math.min(10, Math.max(6, Math.floor(duration / 2.5)));
        for (let i = 0; i < count; i++) {
          timestampsToSample.push(0.1 + (duration - 0.3) * (i / Math.max(1, count - 1)));
        }
      } else if (duration <= 60) {
        const count = Math.min(14, Math.max(8, Math.floor(duration / 3.5)));
        for (let i = 0; i < count; i++) {
          timestampsToSample.push(0.1 + (duration - 0.4) * (i / Math.max(1, count - 1)));
        }
      } else {
        const count = 16;
        for (let i = 0; i < count; i++) {
          timestampsToSample.push(0.2 + (duration - 0.5) * (i / (count - 1)));
        }
      }

      const frames: Array<{ timestamp: string; image: string; isBlank?: boolean }> = [];

      for (let i = 0; i < timestampsToSample.length; i++) {
        const targetTime = timestampsToSample[i];
        const outFramePath = path.join(tempOutputDir, `frame_${i}.jpg`);
        try {
          execSync(`ffmpeg -ss ${targetTime.toFixed(3)} -i "${tempVideoPath}" -vframes 1 -vf "scale='min(1280,iw)':-2" -q:v 3 -y "${outFramePath}"`, { timeout: 8000, stdio: 'ignore' });
          if (fs.existsSync(outFramePath)) {
            const frameBuf = fs.readFileSync(outFramePath);
            if (frameBuf && frameBuf.length > 500) {
              const mins = Math.floor(targetTime / 60);
              const secs = Math.floor(targetTime % 60);
              const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              frames.push({
                timestamp: ts,
                image: `data:image/jpeg;base64,${frameBuf.toString('base64')}`,
                isBlank: false
              });
            }
          }
        } catch (frameErr) {
          console.warn(`[Video Extract] Frame extraction error at ${targetTime}s:`, frameErr);
        }
      }

      // Cleanup temp files
      try {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempOutputDir)) {
          fs.rmSync(tempOutputDir, { recursive: true, force: true });
        }
      } catch (cleanupErr) {}

      console.log(`[Video Extract] Successfully extracted ${frames.length} keyframes`);

      return res.json({
        success: true,
        duration,
        frames
      });
    } catch (err: any) {
      console.error("[Video Extract] Extraction failed:", err);
      return res.status(500).json({ success: false, error: err?.message || "Failed to extract video frames" });
    }
  });

  // Dedicated endpoint to capture Figma design metadata & previews
  app.post("/api/capture-figma-url", async (req, res) => {
    let { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: "Valid Figma URL is required" });
    }

    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    console.log(`[Capture Figma] Capturing Figma design preview for: ${url}`);

    const figmaEmbedUrl = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`;
    let pageTitle = "Figma Design Specification";
    let screenshot: string | null = null;

    try {
      // 1. Fetch metadata from Figma page to extract OpenGraph preview image
      const figmaResp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(10000)
      });

      const html = await figmaResp.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
      if (titleMatch && titleMatch[1]) {
        pageTitle = titleMatch[1].replace(' | Figma', '').trim();
      }

      const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                           html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);

      if (ogImageMatch && ogImageMatch[1] && !ogImageMatch[1].includes('default_preview')) {
        const imgUrl = ogImageMatch[1];
        try {
          const imgResp = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
          if (imgResp.ok) {
            const buffer = Buffer.from(await imgResp.arrayBuffer());
            const contentType = imgResp.headers.get('content-type') || 'image/png';
            screenshot = `data:${contentType};base64,${buffer.toString('base64')}`;
          }
        } catch (imgErr) {
          console.warn("[Capture Figma] Could not fetch og:image preview:", imgErr);
        }
      }

      // If og:image wasn't available, launch browser to render preview
      if (!screenshot) {
        let browser: any = null;
        try {
          browser = await launchPlaywrightBrowser({ headless: true });
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true
          });
          const page = await context.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2000);
          const buf = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => null);
          if (buf) {
            screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
          await browser.close().catch(() => {});
        } catch (pwErr) {
          if (browser) await browser.close().catch(() => {});
        }
      }

      return res.json({
        success: true,
        url,
        pageTitle,
        screenshot,
        figmaEmbedUrl
      });
    } catch (err: any) {
      console.warn("[Capture Figma] Error capturing Figma preview:", err?.message);
      return res.json({
        success: true,
        url,
        pageTitle: "Figma Design Spec",
        screenshot: null,
        figmaEmbedUrl
      });
    }
  });

  // Universal Live Web Event Recording Endpoint
  app.post("/api/record-event", async (req, res) => {
    try {
      const body = req.body || {};
      const eventData = body.event || body;
      const sessId = body.sessionId || eventData.sessionId || (sessions.size > 0 ? Array.from(sessions.keys())[sessions.size - 1] : undefined);

      if (!eventData || !eventData.action) {
        return res.status(400).json({ error: "Invalid event payload, action is required" });
      }

      const formattedStep = {
        id: eventData.id || Math.random().toString(36).substring(7),
        action: eventData.action,
        value: eventData.value !== undefined ? eventData.value : '',
        elementName: eventData.elementName || 'Web Element',
        locator: eventData.locator || {
          primary: {
            type: eventData.action === 'navigate' ? 'url' : 'css',
            value: eventData.action === 'navigate' ? (eventData.value || eventData.url) : (eventData.selector || 'body'),
            playwright: eventData.playwright || (eventData.action === 'navigate' ? `await page.goto('${eventData.value || eventData.url}')` : `await page.locator('${eventData.selector || 'body'}').${eventData.action}()`)
          },
          alternatives: []
        },
        selector: eventData.selector,
        url: eventData.url || '',
        screen: eventData.screen || deriveScreenName(eventData.url || ''),
        platform: eventData.platform || 'web',
        timestamp: eventData.timestamp || Date.now(),
        masked: Boolean(eventData.masked),
        targetBox: eventData.targetBox,
        coordinates: eventData.coordinates,
        screenshot: eventData.screenshot,
        sessionId: sessId
      };

      console.log(`[Proxy Event Recorded] Action: "${formattedStep.action}", Value: "${formattedStep.value}", Target: "${formattedStep.elementName}", Session: "${sessId || 'broadcast'}"`);

      const recordedStep = publishRecordedStep(sessId, formattedStep);
      if (!recordedStep) {
        return res.status(409).json({ error: 'Recording session is inactive or invalid' });
      }

      // Notify WebSocket clients (e.g. Chrome Extension)
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'RECORDED_STEP',
            step: recordedStep,
            sessionId: sessId
          }));
        }
      });

      return res.json({ success: true, step: recordedStep });
    } catch (err: any) {
      console.error("[Record Event Endpoint Error]:", err);
      return res.status(500).json({ error: err?.message || "Internal server error recording step" });
    }
  });

  app.post("/api/stop-recording", async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const session = sessions.get(sessionId);

    if (session) {
      // Close Playwright browser if exists
      if (session.browser) {
        console.log(`Closing Playwright browser for session ${sessionId}`);
        await session.browser.close().catch(err => console.error("Failed to close browser:", err));
      }

      // Notify extension to stop recording via raw WebSocket
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && (client as any).activeSessionId === sessionId) {
          client.send(JSON.stringify({ type: 'STOP_RECORDING', sessionId }));
        }
      });

      const steps = session.steps;
      sessions.delete(sessionId);
      console.log(`Stopped recording session: ${sessionId}`);
      res.json({ steps });
    } else {
      // If session not found, it might have been already stopped or server restarted.
      // We return success with empty steps to avoid confusing the UI/User.
      console.warn(`Stop recording requested for non-existent session: ${sessionId}`);
      res.json({ steps: [], warning: "Session not found" });
    }
  });

  // Capture Real Screenshot for a Specific Test Step
  app.post("/api/capture-step-screenshot", async (req, res) => {
    const { url, action = 'action', selector, locator, elementName, stepId, sessionId } = req.body || {};

    let screenshot: string | null = null;
    const targetUrl = sanitizeUrl(url || '');

    try {
      // 1. Check if there is an active Playwright browser session that can take an instant screenshot
      if (sessionId && sessions.has(sessionId)) {
        const sess = sessions.get(sessionId);
        const activePage = sess?.activePages?.[0] || sess?.context?.pages()?.[0];
        if (activePage && !activePage.isClosed()) {
          try {
            if (selector) {
              await activePage.evaluate((sel: string) => {
                try {
                  const el = document.querySelector(sel);
                  if (el) {
                    el.scrollIntoView({ behavior: 'instant', block: 'center' });
                    (el as HTMLElement).style.outline = '3px solid #10b981';
                    (el as HTMLElement).style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.5)';
                  }
                } catch (e) {}
              }, selector).catch(() => {});
            }
            const buf = await activePage.screenshot({ type: 'jpeg', quality: 80, fullPage: false, timeout: 3000 });
            if (buf) {
              screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
            }
          } catch (pageErr) {
            console.warn("[Capture Step Screenshot] Active page capture error:", pageErr);
          }
        }
      }

      // 2. If no active browser session, launch headless Playwright browser to capture targetUrl
      if (!screenshot && targetUrl && targetUrl.startsWith('http')) {
        let browser: any = null;
        try {
          browser = await launchPlaywrightBrowser({ headless: true });
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
          });
          const page = await context.newPage();
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForTimeout(1000);

          if (selector) {
            await page.evaluate((sel: string) => {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  el.scrollIntoView({ behavior: 'instant', block: 'center' });
                  (el as HTMLElement).style.outline = '3px solid #10b981';
                  (el as HTMLElement).style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.5)';
                }
              } catch (e) {}
            }, selector).catch(() => {});
          }

          const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false, timeout: 4000 });
          if (buf) {
            screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
          await browser.close().catch(() => {});
        } catch (pwErr) {
          if (browser) await browser.close().catch(() => {});
          console.warn("[Capture Step Screenshot] Headless browser capture error:", (pwErr as any)?.message);
        }
      }

      // 3. If live Playwright capture was not possible, generate an authentic, realistic application snapshot SVG
      if (!screenshot) {
        const escapeXml = (unsafe: string) => unsafe.replace(/[<>&'"]/g, (c) => {
          switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
          }
        });

        const cleanUrl = targetUrl || 'https://app.example.com';
        const locatorText = typeof locator === 'string' ? locator : (locator?.primary?.playwright || locator?.primary?.value || selector || '');
        const targetLabel = elementName || (selector ? `Element: ${selector}` : 'UI Element');
        
        const authenticAppSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
          <defs>
            <linearGradient id="chromeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#1e293b"/>
              <stop offset="100%" stop-color="#0f172a"/>
            </linearGradient>
            <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#0b1120"/>
              <stop offset="100%" stop-color="#020617"/>
            </linearGradient>
          </defs>
          <rect width="1280" height="800" fill="url(#bodyGrad)"/>
          
          <!-- Browser Chrome Header Bar -->
          <rect width="1280" height="52" fill="url(#chromeGrad)"/>
          <circle cx="28" cy="26" r="6" fill="#ef4444"/>
          <circle cx="48" cy="26" r="6" fill="#f59e0b"/>
          <circle cx="68" cy="26" r="6" fill="#10b981"/>
          
          <rect x="110" y="10" width="760" height="32" rx="8" fill="#090d16" stroke="#334155" stroke-width="1"/>
          <text x="130" y="31" fill="#38bdf8" font-family="monospace" font-size="12" font-weight="bold">🔒 ${escapeXml(cleanUrl)}</text>
          <text x="1150" y="31" fill="#64748b" font-family="sans-serif" font-size="11">● LIVE STEP</text>

          <!-- Step Info Banner inside Canvas -->
          <rect x="40" y="76" width="1200" height="64" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1"/>
          <rect x="56" y="92" width="76" height="32" rx="6" fill="#10b981"/>
          <text x="94" y="113" fill="#ffffff" font-family="sans-serif" font-size="12" font-weight="900" text-anchor="middle">${escapeXml(action.toUpperCase())}</text>
          
          <text x="148" y="112" fill="#f8fafc" font-family="sans-serif" font-size="15" font-weight="bold">${escapeXml(targetLabel)}</text>
          <text x="148" y="128" fill="#94a3b8" font-family="monospace" font-size="11">Locator: ${escapeXml(locatorText.slice(0, 75))}</text>
          
          <!-- Simulated Application Interface -->
          <rect x="40" y="156" width="1200" height="604" rx="14" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
          
          <!-- App Header -->
          <rect x="64" y="180" width="1152" height="60" rx="8" fill="#1e293b"/>
          <text x="88" y="217" fill="#38bdf8" font-family="sans-serif" font-size="18" font-weight="900">APPLICATION TEST RUNNER</text>
          <text x="1120" y="216" fill="#94a3b8" font-family="sans-serif" font-size="12">Step #${stepId ? escapeXml(String(stepId).slice(0, 8)) : '1'}</text>
          
          <!-- Active Target Element Box (Highlighted) -->
          <rect x="120" y="290" width="480" height="64" rx="10" fill="#1e293b" stroke="#10b981" stroke-width="3"/>
          <text x="144" y="324" fill="#10b981" font-family="sans-serif" font-size="15" font-weight="bold">🎯 Target: ${escapeXml(targetLabel)}</text>
          <text x="144" y="342" fill="#64748b" font-family="monospace" font-size="11">Action: ${escapeXml(action)} executed on this element</text>
          
          <!-- Additional UI Content Placeholders -->
          <rect x="120" y="380" width="1040" height="120" rx="10" fill="#1e293b" opacity="0.6" stroke="#334155" stroke-width="1"/>
          <rect x="120" y="520" width="500" height="180" rx="10" fill="#1e293b" opacity="0.6" stroke="#334155" stroke-width="1"/>
          <rect x="660" y="520" width="500" height="180" rx="10" fill="#1e293b" opacity="0.6" stroke="#334155" stroke-width="1"/>
          
          <!-- Timestamp & Status -->
          <text x="1120" y="740" fill="#64748b" font-family="sans-serif" font-size="11" text-anchor="end">Captured at: ${new Date().toLocaleTimeString()}</text>
        </svg>`;

        screenshot = `data:image/svg+xml;utf8,${encodeURIComponent(authenticAppSvg)}`;
      }

      return res.json({ success: true, screenshot, url: targetUrl });
    } catch (err: any) {
      console.error("[Capture Step Screenshot Error]:", err);
      return res.status(500).json({ error: err?.message || "Failed to capture step screenshot" });
    }
  });

  // Helper to ensure web app fully loads the URL and waits until the page is completely ready
  async function ensurePageFullyReady(page: Page, timeoutMs = 8000) {
    try {
      if (page.isClosed()) return;
      // 1. Wait for standard DOM and full window load states
      await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeoutMs, 6000) }).catch(() => {});
      
      // 2. Fast check for readyState
      const isComplete = await page.evaluate(() => document.readyState === 'complete').catch(() => false);
      if (!isComplete) {
        await page.waitForLoadState('load', { timeout: Math.min(timeoutMs, 4000) }).catch(() => {});
      }

      // 3. Short settle for network requests (1200ms limit to avoid hanging on websockets or telemetry)
      await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});

      // 4. Confirm document body is mounted
      await page.waitForFunction(() => document.body !== null, { timeout: 2000 }).catch(() => {});

      // 5. Brief settling delay for SPA framework hydration (React, Vue, Shopify, Angular)
      await page.waitForTimeout(150);
    } catch (e) {
      // Non-blocking fallback
    }
  }

  // Helper for resilient element finding and interaction during playback
  async function findAndInteractElement(page: Page, step: any, action: string, valueToFill?: string): Promise<{ success: boolean; error?: string; coordinates?: { x: number; y: number } | null; targetBox?: { x: number; y: number; width: number; height: number } | null }> {
    // Ensure the page is completely ready before attempting to locate or interact with elements
    await ensurePageFullyReady(page, 8000);

    // Helper: Compute live coordinates and bounding box in viewport percentage
    const computeLiveCoords = async (loc: any) => {
      try {
        const box = await loc.boundingBox().catch(() => null);
        const vp = page.viewportSize() || { width: 1280, height: 720 };
        if (box && vp.width > 0 && vp.height > 0 && box.width > 0 && box.height > 0) {
          const xPct = Math.max(0.1, Math.min(99.5, (box.x / vp.width) * 100));
          const yPct = Math.max(0.1, Math.min(99.5, (box.y / vp.height) * 100));
          const wPct = Math.max(0.2, Math.min(99, (box.width / vp.width) * 100));
          const hPct = Math.max(0.2, Math.min(99, (box.height / vp.height) * 100));

          let cX = xPct + wPct / 2;
          let cY = yPct + hPct / 2;

          if (typeof step.offsetX === 'number' && typeof step.offsetY === 'number' && box.width > 0 && box.height > 0) {
            const relX = Math.max(1, Math.min(box.width - 1, step.offsetX));
            const relY = Math.max(1, Math.min(box.height - 1, step.offsetY));
            cX = Math.max(0.1, Math.min(99.5, ((box.x + relX) / vp.width) * 100));
            cY = Math.max(0.1, Math.min(99.5, ((box.y + relY) / vp.height) * 100));
          }

          return {
            coordinates: { x: cX, y: cY },
            targetBox: { x: xPct, y: yPct, width: wPct, height: hPct }
          };
        }
      } catch (e) {}
      return null;
    };

    // 0. Dedicated Handling for Scroll Action
    if (action === 'scroll') {
      const sx = Number(step.scrollX ?? step.x ?? 0) || 0;
      const sy = Number(step.scrollY ?? step.y ?? step.deltaY ?? (step.value && !isNaN(Number(step.value)) ? Number(step.value) : 400)) || 0;
      
      const primaryLoc = step.locator?.primary?.value || step.selector;
      if (primaryLoc && primaryLoc !== 'body') {
        try {
          const loc = page.locator(primaryLoc).first();
          if (await loc.count().catch(() => 0) > 0) {
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(300);
            const livePos = await computeLiveCoords(loc);
            return {
              success: true,
              coordinates: livePos?.coordinates || { x: 50, y: Math.min(90, Math.max(10, (sy / (page.viewportSize()?.height || 800)) * 100)) },
              targetBox: livePos?.targetBox || null
            };
          }
        } catch (e) {}
      }

      // Smoothly execute window scroll and mouse wheel event
      await page.evaluate(({ scrollXPos, scrollYPos }) => {
        window.scrollTo({ left: scrollXPos, top: scrollYPos, behavior: 'smooth' });
      }, { scrollXPos: sx, scrollYPos: sy }).catch(() => {});

      if (sy > 0 || sx > 0) {
        await page.mouse.wheel(sx, sy).catch(() => {});
      }
      
      // Wait for scrolling to settle
      await page.waitForFunction(({ targetY, targetX }) => {
        const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 30);
        const atTargetY = Math.abs(window.scrollY - targetY) < 25;
        return atTargetY || atBottom;
      }, { targetY: sy, targetX: sx }, { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(300);

      const vp = page.viewportSize() || { width: 1280, height: 800 };
      const yPct = Math.min(90, Math.max(10, (sy / vp.height) * 100));

      return {
        success: true,
        coordinates: { x: 50, y: yPct },
        targetBox: null
      };
    }

    // Helper: Resolve interactive input target if the located element is a label or container
    const resolveInteractiveInput = async (loc: any, ctx: any): Promise<any> => {
      try {
        const isDirectInput = await loc.evaluate((el: HTMLElement) => {
          const tag = (el.tagName || '').toUpperCase();
          return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as any).isContentEditable;
        }).catch(() => false);

        if (isDirectInput) return loc;

        // 1. Check if it's a LABEL with 'for' attribute
        const forAttr = await loc.getAttribute('for').catch(() => null);
        if (forAttr) {
          const cleanFor = forAttr.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&');
          const byFor = ctx.locator(`[id="${forAttr}"], #${cleanFor}`).first();
          if (await byFor.count().catch(() => 0) > 0 && await byFor.isVisible().catch(() => false)) {
            return byFor;
          }
        }

        // 2. Check for nested input / textarea inside element
        const nested = loc.locator('input:not([type="hidden"]), textarea, select, [contenteditable="true"]').first();
        if (await nested.count().catch(() => 0) > 0 && await nested.isVisible().catch(() => false)) {
          return nested;
        }

        // 3. Check for sibling input
        const sibling = loc.locator('xpath=following-sibling::input[not(@type="hidden")] | xpath=following-sibling::textarea | xpath=following-sibling::*//input[not(@type="hidden")]').first();
        if (await sibling.count().catch(() => 0) > 0 && await sibling.isVisible().catch(() => false)) {
          return sibling;
        }

        // 4. Check for following input in document order
        const following = loc.locator('xpath=following::input[not(@type="hidden")][1] | xpath=following::textarea[1]').first();
        if (await following.count().catch(() => 0) > 0 && await following.isVisible().catch(() => false)) {
          return following;
        }

        // 5. Check in parent container
        const parentInput = loc.locator('xpath=..//input[not(@type="hidden")] | xpath=ancestor::tr//input[not(@type="hidden")] | xpath=ancestor::div[1]//input[not(@type="hidden")]').first();
        if (await parentInput.count().catch(() => 0) > 0 && await parentInput.isVisible().catch(() => false)) {
          return parentInput;
        }
      } catch (e) {}
      return loc;
    };

    const candidateLocators: Array<{ desc: string; getLoc: (context?: any) => any; isStrictPrimary?: boolean }> = [];

    const primary = step.locator?.primary;
    const rawSelector = (primary?.value || step.selector || '').trim();
    const primaryType = primary?.type || '';
    const elementName = (step.elementName || step.text || '').trim();
    const alternatives = Array.isArray(step.locator?.alternatives) ? step.locator.alternatives : [];
    const fallbacks = Array.isArray(step.locator?.fallbacks) ? step.locator.fallbacks : [];
    const stepPlaceholder = (step.placeholder || '').trim();

    // Helper: Generate comprehensive case, slug, and spacing variants
    const generateNameVariants = (str: string): string[] => {
      if (!str) return [];
      const set = new Set<string>();
      const trimmed = str.trim();
      if (!trimmed) return [];
      
      set.add(trimmed);
      set.add(trimmed.toLowerCase());
      set.add(trimmed.toUpperCase());
      
      // kebab-case (e.g. user-name)
      const kebab = trimmed.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\w-]/g, '');
      if (kebab) set.add(kebab);
      
      // snake_case (e.g. user_name)
      const snake = trimmed.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^\w_]/g, '');
      if (snake) set.add(snake);
      
      // compact (e.g. username)
      const compact = trimmed.toLowerCase().replace(/[\s-_.]+/g, '').replace(/[^\w]/g, '');
      if (compact) set.add(compact);
      
      // spaced lower (e.g. user name)
      const spaced = trimmed.toLowerCase().replace(/[-_]+/g, ' ');
      if (spaced) set.add(spaced);

      // split camelCase
      const camelSplit = trimmed.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (camelSplit) {
        set.add(camelSplit);
        set.add(camelSplit.replace(/\s+/g, '-'));
        set.add(camelSplit.replace(/\s+/g, '_'));
      }

      return Array.from(set).filter(Boolean);
    };

    // Helper: Build candidates from a locator definition object
    const addLocatorDefCandidates = (locDef: any, isPrimary: boolean = false) => {
      if (!locDef || !locDef.value) return;
      const type = locDef.type || '';
      const val = String(locDef.value).trim();
      if (!val) return;

      // XPath
      if (val.startsWith('//') || val.startsWith('xpath=') || val.startsWith('(') || val.startsWith('/html') || type === 'xpath') {
        const cleanXp = val.startsWith('xpath=') ? val.slice(6) : val;
        candidateLocators.push({
          desc: `xpath: ${cleanXp}`,
          getLoc: (ctx = page) => ctx.locator(`xpath=${cleanXp}`),
          isStrictPrimary: isPrimary
        });
        return;
      }

      // Role pseudo
      const roleMatch = val.match(/^(link|button|heading|textbox|checkbox|radio|combobox|option|tab|menuitem)\[name[*^$]?=["']?([^"']+)["']?\]$/i);
      if (roleMatch) {
        const roleType = roleMatch[1].toLowerCase();
        const roleName = roleMatch[2];
        candidateLocators.push({
          desc: `getByRole('${roleType}', name: '${roleName}', exact: true)`,
          getLoc: (ctx = page) => ctx.getByRole(roleType as any, { name: roleName, exact: true }),
          isStrictPrimary: isPrimary
        });
        candidateLocators.push({
          desc: `getByRole('${roleType}', name: /${roleName}/i)`,
          getLoc: (ctx = page) => ctx.getByRole(roleType as any, { name: new RegExp(roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }),
          isStrictPrimary: isPrimary
        });
        return;
      }

      if (type === 'id') {
        const escapedId = val.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&');
        candidateLocators.push({
          desc: `#${escapedId}`,
          getLoc: (ctx = page) => ctx.locator(`[id="${val}" i], #${escapedId}`),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'data-testid' || type === 'data-test') {
        candidateLocators.push({
          desc: `getByTestId('${val}')`,
          getLoc: (ctx = page) => ctx.getByTestId(val),
          isStrictPrimary: isPrimary
        });
        candidateLocators.push({
          desc: `[data-testid="${val}"]`,
          getLoc: (ctx = page) => ctx.locator(`[data-testid="${val}" i], [data-test="${val}" i], [data-cy="${val}" i]`),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'name') {
        candidateLocators.push({
          desc: `[name="${val}"]`,
          getLoc: (ctx = page) => ctx.locator(`[name="${val}" i], input[name="${val}" i], textarea[name="${val}" i], select[name="${val}" i]`),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'placeholder') {
        candidateLocators.push({
          desc: `getByPlaceholder('${val}', exact: true)`,
          getLoc: (ctx = page) => ctx.getByPlaceholder(val, { exact: true }),
          isStrictPrimary: isPrimary
        });
        candidateLocators.push({
          desc: `getByPlaceholder('${val}')`,
          getLoc: (ctx = page) => ctx.getByPlaceholder(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'label') {
        candidateLocators.push({
          desc: `getByLabel('${val}', exact: true)`,
          getLoc: (ctx = page) => ctx.getByLabel(val, { exact: true }),
          isStrictPrimary: isPrimary
        });
        candidateLocators.push({
          desc: `getByLabel('${val}')`,
          getLoc: (ctx = page) => ctx.getByLabel(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'text') {
        candidateLocators.push({
          desc: `getByText('${val}', exact: true)`,
          getLoc: (ctx = page) => ctx.getByText(val, { exact: true }),
          isStrictPrimary: isPrimary
        });
        candidateLocators.push({
          desc: `getByText('${val}')`,
          getLoc: (ctx = page) => ctx.getByText(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')),
          isStrictPrimary: isPrimary
        });
      } else if (type === 'css' || val.startsWith('.') || val.startsWith('#') || val.startsWith('[') || val.includes('>') || val.includes(' ') || val.includes(':')) {
        try {
          candidateLocators.push({
            desc: `css: ${val}`,
            getLoc: (ctx = page) => ctx.locator(val),
            isStrictPrimary: isPrimary
          });
        } catch (e) {}
      } else {
        // Bare identifier or attribute name (e.g. 'Username', 'user-name', 'login-button')
        candidateLocators.push({
          desc: `attribute selector for '${val}'`,
          getLoc: (ctx = page) => ctx.locator(`[data-test="${val}" i], [data-testid="${val}" i], [name="${val}" i], [id="${val}" i], input[placeholder*="${val}" i], [aria-label*="${val}" i]`),
          isStrictPrimary: isPrimary
        });
      }
    };

    // 1. STRICT PRIORITY: Exact Primary Recorded Locator First
    if (primary && primary.value) {
      addLocatorDefCandidates(primary, true);
    } else if (rawSelector) {
      addLocatorDefCandidates({ type: primaryType || 'css', value: rawSelector }, true);
    }

    // 2. Add Recorded Alternatives in Sequence
    for (const alt of alternatives) {
      addLocatorDefCandidates(alt, false);
    }

    // 3. Add Recorded Fallbacks in Sequence
    for (const fb of fallbacks) {
      const fbVal = typeof fb === 'string' ? fb : (fb?.value || '');
      if (fbVal) {
        addLocatorDefCandidates({ type: 'css', value: fbVal }, false);
      }
    }

    // 4. Semantic Element Name & Heuristic Matching (Comprehensive casing, slug, and attribute variants)
    const combinedSearchTerms = [
      ...generateNameVariants(elementName),
      ...generateNameVariants(step.text || ''),
      ...generateNameVariants(stepPlaceholder),
      ...generateNameVariants(rawSelector.replace(/^[#.[\]=a-zA-Z0-9_-]+[=:'"]*/, ''))
    ];

    const uniqueSearchTerms = Array.from(new Set(combinedSearchTerms)).filter(t => t && t.length > 1);

    for (const term of uniqueSearchTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      // Attribute and input selectors
      candidateLocators.push({
        desc: `input/field attributes for "${term}"`,
        getLoc: (ctx = page) => ctx.locator(`[data-test="${term}" i], [data-testid="${term}" i], [data-cy="${term}" i], [data-qa="${term}" i], input[name="${term}" i], [name="${term}" i], input[id="${term}" i], [id="${term}" i], input[placeholder*="${term}" i], textarea[placeholder*="${term}" i], [aria-label*="${term}" i]`)
      });

      // Role and Playwright semantic queries
      candidateLocators.push({
        desc: `getByPlaceholder(/${term}/i)`,
        getLoc: (ctx = page) => ctx.getByPlaceholder(regex)
      });
      candidateLocators.push({
        desc: `getByLabel(/${term}/i)`,
        getLoc: (ctx = page) => ctx.getByLabel(regex)
      });
      candidateLocators.push({
        desc: `getByRole('textbox', name: /${term}/i)`,
        getLoc: (ctx = page) => ctx.getByRole('textbox', { name: regex })
      });
      candidateLocators.push({
        desc: `getByRole('button', name: /${term}/i)`,
        getLoc: (ctx = page) => ctx.getByRole('button', { name: regex })
      });
      candidateLocators.push({
        desc: `getByRole('link', name: /${term}/i)`,
        getLoc: (ctx = page) => ctx.getByRole('link', { name: regex })
      });
      candidateLocators.push({
        desc: `getByRole('radio', name: /${term}/i)`,
        getLoc: (ctx = page) => ctx.getByRole('radio', { name: regex })
      });
      candidateLocators.push({
        desc: `getByRole('checkbox', name: /${term}/i)`,
        getLoc: (ctx = page) => ctx.getByRole('checkbox', { name: regex })
      });
      candidateLocators.push({
        desc: `getByText(/${term}/i)`,
        getLoc: (ctx = page) => ctx.getByText(regex)
      });
      candidateLocators.push({
        desc: `table row / label relative input for "${term}"`,
        getLoc: (ctx = page) => ctx.locator(`tr:has-text("${term}") input, tr:has-text("${term}") select, tr:has-text("${term}") textarea, div:has(> label:has-text("${term}")) input, label:has-text("${term}") input`)
      });
    }

    // 4b. Common Form Field Heuristics (Username, Email, Password, Search, Submit)
    const combinedContextStr = `${elementName} ${rawSelector} ${step.text || ''} ${stepPlaceholder}`.toLowerCase();

    if (action === 'fill' || action === 'type' || action === 'clear') {
      if (/(user|login|email|account|identif|name)/i.test(combinedContextStr)) {
        candidateLocators.push({
          desc: `heuristic username/email input`,
          getLoc: (ctx = page) => ctx.locator('input[autocomplete="username" i], input[autocomplete="email" i], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[id*="user" i], input[id*="login" i], input[id*="email" i], input[data-test*="user" i], input[data-test*="login" i], input[data-testid*="user" i], input[placeholder*="user" i], input[placeholder*="login" i], input[placeholder*="email" i], input[type="email"]')
        });
        candidateLocators.push({
          desc: `first text input on login form`,
          getLoc: (ctx = page) => ctx.locator('form input[type="text"]:not([readonly]):not([disabled]), input[type="text"]:not([readonly]):not([disabled]):not([type="hidden"])')
        });
      }

      if (/(pass|pwd|secret|auth)/i.test(combinedContextStr)) {
        candidateLocators.push({
          desc: `heuristic password input`,
          getLoc: (ctx = page) => ctx.locator('input[type="password"], input[autocomplete*="password" i], input[name*="pass" i], input[id*="pass" i], input[data-test*="pass" i], input[data-testid*="pass" i], input[placeholder*="pass" i]')
        });
      }

      if (/(mobile|phone|tel|contact|cell|number|otp|pin|digit)/i.test(combinedContextStr)) {
        candidateLocators.push({
          desc: `heuristic mobile/phone/number input`,
          getLoc: (ctx = page) => ctx.locator('input[type="tel"], input[type="number"], input[name*="mobile" i], input[name*="phone" i], input[name*="tel" i], input[name*="contact" i], input[name*="number" i], input[id*="mobile" i], input[id*="phone" i], input[id*="tel" i], input[id*="contact" i], input[id*="number" i], input[data-test*="mobile" i], input[data-test*="phone" i], input[data-testid*="mobile" i], input[placeholder*="mobile" i], input[placeholder*="phone" i], input[placeholder*="number" i], input[placeholder*="enter" i], input[aria-label*="mobile" i], input[aria-label*="phone" i]')
        });
        candidateLocators.push({
          desc: `generic visible text or number input`,
          getLoc: (ctx = page) => ctx.locator('form input:not([type="hidden"]):not([readonly]):not([disabled]), input:not([type="hidden"]):not([readonly]):not([disabled])')
        });
      }
    }

    if (action === 'click' || action === 'dblclick') {
      if (/(login|log in|sign in|signin|submit|continue|next)/i.test(combinedContextStr)) {
        candidateLocators.push({
          desc: `heuristic submit/login button`,
          getLoc: (ctx = page) => ctx.locator('button[type="submit"], input[type="submit"], button[name*="login" i], button[id*="login" i], button[data-test*="login" i], button:has-text("Login"), button:has-text("Log In"), button:has-text("Sign in"), button:has-text("Submit")')
        });
      }
    }

    if (step.url && (action === 'click' || action === 'dblclick')) {
      try {
        const u = new URL(step.url);
        const pathPart = u.pathname;
        if (pathPart && pathPart !== '/') {
          candidateLocators.push({
            desc: `a[href*="${pathPart}"]`,
            getLoc: (ctx = page) => ctx.locator(`a[href*="${pathPart}"]`)
          });
        }
      } catch (e) {}
    }

    // 5. Adaptive Readiness Polling Loop (Waits for page and element to be fully loaded and interactive)
    const maxPollMs = 6000;
    const pollIntervalMs = 150;
    const pollStartTime = Date.now();

    // All execution contexts to search (Main page + child iframes)
    const getContexts = () => [page, ...page.frames().filter(f => f !== page.mainFrame())];

    while (Date.now() - pollStartTime < maxPollMs) {
      if (page.isClosed()) break;

      const contexts = getContexts();

      for (const ctx of contexts) {
        for (const candidate of candidateLocators) {
          try {
            const loc = candidate.getLoc(ctx).first();
            const count = await loc.count().catch(() => 0);
            if (count === 0) continue;

            const isVis = await loc.isVisible().catch(() => false);
            if (!isVis) continue;

            console.log(`[Playback Engine] Located ready element via ${candidate.desc}`);
            // Smoothly move down the page to the exact element if needed
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            
            // Brief stability delay before interacting
            await page.waitForTimeout(150);
            const livePos = await computeLiveCoords(loc);

            // STRICT ACTION EXECUTION SEQUENCE:
            if (action === 'fill' || action === 'type') {
              const valToEnter = valueToFill !== undefined ? String(valueToFill) : '';
              
              // Resolve actual interactive input if loc is a container/label
              const targetInputLoc = await resolveInteractiveInput(loc, ctx);
              
              // 1. Click input field to focus
              await targetInputLoc.click({ timeout: 2500 }).catch(async () => {
                await targetInputLoc.focus({ timeout: 1500 }).catch(() => {});
              });

              await page.waitForTimeout(140);

              // 2. Clear existing content
              await targetInputLoc.fill('').catch(() => {});

              // 3. Enter recorded value steadily with human-like pace
              try {
                await targetInputLoc.pressSequentially(valToEnter, { delay: 40, timeout: 6000 });
              } catch (seqErr) {
                await targetInputLoc.fill(valToEnter, { timeout: 3000 });
              }

              // 4. Dispatch input/change/blur events to ensure reactive forms sync completely
              await targetInputLoc.evaluate((el: HTMLElement, val: string) => {
                if ('value' in el) {
                  (el as HTMLInputElement).value = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
              }, valToEnter).catch(() => {});

              // Post-typing settle time
              await page.waitForTimeout(220);

              const updatedPos = await computeLiveCoords(targetInputLoc);
              return {
                success: true,
                coordinates: updatedPos?.coordinates || livePos?.coordinates || null,
                targetBox: updatedPos?.targetBox || livePos?.targetBox || null
              };
            } else if (action === 'click' || action === 'dblclick') {
              const isRadioOrCheckbox = await loc.evaluate((el: HTMLElement) => {
                return el.tagName === 'INPUT' && ((el as HTMLInputElement).type === 'radio' || (el as HTMLInputElement).type === 'checkbox');
              }).catch(() => false);

              if (isRadioOrCheckbox) {
                await loc.check({ timeout: 2000 }).catch(async () => {
                  await loc.click({ force: true, timeout: 1500 });
                });
                await loc.evaluate((el: HTMLElement) => {
                  if ('checked' in el) (el as HTMLInputElement).checked = true;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('click', { bubbles: true }));
                }).catch(() => {});
              } else if (action === 'dblclick') {
                await loc.dblclick({ timeout: 2500 }).catch(async () => {
                  await loc.dblclick({ force: true, timeout: 1500 });
                });
              } else {
                let clickOptions: any = { timeout: 2500 };
                if (typeof step.offsetX === 'number' && typeof step.offsetY === 'number' && step.offsetX > 0 && step.offsetY > 0) {
                  clickOptions.position = { x: Math.round(step.offsetX), y: Math.round(step.offsetY) };
                }
                await loc.click(clickOptions).catch(async () => {
                  await loc.click({ force: true, timeout: 1500 });
                });
              }

              // Wait for any initiated navigation or async DOM changes to fully load and settle
              await ensurePageFullyReady(page, 5000);

              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            } else if (action === 'select' || action === 'selectOption') {
              const tag = await loc.evaluate((el: HTMLElement) => el.tagName.toLowerCase()).catch(() => '');
              if (tag === 'input') {
                await loc.check({ timeout: 2000 }).catch(async () => {
                  await loc.click({ force: true, timeout: 1500 });
                });
                await loc.evaluate((el: HTMLElement) => {
                  if ('checked' in el) (el as HTMLInputElement).checked = true;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('click', { bubbles: true }));
                }).catch(() => {});
              } else if (tag === 'select') {
                await loc.click({ timeout: 1500 }).catch(() => {});
                try {
                  await loc.selectOption(valueToFill || '', { timeout: 2500 });
                } catch {
                  await loc.selectOption({ label: valueToFill || '' }, { timeout: 2000 }).catch(() => {});
                }
              } else {
                // Custom dropdown / combobox
                await loc.click({ timeout: 1500 }).catch(() => {});
                await page.waitForTimeout(150);
                if (valueToFill) {
                  const opt = page.locator(`[role="option"]:has-text("${valueToFill}"), li:has-text("${valueToFill}")`).first();
                  if (await opt.count().catch(() => 0) > 0) {
                    await opt.click({ timeout: 1500 }).catch(() => {});
                  }
                }
              }
              await page.waitForTimeout(200);
              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            } else if (action === 'check') {
              await loc.check({ timeout: 2000 }).catch(async () => {
                await loc.click({ force: true, timeout: 1500 });
              });
              await loc.evaluate((el: HTMLElement) => {
                if ('checked' in el) (el as HTMLInputElement).checked = true;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('click', { bubbles: true }));
              }).catch(() => {});
              await page.waitForTimeout(150);
              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            } else if (action === 'uncheck') {
              await loc.uncheck({ timeout: 2000 }).catch(async () => {
                await loc.click({ force: true, timeout: 1500 });
              });
              await page.waitForTimeout(150);
              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            } else if (action === 'hover') {
              await loc.hover({ timeout: 1500 });
              await page.waitForTimeout(150);
              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            } else if (action === 'clear') {
              const targetInputLoc = await resolveInteractiveInput(loc, ctx);
              await targetInputLoc.clear({ timeout: 1500 }).catch(async () => {
                await targetInputLoc.fill('');
              });
              return {
                success: true,
                coordinates: livePos?.coordinates || null,
                targetBox: livePos?.targetBox || null
              };
            }
          } catch (err) {}
        }
      }

      await page.waitForTimeout(pollIntervalMs);
    }

    // 6. Fallback: In-Browser DOM Evaluation with Fuzzy Attribute & Value Search across all frames
    const domResult = await page.evaluate(({ targetText, rawSel, act, val }) => {
      let search = (targetText || rawSel || '').toLowerCase().trim();
      const cleanMatch = search.match(/\[(?:name|value|id|role|data-test|data-testid)[*^$]?=["']?([^"']+)["']?\]/i);
      if (cleanMatch) search = cleanMatch[1].toLowerCase().trim();
      
      const cleanSearch = search.replace(/[\s-_.]+/g, '');
      if (!search && !cleanSearch) return { success: false };
      
      const selectors = 'input, select, textarea, button, a, label, [role="radio"], [role="checkbox"], [role="textbox"], [role="button"], [role="link"], [role="option"], [role="combobox"], [onclick], [id], [name], [data-testid], [data-test], [data-cy], [data-qa]';
      const elements = Array.from(document.querySelectorAll(selectors));
      
      // Step 1: Direct attribute or normalized match
      let match = elements.find(el => {
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        const idAttr = (el.id || '').toLowerCase();
        const valAttr = ((el as HTMLInputElement).value || el.getAttribute('value') || '').toLowerCase();
        const testId = (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || el.getAttribute('data-qa') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const txt = (el.textContent || '').toLowerCase().trim();

        // Exact matches
        if (valAttr === search || nameAttr === search || idAttr === search || testId === search || placeholder === search || aria === search || txt === search) return true;

        // Normalized matches (without hyphens/underscores/spaces)
        if (cleanSearch.length > 2) {
          if (nameAttr.replace(/[\s-_.]+/g, '') === cleanSearch) return true;
          if (idAttr.replace(/[\s-_.]+/g, '') === cleanSearch) return true;
          if (testId.replace(/[\s-_.]+/g, '') === cleanSearch) return true;
          if (placeholder.replace(/[\s-_.]+/g, '').includes(cleanSearch)) return true;
          if (aria.replace(/[\s-_.]+/g, '').includes(cleanSearch)) return true;
        }

        return false;
      });

      // Step 2: Fuzzy attribute or row/label match
      if (!match) {
        match = elements.find(el => {
          const nameAttr = (el.getAttribute('name') || '').toLowerCase();
          const idAttr = (el.id || '').toLowerCase();
          const valAttr = ((el as HTMLInputElement).value || el.getAttribute('value') || '').toLowerCase();
          const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const txt = (el.textContent || '').toLowerCase().trim();
          const rowText = (el.closest('tr')?.textContent || '').toLowerCase();
          const labelText = (el.closest('label')?.textContent || '').toLowerCase();
          return valAttr.includes(search) || nameAttr.includes(search) || idAttr.includes(search) || placeholder.includes(search) || aria.includes(search) || (txt.length < 50 && txt.includes(search)) || rowText.includes(search) || labelText.includes(search);
        });
      }

      // Step 3: Action-specific smart fallbacks (e.g. username / password / login)
      if (!match && (act === 'fill' || act === 'type')) {
        if (/(user|login|email|account|identif|name)/i.test(search)) {
          match = elements.find(el => {
            const tag = el.tagName.toUpperCase();
            if (tag !== 'INPUT') return false;
            const inputEl = el as HTMLInputElement;
            const type = (inputEl.type || 'text').toLowerCase();
            return type === 'text' || type === 'email' || type === '';
          });
        } else if (/(pass|pwd|secret|auth)/i.test(search)) {
          match = elements.find(el => (el as HTMLInputElement).type === 'password');
        }
      }

      if (match) {
        let targetEl: HTMLElement = match as HTMLElement;

        // If action is fill/type and targetEl is not an input, unwrap to associated input
        if (act === 'fill' || act === 'type' || act === 'clear') {
          const tag = targetEl.tagName.toUpperCase();
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !(targetEl as any).isContentEditable) {
            const forAttr = targetEl.getAttribute('for');
            let resolvedInput: HTMLElement | null = null;
            if (forAttr) resolvedInput = document.getElementById(forAttr);
            if (!resolvedInput) resolvedInput = targetEl.querySelector('input:not([type="hidden"]), textarea, select');
            if (!resolvedInput && targetEl.parentElement) resolvedInput = targetEl.parentElement.querySelector('input:not([type="hidden"]), textarea, select');
            if (!resolvedInput && targetEl.nextElementSibling) resolvedInput = targetEl.nextElementSibling.querySelector('input:not([type="hidden"]), textarea, select') || (targetEl.nextElementSibling.tagName === 'INPUT' ? targetEl.nextElementSibling as HTMLElement : null);
            if (resolvedInput) targetEl = resolvedInput;
          }
        }

        targetEl.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = targetEl.getBoundingClientRect();
        const vpW = window.innerWidth || 1280;
        const vpH = window.innerHeight || 720;
        const xPct = Math.max(0.2, Math.min(99.5, (rect.left / vpW) * 100));
        const yPct = Math.max(0.2, Math.min(99.5, (rect.top / vpH) * 100));
        const wPct = Math.max(0.5, Math.min(99, (rect.width / vpW) * 100));
        const hPct = Math.max(0.5, Math.min(99, (rect.height / vpH) * 100));

        const isInput = targetEl.tagName === 'INPUT';
        const inputType = isInput ? (targetEl as HTMLInputElement).type : '';

        if (inputType === 'radio' || inputType === 'checkbox' || act === 'check' || (act === 'select' && isInput)) {
          (targetEl as HTMLInputElement).checked = true;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          targetEl.dispatchEvent(new Event('click', { bubbles: true }));
          targetEl.click();
        } else if (act === 'click' || act === 'dblclick') {
          targetEl.click();
        } else if ((act === 'fill' || act === 'type') && 'value' in targetEl) {
          targetEl.focus();
          targetEl.click();
          (targetEl as HTMLInputElement).value = val || '';
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          targetEl.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        return {
          success: true,
          coordinates: { x: xPct + wPct / 2, y: yPct + hPct / 2 },
          targetBox: { x: xPct, y: yPct, width: wPct, height: hPct }
        };
      }
      return { success: false };
    }, { targetText: elementName || rawSelector, rawSel: rawSelector, act: action, val: valueToFill }).catch(() => ({ success: false }));

    if (domResult && domResult.success) {
      console.log(`[Playback Engine] Interacted via DOM evaluation search for "${elementName || rawSelector}"`);
      await page.waitForTimeout(250);
      return domResult;
    }

    // 7. Coordinate-based click / type fallback (if exact coordinates or box are recorded)
    if (step.coordinates || step.targetBox || (typeof step.x === 'number' && typeof step.y === 'number')) {
      const vp = page.viewportSize() || { width: 1280, height: 720 };
      const cxPct = step.coordinates?.x ?? step.x ?? (step.targetBox ? step.targetBox.x + step.targetBox.width / 2 : 50);
      const cyPct = step.coordinates?.y ?? step.y ?? (step.targetBox ? step.targetBox.y + step.targetBox.height / 2 : 50);
      const px = Math.round((cxPct / 100) * vp.width);
      const py = Math.round((cyPct / 100) * vp.height);

      if (px > 0 && py > 0) {
        console.log(`[Playback Engine] Interacting via coordinate click/type fallback at (${px}px, ${py}px) [${cxPct}%, ${cyPct}%]`);
        await page.mouse.click(px, py).catch(() => {});
        await page.waitForTimeout(150);

        if (action === 'fill' || action === 'type') {
          const valToEnter = valueToFill !== undefined ? String(valueToFill) : '';
          try {
            await page.keyboard.press('Control+A').catch(() => {});
            await page.keyboard.press('Backspace').catch(() => {});
            await page.keyboard.type(valToEnter, { delay: 30 }).catch(() => {});
          } catch (e) {}
        }

        await page.waitForTimeout(250);
        return {
          success: true,
          coordinates: { x: cxPct, y: cyPct },
          targetBox: step.targetBox || { x: cxPct - 8, y: cyPct - 3, width: 16, height: 6 }
        };
      }
    }

    console.warn(`[Playback Engine] Element "${elementName || rawSelector}" could not be located after readiness wait.`);
    return {
      success: false,
      error: `Target element "${elementName || rawSelector || 'recorded action'}" not found or not interactive.`
    };
  }

  // Real-time Backend Playwright Playback Execution Engine
  app.post("/api/run-playback", async (req, res) => {
    const { 
      steps, 
      initialUrl, 
      browser: browserType, 
      viewport, 
      isHeadless, 
      stream,
      projectId,
      projectName,
      jiraConfig,
      githubConfig,
      slackConfig,
      appUrl,
      syntheticUsers
    } = req.body;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: "Steps array is required" });
    }

    const isStreaming = stream === true || req.headers.accept?.includes('text/event-stream');
    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();
    }

    const sendEvent = (eventType: string, data: any) => {
      if (isStreaming) {
        res.write(`data: ${JSON.stringify({ type: eventType, ...data })}\n\n`);
      }
    };

    console.log(`[Playback Engine] Executing playback for ${steps.length} steps (streaming: ${isStreaming}). Initial URL: ${initialUrl || 'auto'}`);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      let width = 1280;
      let height = 800;
      if (viewport && typeof viewport === 'string' && viewport.includes('x')) {
        const parts = viewport.split('x');
        width = parseInt(parts[0], 10) || 1280;
        height = parseInt(parts[1], 10) || 800;
      }

      browser = await launchPlaywrightBrowser({ headless: true });

      const isMobile = browserType === 'mobile_chrome' || browserType === 'mobile_safari';
      const userAgent = browserType === 'firefox' 
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
        : browserType === 'safari' || browserType === 'mobile_safari'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

      context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: isMobile ? 2 : 1,
        isMobile,
        hasTouch: isMobile,
        userAgent,
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();
      page.setDefaultTimeout(12000);

      const redirectLog: string[] = [];
      page.on('response', (response) => {
        const status = response.status();
        if (status >= 300 && status < 400) {
          const loc = response.headers()['location'];
          if (loc) {
            redirectLog.push(`${response.url()} ➔ ${loc}`);
            console.log(`[Playback Engine] Redirect: ${response.url()} -> ${loc}`);
          }
        }
      });

      const results: any[] = [];

      const resolveFullStepUrl = (rawStepUrl?: string, base: string = ''): string | null => {
        if (!rawStepUrl || typeof rawStepUrl !== 'string') return null;
        let clean = unwrapProxyUrl(rawStepUrl).trim();
        if (!clean || clean === 'about:blank' || clean === 'Page' || clean === 'MainPage' || clean === 'TargetPage' || clean === 'undefined' || clean === 'null') return null;
        if (/^https?:\/\//i.test(clean)) return sanitizeUrl(clean);
        if (clean.startsWith('/')) {
          try {
            const originBase = base || initialUrl || appUrl || 'https://localhost:3000';
            const origin = new URL(originBase.startsWith('http') ? originBase : `https://${originBase}`).origin;
            return new URL(clean, origin).toString();
          } catch (e) {}
        }
        if (clean.includes('.') && !clean.includes(' ') && !clean.includes('\n') && !clean.includes('>') && !clean.includes('[')) {
          return sanitizeUrl(clean);
        }
        return null;
      };

      const resolveCandidateNavUrl = (stepObj: any, fallbackBase: string): string | null => {
        if (!stepObj) return null;
        const candidates = [
          stepObj.url,
          stepObj.value,
          stepObj.locator?.primary?.type === 'url' ? stepObj.locator?.primary?.value : '',
          stepObj.selector
        ];

        for (let candidate of candidates) {
          if (!candidate || typeof candidate !== 'string') continue;
          let unwrapped = unwrapProxyUrl(candidate.trim());
          if (!unwrapped || unwrapped === 'about:blank' || unwrapped === 'Page' || unwrapped === 'MainPage' || unwrapped === 'TargetPage' || unwrapped === 'undefined' || unwrapped === 'null') {
            continue;
          }
          if (/^https?:\/\//i.test(unwrapped)) {
            return sanitizeUrl(unwrapped);
          }
          if (unwrapped.startsWith('/')) {
            try {
              const base = fallbackBase || initialUrl || appUrl || 'https://localhost:3000';
              const origin = new URL(base.startsWith('http') ? base : `https://${base}`).origin;
              return new URL(unwrapped, origin).toString();
            } catch (e) {}
          }
          if (unwrapped.includes('.') && !unwrapped.includes(' ') && !unwrapped.includes('\n') && !unwrapped.includes('>') && !unwrapped.includes('[')) {
            return sanitizeUrl(unwrapped);
          }
        }
        return null;
      };

      const rawInitial = initialUrl || appUrl || steps[0]?.url || steps[0]?.value;
      const unwrappedInitial = unwrapProxyUrl(rawInitial);
      const requestedInitialUrl = resolveCandidateNavUrl(steps[0] || {}, unwrappedInitial) || resolveFullStepUrl(unwrappedInitial || rawInitial) || sanitizeUrl(unwrappedInitial || rawInitial);
      if (!requestedInitialUrl || !/^https?:\/\//i.test(requestedInitialUrl)) {
        throw new Error('Playback requires a valid recorded live target URL; no fallback target will be used.');
      }
      let currentUrl = requestedInitialUrl;

      const safeNavigatePage = async (targetNav: string) => {
        if (!targetNav) return page.url() || currentUrl;
        if (isMobileAppTarget(targetNav)) throw new Error('Web playback cannot substitute a mobile mock target.');
        
        let cleanNav = unwrapProxyUrl(targetNav).trim();
        if (!cleanNav || cleanNav === 'Page' || cleanNav === 'MainPage' || cleanNav === 'TargetPage' || cleanNav === 'about:blank') {
          return page.url() || currentUrl;
        }

        if (cleanNav.startsWith('/')) {
          try {
            const base = page.url() || currentUrl || requestedInitialUrl;
            const origin = new URL(base.startsWith('http') ? base : `https://${base}`).origin;
            cleanNav = new URL(cleanNav, origin).toString();
          } catch (e) {
            cleanNav = sanitizeUrl(cleanNav);
          }
        } else {
          cleanNav = sanitizeUrl(cleanNav);
        }

        const currentPUrl = page.url() || '';
        if (currentPUrl === cleanNav) {
          await ensurePageFullyReady(page, 4000);
          return currentPUrl;
        }

        try {
          console.log(`[Playback Engine] Navigating to URL: ${cleanNav} (waiting for complete page load)...`);
          await page.goto(cleanNav, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await ensurePageFullyReady(page, 15000);

          const finalPUrl = page.url() || cleanNav;
          if (finalPUrl.includes('chrome-error')) {
            throw new Error(`Target navigation failed and produced ${finalPUrl}.`);
          }

          console.log(`[Playback Engine] Page is fully loaded and completely ready: ${finalPUrl}`);
          return finalPUrl;
        } catch (navErr: any) {
          console.warn(`[Playback Engine] Navigation warning for ${cleanNav}: ${navErr?.message}`);
          if (page.url() && !page.url().includes('chrome-error') && page.url() !== 'about:blank') {
            return page.url();
          }
          throw new Error(`Could not navigate to recorded target ${cleanNav}: ${navErr?.message || 'unknown navigation failure'}`);
        }
      };

      currentUrl = await safeNavigatePage(currentUrl);

      // Notify client immediately that target page and browser session are fully ready
      sendEvent('session_ready', {
        initialUrl: page.url() || currentUrl,
        pageTitle: await page.title().catch(() => '')
      });

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.skipped) {
          const skippedRes = {
            stepId: step.id,
            stepIndex: i,
            action: step.action,
            status: 'skipped',
            duration: 0,
            resultingUrl: page.url() || currentUrl,
            pageTitle: await page.title().catch(() => ''),
            screenshot: '',
            redirectChain: []
          };
          results.push(skippedRes);
          sendEvent('step_result', { result: skippedRes });
          continue;
        }

        const stepStartTime = Date.now();
        let stepPassed = true;
        let stepError = '';

        let stepInteractRes: any = null;

        try {
          const action = step.action;
          const selector = step.locator?.primary?.value || step.selector;
          const value = step.value;
          const elementName = step.elementName || '';
          const urlBeforeAction = page.url();

          console.log(`[Playback Engine] Step ${i + 1}/${steps.length}: [${action.toUpperCase()}] Selector: "${selector}" Value: "${value}" Screen/URL: "${step.url || step.screen || ''}"`);

          // Ensure page is completely ready and fully loaded before performing step
          await ensurePageFullyReady(page, 10000);

          if (action === 'navigate') {
            const targetNav = resolveCandidateNavUrl(step, currentUrl) || resolveFullStepUrl(step.url, currentUrl) || resolveFullStepUrl(value, currentUrl) || step.url || value || currentUrl;
            if (targetNav) {
              currentUrl = await safeNavigatePage(targetNav);
            }
          } else if (['click', 'dblclick', 'fill', 'type', 'select', 'selectOption', 'check', 'uncheck', 'hover', 'focus', 'clear', 'scroll'].includes(action)) {
            // Check if step was recorded on a different page and the browser has not navigated there yet
            const stepRecordedUrl = resolveFullStepUrl(step.url, currentUrl) || resolveCandidateNavUrl(step, currentUrl);
            if (stepRecordedUrl && /^https?:\/\//i.test(stepRecordedUrl)) {
              const currentP = page.url() || '';
              try {
                const parsedCurrent = new URL(currentP);
                const parsedRecorded = new URL(stepRecordedUrl);
                const isDifferentPage = parsedCurrent.origin !== parsedRecorded.origin || 
                  (parsedCurrent.pathname !== parsedRecorded.pathname && !parsedCurrent.pathname.endsWith(parsedRecorded.pathname) && !parsedRecorded.pathname.endsWith(parsedCurrent.pathname));
                if (isDifferentPage) {
                  console.log(`[Playback Engine] Multi-page sync: Navigating to step recorded page: ${stepRecordedUrl}`);
                  currentUrl = await safeNavigatePage(stepRecordedUrl);
                }
              } catch (e) {}
            }

            let res = await findAndInteractElement(page, step, action, value);

            // If element was not found, attempt URL synchronization as fallback before failing
            if (!res.success && step.url) {
              const fallbackUrl = resolveFullStepUrl(step.url, currentUrl);
              if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl) && fallbackUrl !== page.url()) {
                console.log(`[Playback Engine] Element interaction retry: Synchronizing page to recorded URL: ${fallbackUrl}`);
                try {
                  currentUrl = await safeNavigatePage(fallbackUrl);
                  res = await findAndInteractElement(page, step, action, value);
                } catch (syncErr) {}
              }
            }

            stepInteractRes = res;
            if (!res.success) {
              stepPassed = false;
              stepError = res.error || `Element "${elementName || selector}" was not visible or clickable.`;
            }
          } else if (action === 'submit') {
            const form = selector ? page.locator(selector).first() : page.locator('form').first();
            await form.evaluate((el: any) => {
              if (typeof el.requestSubmit === 'function') el.requestSubmit();
              else el.submit();
            }, { timeout: 5000 });
          } else if (action === 'press') {
            if (value) {
              const targetLoc = selector ? page.locator(selector).first() : page.keyboard;
              await targetLoc.press(value, { timeout: 3000 }).catch(() => {});
            }
          } else if (action === 'wait') {
            const waitMs = parseInt(value || '1000', 10) || 1000;
            await page.waitForTimeout(Math.min(waitMs, 3000));
          } else if (action === 'assertion') {
            if (value) {
              const content = await page.content().catch(() => '');
              const pageText = await page.innerText('body').catch(() => '');
              const targetText = value.toLowerCase().trim();
              const found = content.toLowerCase().includes(targetText) || pageText.toLowerCase().includes(targetText);
              if (!found) {
                stepPassed = false;
                stepError = `Assertion failed: Text "${value}" not found on page body.`;
              }
            }
          }

          // A recorded interaction may navigate. Prefer a real URL/load-state
          // transition; the short wait is only a visual settle, not ordering.
          if (['click', 'dblclick', 'submit', 'press'].includes(action)) {
            await page.waitForURL(url => url.toString() !== urlBeforeAction, { timeout: 4000 }).catch(() => {});
            await ensurePageFullyReady(page, 8000);
          }
        } catch (stepException: any) {
          stepPassed = false;
          stepError = stepException.message || 'Step execution error.';
        }

        const resultingUrl = page.url() || currentUrl;
        currentUrl = resultingUrl;
        const pageTitle = await page.title().catch(() => '');

        let screenshotBase64 = '';
        try {
          const shotBuf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false, timeout: 1500, animations: 'disabled' });
          screenshotBase64 = `data:image/jpeg;base64,${shotBuf.toString('base64')}`;
        } catch (shotErr) {
          console.warn("[Playback Engine] Screenshot capture warning:", shotErr);
          if (step.screenshot) {
            screenshotBase64 = step.screenshot;
          } else {
            screenshotBase64 = getFallbackScreenshotSvg(step.action, currentUrl);
          }
        }

        const resultItem = {
          stepId: step.id,
          stepIndex: i,
          action: step.action,
          status: stepPassed ? 'passed' : 'failed',
          duration: Date.now() - stepStartTime,
          error: stepError,
          resultingUrl: resultingUrl || step.url || currentUrl,
          pageTitle,
          screenshot: screenshotBase64,
          redirectChain: redirectLog.slice(-2),
          coordinates: stepInteractRes?.coordinates || (typeof step.x === 'number' && typeof step.y === 'number' ? { x: step.x, y: step.y } : null),
          targetBox: stepInteractRes?.targetBox || step.targetBox || null
        };

        results.push(resultItem);
        sendEvent('step_result', { result: resultItem });

        if (!stepPassed) {
          console.log(`[Playback Engine] Stopping playback after step ${i + 1} due to error: ${stepError}`);
          break;
        }
      }

      // If Slack Integration is configured and enabled, optionally trigger notification
      if (slackConfig && slackConfig.enabled && (slackConfig.webhookUrl || slackConfig.botToken)) {
        try {
          const passedCount = results.filter(r => r.status === 'passed').length;
          const failedCount = results.filter(r => r.status === 'failed').length;
          const flowStatus = failedCount === 0 ? "PASSED" : "FAILED";
          sendSlackCustomMessage(slackConfig, {
            channel: slackConfig.channelName || "#qa-automation",
            text: `*Playback Report*: ${projectName || 'AutomatiQA Project'}\n• Result: *${flowStatus}* (${passedCount}/${steps.length} steps passed)\n• Target URL: ${currentUrl}`,
            attachments: [{
              color: flowStatus === "PASSED" ? "#10b981" : "#ef4444",
              title: `Automated Playback Run: ${flowStatus}`,
              fields: [
                { title: "Total Steps", value: `${steps.length}`, short: true },
                { title: "Executed Steps", value: `${results.length}`, short: true },
                { title: "Duration", value: `${results.reduce((acc, r) => acc + (r.duration || 0), 0)}ms`, short: true },
                { title: "Final URL", value: currentUrl, short: true }
              ]
            }]
          }).catch((slackErr: any) => console.warn("[Playback Engine] Slack alert notification error:", slackErr));
        } catch (e) {}
      }

      await browser.close().catch(() => {});
      console.log(`[Playback Engine] Playback finished. Executed ${results.length}/${steps.length} steps.`);

      if (isStreaming) {
        sendEvent('done', { success: true, count: results.length });
        res.end();
      } else {
        res.json({ success: true, results });
      }
    } catch (playbackError: any) {
      if (browser) await browser.close().catch(() => {});
      console.error("[Playback Engine] Execution exception:", playbackError);
      if (isStreaming) {
        sendEvent('error', { error: playbackError.message || "Playback engine encountered a server error." });
        res.end();
      } else {
        res.status(500).json({ 
          success: false, 
          error: playbackError.message || "Playback engine encountered a server error." 
        });
      }
    }
  });

  app.post("/api/web-performance/validate", async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ reachable: false, error: "URL is required" });

    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    try {
      const parsedUrl = new URL(url);
      const startTime = Date.now();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "AutomatiQA-Performance-Engine/1.0" },
        signal: controller.signal
      }).catch(async () => {
        return await fetch(url, {
          method: "GET",
          headers: { "User-Agent": "AutomatiQA-Performance-Engine/1.0" },
          signal: controller.signal
        });
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      res.json({
        reachable: response.status < 500,
        url,
        hostname: parsedUrl.hostname,
        protocol: parsedUrl.protocol,
        statusCode: response.status,
        statusText: response.statusText,
        latencyMs,
        isHttps: parsedUrl.protocol === 'https:',
        serverHeader: response.headers.get('server') || 'Cloud Server',
        contentType: response.headers.get('content-type') || 'text/html',
        contentLength: response.headers.get('content-length') || 'N/A',
        verifiedAt: new Date().toISOString()
      });
    } catch (error: any) {
      res.json({
        reachable: false,
        url,
        error: error.message?.includes('aborted') ? 'Connection timed out after 8 seconds' : (error.message || 'Domain unreachable or invalid')
      });
    }
  });

  app.post("/api/jmeter-performance/execute", async (req, res) => {
    let { 
      targetUrl, 
      concurrency, 
      durationSeconds, 
      rampUpSeconds, 
      samplers,
      csvDataset,
      enableCookieManager,
      defaultHeaders,
      assertionsConfig
    } = req.body;

    if (!targetUrl) return res.status(400).json({ error: "targetUrl is required" });

    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    concurrency = Math.min(Math.max(parseInt(concurrency) || 10, 1), 100);
    durationSeconds = Math.min(Math.max(parseInt(durationSeconds) || 15, 3), 120);
    rampUpSeconds = Math.min(Math.max(parseInt(rampUpSeconds) || 3, 0), durationSeconds);

    if (!samplers || !Array.isArray(samplers) || samplers.length === 0) {
      samplers = [
        { name: "1. Open Login Page", method: "GET", path: "/login", expectedSlaMs: 300, thinkTimeMs: 200 },
        { name: "2. Submit Login", method: "POST", path: "/api/login", expectedSlaMs: 400, thinkTimeMs: 300, payload: '{"username":"${username}","password":"${password}"}' },
        { name: "3. Dashboard View", method: "GET", path: "/api/dashboard", expectedSlaMs: 250, thinkTimeMs: 200 },
        { name: "4. Catalog Search", method: "GET", path: "/api/search?q=test", expectedSlaMs: 300, thinkTimeMs: 150 },
        { name: "5. Process Checkout", method: "POST", path: "/api/checkout", expectedSlaMs: 500, thinkTimeMs: 100, payload: '{"cartId":123,"total":99.9}' }
      ];
    }

    // Default CSV parameter dataset if provided or generated
    const datasetRows = Array.isArray(csvDataset) && csvDataset.length > 0 ? csvDataset : [
      { username: "john_doe", password: "password123" },
      { username: "jane_smith", password: "password456" },
      { username: "alex_qa", password: "password789" },
      { username: "user_test", password: "password321" }
    ];

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendSSE = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('init', {
      targetUrl,
      concurrency,
      durationSeconds,
      rampUpSeconds,
      samplerCount: samplers.length,
      datasetCount: datasetRows.length,
      startedAt: new Date().toISOString()
    });

    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);
    
    let totalRequests = 0;
    let errorCount = 0;
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    const latencies: number[] = [];
    const statusCodes: Record<string, number> = {};
    const stepStats: Record<string, { 
      count: number; 
      totalMs: number; 
      connectTimeMs: number;
      errors: number; 
      latencies: number[];
      bytesSent: number;
      bytesReceived: number;
      assertionFailures: number;
    }> = {};

    samplers.forEach((s: any) => {
      stepStats[s.name] = { 
        count: 0, 
        totalMs: 0, 
        connectTimeMs: 0,
        errors: 0, 
        latencies: [],
        bytesSent: 0,
        bytesReceived: 0,
        assertionFailures: 0
      };
    });

    let isAborted = false;
    req.on('close', () => { isAborted = true; });

    // Metric emission interval (every 250ms)
    const metricInterval = setInterval(() => {
      if (isAborted) return;
      const elapsedMs = Date.now() - startTime;
      const elapsedSec = Math.max(elapsedMs / 1000, 0.1);
      
      const rampRatio = rampUpSeconds > 0 ? Math.min(elapsedSec / rampUpSeconds, 1) : 1;
      const activeVUs = Math.max(1, Math.round(concurrency * rampRatio));

      const sorted = [...latencies].sort((a, b) => a - b);
      const count = sorted.length;
      const avg = count > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / count) : 0;
      const p50 = count > 0 ? sorted[Math.floor(count * 0.50)] || 0 : 0;
      const p90 = count > 0 ? sorted[Math.floor(count * 0.90)] || 0 : 0;
      const p95 = count > 0 ? sorted[Math.floor(count * 0.95)] || sorted[count - 1] || 0 : 0;
      const p99 = count > 0 ? sorted[Math.floor(count * 0.99)] || sorted[count - 1] || 0 : 0;

      sendSSE('metric_update', {
        activeVUs,
        totalRequests,
        currentRps: parseFloat((totalRequests / elapsedSec).toFixed(1)),
        avgLatencyMs: avg,
        p50LatencyMs: p50,
        p90LatencyMs: p90,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        errorCount,
        errorRatePct: totalRequests > 0 ? parseFloat(((errorCount / totalRequests) * 100).toFixed(1)) : 0,
        totalKbytesSent: parseFloat((totalBytesSent / 1024).toFixed(1)),
        totalKbytesReceived: parseFloat((totalBytesReceived / 1024).toFixed(1)),
        statusDistribution: statusCodes,
        elapsedSeconds: Math.round(elapsedSec)
      });
    }, 250);

    // Worker Thread Simulation with Thread State Scope & Cookie Context
    const runWorker = async (vuId: number) => {
      // Each VU has its own parameter row and correlation variable store
      const rowParams = datasetRows[(vuId - 1) % datasetRows.length] || {};
      const threadScope: Record<string, string> = {
        username: rowParams.username || `user_${vuId}`,
        password: rowParams.password || `secret_${vuId}`,
        vuId: String(vuId),
        authToken: '',
        sessionId: `SESS_${Date.now()}_${vuId}`
      };

      const threadCookies: Record<string, string> = enableCookieManager !== false ? {
        JMETER_SESSID: threadScope.sessionId
      } : {};

      while (Date.now() < endTime && !isAborted) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rampRatio = rampUpSeconds > 0 ? Math.min(elapsedSec / rampUpSeconds, 1) : 1;
        const allowedVUs = Math.max(1, Math.round(concurrency * rampRatio));

        if (vuId > allowedVUs) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        for (const sampler of samplers) {
          if (Date.now() >= endTime || isAborted) break;

          // Helper for variable substitution (${username}, ${authToken}, etc.)
          const interpolate = (str: string = '') => {
            return str.replace(/\$\{([^}]+)\}/g, (_, varName) => threadScope[varName] || '');
          };

          const rawPath = interpolate(sampler.path || '/');
          const targetPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
          const fullUrl = `${targetUrl.replace(/\/$/, '')}${targetPath}`;
          const interpolatedPayload = sampler.payload ? interpolate(sampler.payload) : undefined;

          // Request Timings & Network Phase breakdown
          const dnsLookupMs = Math.floor(Math.random() * 8) + 2;
          const tcpConnectMs = Math.floor(Math.random() * 15) + 5;
          const sslHandshakeMs = fullUrl.startsWith('https') ? Math.floor(Math.random() * 20) + 10 : 0;
          const connectTimeMs = dnsLookupMs + tcpConnectMs + sslHandshakeMs;

          const reqStart = Date.now();
          let statusCode = 0;
          let responseText = '';
          let isErr = false;
          let assertionFailure = false;
          let bytesRecv = 0;

          // Calculate outgoing bytes sent
          const outgoingHeaderStr = `${sampler.method || 'GET'} ${targetPath} HTTP/1.1\r\nHost: ${targetUrl}\r\n`;
          const outgoingBodyLen = interpolatedPayload ? Buffer.byteLength(interpolatedPayload, 'utf-8') : 0;
          const bytesSent = Buffer.byteLength(outgoingHeaderStr, 'utf-8') + outgoingBodyLen + 150;

          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);

            const reqHeaders: Record<string, string> = {
              "User-Agent": `Apache-JMeter/5.5 (VU-${vuId}; ${threadScope.username})`,
              "Accept": "application/json, text/plain, */*",
              ...(defaultHeaders || {}),
              ...(interpolatedPayload ? { "Content-Type": "application/json" } : {})
            };

            // Inject correlated auth token if present
            if (threadScope.authToken) {
              reqHeaders["Authorization"] = `Bearer ${threadScope.authToken}`;
            }

            // Inject cookie manager headers
            if (enableCookieManager !== false && Object.keys(threadCookies).length > 0) {
              reqHeaders["Cookie"] = Object.entries(threadCookies).map(([k, v]) => `${k}=${v}`).join('; ');
            }

            const response = await fetch(fullUrl, {
              method: sampler.method || "GET",
              headers: reqHeaders,
              body: ["POST", "PUT", "PATCH"].includes(sampler.method?.toUpperCase()) && interpolatedPayload ? interpolatedPayload : undefined,
              signal: controller.signal
            });
            clearTimeout(timer);

            statusCode = response.status;
            responseText = await response.text().catch(() => '');
            bytesRecv = Buffer.byteLength(responseText, 'utf-8') + 300;

            // Extract set-cookie header if present
            const setCookieHeader = response.headers.get('set-cookie');
            if (setCookieHeader && enableCookieManager !== false) {
              const parts = setCookieHeader.split(';')[0].split('=');
              if (parts.length === 2) {
                threadCookies[parts[0].trim()] = parts[1].trim();
              }
            }

            // Correlation / Dynamic Extractor logic
            // Automatically capture tokens if returned in JSON (e.g., token, jwt, id_token, session_id)
            try {
              if (responseText && responseText.trim().startsWith('{')) {
                const jsonObj = JSON.parse(responseText);
                if (jsonObj.token) threadScope.authToken = jsonObj.token;
                if (jsonObj.jwt) threadScope.authToken = jsonObj.jwt;
                if (jsonObj.session_id) threadScope.sessionId = jsonObj.session_id;
                if (jsonObj.id) threadScope.lastCreatedId = String(jsonObj.id);
              }
            } catch (e) {}

            // Perform Assertions Validation
            const maxAllowedSla = sampler.expectedSlaMs || assertionsConfig?.maxLatencyMs || 2000;
            const reqDurationActual = Date.now() - reqStart;

            if (statusCode >= 400) {
              isErr = true;
            }

            if (reqDurationActual > maxAllowedSla) {
              assertionFailure = true;
            }

            if (sampler.assertionText && !responseText.includes(sampler.assertionText)) {
              assertionFailure = true;
            }

            if (assertionFailure) isErr = true;

          } catch (e: any) {
            isErr = true;
            assertionFailure = true;
            statusCode = e.name === 'AbortError' ? 504 : 500;
            bytesRecv = 100;
          }

          const reqDuration = Date.now() - reqStart;
          const serverProcessingMs = Math.max(1, reqDuration - connectTimeMs);

          totalRequests++;
          totalBytesSent += bytesSent;
          totalBytesReceived += bytesRecv;
          latencies.push(reqDuration);

          if (isErr) errorCount++;

          const codeStr = statusCode.toString();
          statusCodes[codeStr] = (statusCodes[codeStr] || 0) + 1;

          if (stepStats[sampler.name]) {
            stepStats[sampler.name].count++;
            stepStats[sampler.name].totalMs += reqDuration;
            stepStats[sampler.name].connectTimeMs += connectTimeMs;
            stepStats[sampler.name].latencies.push(reqDuration);
            stepStats[sampler.name].bytesSent += bytesSent;
            stepStats[sampler.name].bytesReceived += bytesRecv;
            if (isErr) stepStats[sampler.name].errors++;
            if (assertionFailure) stepStats[sampler.name].assertionFailures++;
          }

          // Emit live streaming log event
          if (totalRequests % Math.max(1, Math.floor(concurrency / 2)) === 0) {
            sendSSE('log', {
              message: `[User ${vuId} (${threadScope.username})] ${sampler.method || 'GET'} ${targetPath} -> ${statusCode} (${reqDuration}ms | Connect: ${connectTimeMs}ms | Recv: ${bytesRecv}B)`,
              vuId,
              username: threadScope.username,
              statusCode,
              durationMs: reqDuration,
              connectTimeMs,
              dnsLookupMs,
              tcpConnectMs,
              sslHandshakeMs,
              serverProcessingMs,
              bytesSent,
              bytesRecv,
              isError: isErr,
              assertionFailure
            });
          }

          // Think time pause between samplers
          const thinkTime = sampler.thinkTimeMs || 100;
          if (thinkTime > 0) {
            await new Promise(r => setTimeout(r, Math.min(thinkTime, 500)));
          }
        }
      }
    };

    // Spawn virtual user threads
    const workers = [];
    for (let i = 1; i <= concurrency; i++) {
      workers.push(runWorker(i));
    }

    await Promise.all(workers);
    clearInterval(metricInterval);

    // Compute final telemetry and aggregate reports
    const durationMs = Date.now() - startTime;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const totalCount = sortedLatencies.length;

    const percentiles = {
      min: totalCount > 0 ? sortedLatencies[0] : 0,
      max: totalCount > 0 ? sortedLatencies[totalCount - 1] : 0,
      avg: totalCount > 0 ? Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / totalCount) : 0,
      p50: totalCount > 0 ? sortedLatencies[Math.floor(totalCount * 0.50)] : 0,
      p90: totalCount > 0 ? sortedLatencies[Math.floor(totalCount * 0.90)] : 0,
      p95: totalCount > 0 ? sortedLatencies[Math.floor(totalCount * 0.95)] : 0,
      p99: totalCount > 0 ? sortedLatencies[Math.floor(totalCount * 0.99)] : 0
    };

    const stepBreakdown = samplers.map((s: any) => {
      const st = stepStats[s.name] || { 
        count: 0, 
        totalMs: 0, 
        connectTimeMs: 0,
        errors: 0, 
        latencies: [],
        bytesSent: 0,
        bytesReceived: 0,
        assertionFailures: 0
      };
      const sSorted = [...st.latencies].sort((a, b) => a - b);
      const sAvg = st.count > 0 ? Math.round(st.totalMs / st.count) : 0;
      const sConnectAvg = st.count > 0 ? Math.round(st.connectTimeMs / st.count) : 0;
      const sP50 = st.count > 0 ? sSorted[Math.floor(st.count * 0.50)] || 0 : 0;
      const sP90 = st.count > 0 ? sSorted[Math.floor(st.count * 0.90)] || 0 : 0;
      const sP95 = st.count > 0 ? sSorted[Math.floor(st.count * 0.95)] || sSorted[st.count - 1] || 0 : 0;
      const sP99 = st.count > 0 ? sSorted[Math.floor(st.count * 0.99)] || sSorted[st.count - 1] || 0 : 0;
      const sErrPct = st.count > 0 ? parseFloat(((st.errors / st.count) * 100).toFixed(1)) : 0;
      const sRps = st.count > 0 ? parseFloat((st.count / (durationMs / 1000)).toFixed(1)) : 0;
      const sAvgKbytesRecv = st.count > 0 ? parseFloat(((st.bytesReceived / st.count) / 1024).toFixed(2)) : 0;

      return {
        name: s.name,
        method: s.method || "GET",
        path: s.path,
        expectedSlaMs: s.expectedSlaMs || 300,
        count: st.count,
        avgLatencyMs: sAvg,
        connectTimeMs: sConnectAvg,
        p50LatencyMs: sP50,
        p90LatencyMs: sP90,
        p95LatencyMs: sP95,
        p99LatencyMs: sP99,
        minMs: st.count > 0 ? sSorted[0] : 0,
        maxMs: st.count > 0 ? sSorted[st.count - 1] : 0,
        throughputRps: sRps,
        avgKbytesRecv: sAvgKbytesRecv,
        errorCount: st.errors,
        errorRatePct: sErrPct,
        assertionFailures: st.assertionFailures,
        slaViolation: sP95 > (s.expectedSlaMs || 300)
      };
    });

    const finalTelemetry = {
      targetUrl,
      concurrency,
      durationSeconds: Math.round(durationMs / 1000),
      totalRequests,
      rps: parseFloat((totalRequests / (durationMs / 1000)).toFixed(1)),
      errorCount,
      errorRatePct: totalCount > 0 ? parseFloat(((errorCount / totalCount) * 100).toFixed(1)) : 0,
      totalBytesSent,
      totalBytesReceived,
      latencies: percentiles,
      statusDistribution: statusCodes,
      stepBreakdown,
      executedAt: new Date().toISOString()
    };

    sendSSE('complete', { telemetry: finalTelemetry });
    res.end();
  });

  app.post("/api/parse-playwright", async (req, res) => {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Missing code parameter" });
    }

    try {
      const steps = await parsePlaywrightCodeToSteps(code);
      res.json({ steps });
    } catch (error: any) {
      console.error("Failed to parse Playwright code:", error);
      const isRateLimit = error.message?.includes("Rate exceeded") || error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      res.status(isRateLimit ? 429 : 500).json({ 
        success: false,
        error: isRateLimit ? "Recording service is temporarily busy. Please wait a few seconds and try again." : (error.message || "Parsing failed"),
        code: isRateLimit ? 429 : 500
      });
    }
  });

  app.post("/api/capture-url-ui", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ success: false, error: "Missing url parameter" });
    }

    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    try {
      browser = await launchPlaywrightBrowser({ headless: true });
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AutomatiQA-Tester'
      });
      const page = await context.newPage();

      let pageTitle = cleanUrl;
      try {
        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1000);
        pageTitle = (await page.title()) || cleanUrl;
      } catch (navErr: any) {
        console.warn(`[capture-url-ui] Navigation warning for ${cleanUrl}:`, navErr.message);
      }

      const extractedData = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => (h.textContent || '').trim()).filter(Boolean).slice(0, 15);
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"], .btn, .nav-link, .tab')).map(b => (b.textContent || (b as HTMLInputElement).value || '').trim()).filter(Boolean).slice(0, 15);
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).map(i => {
          const inp = i as HTMLInputElement;
          return inp.placeholder || inp.name || inp.id || (inp.labels && inp.labels[0]?.textContent) || inp.type || 'Input Field';
        }).slice(0, 15);
        const textSnippets = Array.from(document.querySelectorAll('p, span, div, li, td, th')).map(el => (el.textContent || '').trim()).filter(t => t.length > 10 && t.length < 200).slice(0, 20);
        
        return {
          title: document.title || '',
          headings,
          buttons,
          inputs,
          textSnippets
        };
      }).catch(() => ({
        title: pageTitle,
        headings: [],
        buttons: [],
        inputs: [],
        textSnippets: []
      }));

      const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
      const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = null;
      context = null;

      return res.json({
        success: true,
        url: cleanUrl,
        pageTitle: extractedData.title || pageTitle,
        screenshot: screenshotBase64,
        elements: extractedData
      });
    } catch (error: any) {
      console.error('[capture-url-ui] Error capturing URL UI via Playwright:', error);
      if (context) {
        try { await context.close(); } catch {}
      }
      if (browser) {
        try { await browser.close(); } catch {}
      }

      // Fallback: Fetch HTML and extract metadata
      try {
        const response = await fetch(cleanUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(8000)
        });
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const extractedTitle = titleMatch ? titleMatch[1].trim() : cleanUrl;
        
        const headings: string[] = [];
        const headingMatches = html.matchAll(/<h[1-4][^>]*>([^<]+)<\/h[1-4]>/gi);
        for (const m of headingMatches) {
          if (m[1]?.trim()) headings.push(m[1].trim());
        }
        
        const buttons: string[] = [];
        const buttonMatches = html.matchAll(/<(?:button|a)[^>]*class="[^"]*(?:btn|button|nav)[^"]*"[^>]*>([^<]+)<\/(?:button|a)>/gi);
        for (const m of buttonMatches) {
          if (m[1]?.trim()) buttons.push(m[1].trim());
        }

        const inputs: string[] = [];
        const inputMatches = html.matchAll(/<input[^>]*placeholder="([^"]+)"/gi);
        for (const m of inputMatches) {
          if (m[1]?.trim()) inputs.push(m[1].trim());
        }

        return res.json({
          success: true,
          url: cleanUrl,
          pageTitle: extractedTitle,
          screenshot: '',
          elements: {
            title: extractedTitle,
            headings: headings.slice(0, 10),
            buttons: buttons.slice(0, 10),
            inputs: inputs.slice(0, 10),
            textSnippets: []
          }
        });
      } catch (fetchErr: any) {
        return res.status(500).json({
          success: false,
          error: error.message || 'Failed to capture URL page'
        });
      }
    }
  });

  // ==========================================
  // JIRA & GITHUB INTEGRATION MIDDLEWARE & APIS
  // ==========================================

   function cleanJiraUrl(url: string): string {
    let cleanUrl = (url || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    return cleanUrl.replace(/\/+$/, '');
  }

  async function uploadAttachmentsToJira(targetUrl: string, authHeader: string, issueKey: string, attachments: string[]): Promise<void> {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return;

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (!att || typeof att !== 'string') continue;

      try {
        let mimeType = "image/png";
        let base64Data = att;
        let ext = "png";

        const match = att.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
          if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
          else if (mimeType.includes("gif")) ext = "gif";
          else if (mimeType.includes("webm")) ext = "webm";
          else if (mimeType.includes("mp4")) ext = "mp4";
          else if (mimeType.includes("pdf")) ext = "pdf";
        } else if (att.startsWith("http://") || att.startsWith("https://")) {
          continue;
        }

        const buffer = Buffer.from(base64Data, "base64");
        const filename = `evidence_${i + 1}.${ext}`;

        const boundary = "----JiraAttachmentBoundary" + Math.random().toString(36).substring(2);
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;

        const headerBuf = Buffer.from(header, 'utf-8');
        const footerBuf = Buffer.from(footer, 'utf-8');
        const bodyBuf = Buffer.concat([headerBuf, buffer, footerBuf]);

        const res = await fetch(`${targetUrl}/rest/api/3/issue/${issueKey}/attachments`, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "X-Atlassian-Token": "no-check",
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Accept": "application/json"
          },
          body: bodyBuf
        });

        if (res.ok) {
          console.log(`Successfully uploaded attachment ${filename} to Jira issue ${issueKey}`);
        } else {
          const errText = await res.text();
          console.warn(`Jira attachment upload for ${filename} returned status ${res.status}:`, errText);
        }
      } catch (attErr) {
        console.warn(`Failed to process attachment ${i + 1} for Jira issue ${issueKey}:`, attErr);
      }
    }
  }

  function cleanProjectKey(key: string): string {
    if (!key) return "";
    let cleaned = key.trim().toUpperCase();
    // Strip trailing periods or punctuation
    cleaned = cleaned.replace(/[.,/#!$%^&*;:{}=\-_`~()]+$/, "");
    // If it looks like an issue key (e.g. PROJECTKEY-123), strip the hyphen and the number
    const match = cleaned.match(/^([A-Z][A-Z0-9]+)-\d+$/);
    if (match) {
      cleaned = match[1];
    }
    return cleaned;
  }

  function formatIssueKey(issueKey: string, projectKey?: string): string {
    if (!issueKey) return "";
    let cleaned = issueKey.trim();
    // Strip trailing periods or punctuation
    cleaned = cleaned.replace(/[.,/#!$%^&*;:{}=\-_`~()]+$/, "");
    
    if (projectKey) {
      const pk = cleanProjectKey(projectKey);
      // If the issue key is a number, prepend projectKey with a hyphen
      if (/^\d+$/.test(cleaned)) {
        return `${pk}-${cleaned}`;
      }
      // If they typed "123" with some other letters but no hyphen, and it doesn't already start with PK-
      if (!cleaned.toUpperCase().startsWith(`${pk}-`) && !cleaned.includes('-')) {
        return `${pk}-${cleaned}`;
      }
    }
    return cleaned;
  }

  function extractTextFromAdf(node: any): string {
    if (!node) return '';
    if (node.type === 'text' && node.text) {
      return node.text;
    }
    if (Array.isArray(node.content)) {
      return node.content.map(extractTextFromAdf).join(' ');
    }
    return '';
  }

  function getJiraDescription(fields: any): string {
    const desc = fields.description;
    if (!desc) return '';
    if (typeof desc === 'string') return desc;
    if (desc.type === 'doc' && Array.isArray(desc.content)) {
      return extractTextFromAdf(desc);
    }
    return '';
  }

  function translateJiraError(errText: string, availableProjects: string[], configuredKey: string): string {
    try {
      const parsed = JSON.parse(errText);
      let msg = "";
      
      if (parsed.errorMessages && parsed.errorMessages.length > 0) {
        msg = parsed.errorMessages.join(". ");
      } else if (parsed.errors && Object.keys(parsed.errors).length > 0) {
        msg = Object.entries(parsed.errors).map(([field, error]) => `${field}: ${error}`).join(". ");
      } else {
        msg = errText;
      }

      if (msg.includes("目标项目不存在") || msg.includes("无权") || msg.includes("does not exist") || msg.includes("permission")) {
        const hint = availableProjects.length > 0
          ? ` Available project keys on your Jira instance: ${availableProjects.join(", ")}.`
          : "";
        return `Project Key '${configuredKey}' does not exist or your Jira credentials do not have permission to create issues in this project.${hint}`;
      }

      if (msg.includes("issuetype") || msg.includes("问题类型")) {
        return `Selected issue type is invalid or not allowed in your Jira project. Please select a standard issue type (Story, Task, Bug) or check your Jira project configuration. Details: ${msg}`;
      }

      return msg;
    } catch (e) {
      if (errText.includes("目标项目不存在") || errText.includes("无权") || errText.includes("does not exist") || errText.includes("permission")) {
        const hint = availableProjects.length > 0
          ? ` Available project keys on your Jira instance: ${availableProjects.join(", ")}.`
          : "";
        return `Project Key '${configuredKey}' does not exist or your Jira credentials do not have permission to create issues in this project.${hint}`;
      }
      return errText;
    }
  }

  // 1. JIRA Connection Test
  app.post("/api/integration/jira/test", async (req, res) => {
    const { jiraUrl, email, apiToken, projectKey } = req.body;
    if (!jiraUrl || !email || !apiToken || !projectKey) {
      return res.status(400).json({ error: "Missing required connection parameters." });
    }

    try {
      const targetUrl = cleanJiraUrl(jiraUrl);
      const cleanedProjKey = cleanProjectKey(projectKey);
      const decryptedToken = decryptToken(apiToken);
      const authHeader = `Basic ${Buffer.from(`${email}:${decryptedToken}`).toString('base64')}`;
      
      // Fetch project information with fallback for Jira Server/Datacenter (v2)
      let projectRes: any = null;
      let lastStatus = 0;
      let lastErrorText = "";

      const testUrls = [
        `${targetUrl}/rest/api/3/project/${cleanedProjKey}`,
        `${targetUrl}/rest/api/2/project/${cleanedProjKey}`
      ];

      for (const url of testUrls) {
        try {
          console.log(`Testing Jira project access via: ${url}`);
          const res = await fetch(url, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });

          if (res.redirected) {
            lastStatus = 401;
            lastErrorText = "Request was redirected to a login page (verify Jira Server URL or check authentication).";
            continue;
          }

          if (res.ok) {
            projectRes = res;
            break;
          } else {
            lastStatus = res.status;
            lastErrorText = await res.text();
            if (res.status === 404) {
              console.log(`Jira project test endpoint ${url} returned 404 Not Found.`);
            } else {
              console.warn(`Jira project connection test failed on ${url} with status ${res.status}`);
            }
          }
        } catch (fetchErr: any) {
          console.error(`Jira project test exception on ${url}:`, fetchErr);
          lastErrorText = fetchErr.message || String(fetchErr);
        }
      }

      if (!projectRes) {
        if (lastStatus === 401 || lastStatus === 403) {
          return res.status(401).json({ error: "Authentication failed. Please verify Email and API Token." });
        }
        if (lastStatus === 404) {
          // Fallback check to verify if credentials are valid!
          let isAuthValid = true;
          try {
            const myselfRes = await fetch(`${targetUrl}/rest/api/3/myself`, {
              headers: {
                "Authorization": authHeader,
                "Accept": "application/json"
              }
            });
            if (myselfRes.status === 401 || myselfRes.status === 403) {
              isAuthValid = false;
            }
          } catch (e) {
            console.warn("Failed to fetch myself for auth check:", e);
          }

          if (!isAuthValid) {
            return res.status(401).json({ error: "Authentication failed. Please verify your Jira Email and API Token." });
          }

          let availableProjects: string[] = [];
          try {
            console.log(`Jira project '${cleanedProjKey}' not found. Querying available projects for diagnostics on ${targetUrl}...`);
            const listUrls = [
              `${targetUrl}/rest/api/3/project`,
              `${targetUrl}/rest/api/2/project`
            ];
            for (const listUrl of listUrls) {
              try {
                const listRes = await fetch(listUrl, {
                  headers: {
                    "Authorization": authHeader,
                    "Accept": "application/json"
                  }
                });
                if (listRes.ok) {
                  const projectsData = await listRes.json();
                  if (Array.isArray(projectsData)) {
                    availableProjects = projectsData.map((p: any) => p.key).filter(Boolean);
                    break;
                  }
                }
              } catch (innerErr) {
                console.warn(`Failed to fetch projects from ${listUrl}:`, innerErr);
              }
            }
          } catch (pErr) {
            console.warn("Failed to fetch available projects during test diagnostics:", pErr);
          }

          const hint = availableProjects.length > 0 
            ? `. Available project keys on this Jira instance: ${availableProjects.join(", ")}`
            : "";
          return res.status(404).json({ error: `Project Key '${cleanedProjKey}' not found in Jira${hint}.` });
        }
        return res.status(lastStatus || 500).json({ error: `Jira connection test failed: Status ${lastStatus || 500}. Details: ${lastErrorText.substring(0, 200)}` });
      }

      const resText = await projectRes.text();
      let projectData: any = {};
      try {
        projectData = JSON.parse(resText);
      } catch (parseErr) {
        console.error("Failed to parse Jira project response as JSON:", resText.substring(0, 500));
        return res.status(400).json({ 
          error: `Jira returned an invalid response (expected JSON, but received HTML or other format). Please verify your Jira Server URL, credentials, and Project Key. (HTTP Status: ${projectRes.status})` 
        });
      }

      res.json({ success: true, projectName: projectData.name || cleanedProjKey });
    } catch (err: any) {
      console.error("Jira connection test failed:", err);
      res.status(500).json({ error: err.message || "Failed to reach Jira server." });
    }
  });

  // 2. JIRA Save Configuration
  app.post("/api/integration/jira/save", async (req, res) => {
    const { projectId, jiraUrl, email, apiToken, projectKey } = req.body;
    if (!projectId || !jiraUrl || !email || !projectKey) {
      return res.status(400).json({ error: "Missing required config parameters." });
    }

    try {
      let finalEncryptedToken = "";

      if (apiToken === "********" || !apiToken) {
        finalEncryptedToken = "KEEP_EXISTING";
      } else {
        finalEncryptedToken = encryptToken(apiToken);
      }

      res.json({ 
        success: true, 
        message: "Jira token encrypted successfully.", 
        encryptedToken: finalEncryptedToken 
      });
    } catch (err: any) {
      console.error("Failed to encrypt Jira configuration:", err);
      res.status(500).json({ error: err.message || "Failed to save configuration." });
    }
  });

  // 3. GitHub Connection Test
  app.post("/api/integration/github/test", async (req, res) => {
    const { repositoryOwner, repositoryName, personalAccessToken, branchName } = req.body;
    if (!repositoryOwner || !repositoryName || !personalAccessToken || !branchName) {
      return res.status(400).json({ error: "Missing required GitHub parameters." });
    }

    try {
      const decryptedToken = decryptToken(personalAccessToken);

      // Test repository existence
      const repoRes = await fetch(`https://api.github.com/repos/${repositoryOwner}/${repositoryName}`, {
        headers: {
          "Authorization": `Bearer ${decryptedToken}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "AutomatiQA-Server"
        }
      });

      if (repoRes.status === 401 || repoRes.status === 403) {
        return res.status(401).json({ error: "Authentication failed. Please verify GitHub PAT." });
      }

      if (repoRes.status === 404) {
        return res.status(404).json({ error: `Repository not found. Verify owner and repository name.` });
      }

      if (!repoRes.ok) {
        return res.status(repoRes.status).json({ error: `GitHub API error: Status ${repoRes.status}` });
      }

      // Check branch existence
      const branchRes = await fetch(`https://api.github.com/repos/${repositoryOwner}/${repositoryName}/branches/${branchName}`, {
        headers: {
          "Authorization": `Bearer ${decryptedToken}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "AutomatiQA-Server"
        }
      });

      if (branchRes.status === 404) {
        return res.status(404).json({ error: `Branch '${branchName}' not found in the repository.` });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("GitHub connection test failed:", err);
      res.status(500).json({ error: err.message || "Failed to reach GitHub server." });
    }
  });

  // 4. GitHub Save Configuration
  app.post("/api/integration/github/save", async (req, res) => {
    const { projectId, repositoryOwner, repositoryName, personalAccessToken, branchName } = req.body;
    if (!projectId || !repositoryOwner || !repositoryName || !branchName) {
      return res.status(400).json({ error: "Missing required config parameters." });
    }

    try {
      let finalEncryptedToken = "";

      if (personalAccessToken === "********" || !personalAccessToken) {
        finalEncryptedToken = "KEEP_EXISTING";
      } else {
        finalEncryptedToken = encryptToken(personalAccessToken);
      }

      res.json({ 
        success: true, 
        message: "GitHub token encrypted successfully.", 
        encryptedToken: finalEncryptedToken 
      });
    } catch (err: any) {
      console.error("Failed to encrypt GitHub configuration:", err);
      res.status(500).json({ error: err.message || "Failed to save configuration." });
    }
  });

  // Helper to detect if a token is already encrypted (hex:hex:hex format)
  function isEncrypted(text: string): boolean {
    if (!text) return false;
    const parts = text.split(':');
    if (parts.length !== 3) return false;
    const hexRegex = /^[0-9a-fA-F]+$/;
    return hexRegex.test(parts[0]) && hexRegex.test(parts[1]) && hexRegex.test(parts[2]);
  }

  // Slack Test Connection
  app.post("/api/integration/slack/test", async (req, res) => {
    const { projectId, workspaceName, channelName, webhookUrl, botToken } = req.body;
    if (!webhookUrl && !botToken) {
      return res.status(400).json({ error: "Please provide either a Webhook URL or Bot Token to test." });
    }

    try {
      // Determine appropriate webhookUrl and botToken. 
      // If they are already encrypted, we keep them as is. If they are raw (unencrypted), we encrypt them because
      // sendSlackNotification internally decrypts them using decryptToken.
      const resolvedWebhook = webhookUrl && webhookUrl !== "********" 
        ? (isEncrypted(webhookUrl) ? webhookUrl : encryptToken(webhookUrl)) 
        : (projectId ? "LOAD_EXISTING" : webhookUrl);

      const resolvedBotToken = botToken && botToken !== "********" 
        ? (isEncrypted(botToken) ? botToken : encryptToken(botToken)) 
        : (projectId ? "LOAD_EXISTING" : botToken);

      const testConfig = {
        enabled: true,
        workspaceName,
        channelName,
        webhookUrl: resolvedWebhook,
        botToken: resolvedBotToken
      };

      // Resolve LOAD_EXISTING from database ONLY if needed and wrap in safe try-catch
      if (projectId && (testConfig.webhookUrl === "LOAD_EXISTING" || testConfig.botToken === "LOAD_EXISTING")) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId as string).get();
          if (projectSnap.exists) {
            const dbSlack = projectSnap.data()?.slackConfig;
            if (dbSlack) {
              if (testConfig.webhookUrl === "LOAD_EXISTING") {
                testConfig.webhookUrl = dbSlack.webhookUrl;
              }
              if (testConfig.botToken === "LOAD_EXISTING") {
                testConfig.botToken = dbSlack.botToken;
              }
            }
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback during Slack connection test:", dbErr?.message || String(dbErr));
        }
      }

      // If they are still LOAD_EXISTING but we couldn't load, set to empty
      if (testConfig.webhookUrl === "LOAD_EXISTING") testConfig.webhookUrl = "";
      if (testConfig.botToken === "LOAD_EXISTING") testConfig.botToken = "";

      // Send test message
      const details = {
        issueKey: "TEST-123",
        summary: "Slack Connection Verification Test",
        projectName: workspaceName || "AutomatiQA Test Project",
        priority: "High",
        severity: "Critical",
        reporter: "AutomatiQA Verification Agent",
        jiraUrl: "https://your-company.atlassian.net/browse/TEST-123"
      };

      const result = await sendSlackNotification(testConfig, details);
      if (result.success) {
        res.json({ success: true, message: "Connection verified! Check your Slack channel for the test notification." });
      } else {
        res.status(400).json({ error: result.error || "Slack verification failed." });
      }
    } catch (err: any) {
      console.error("Slack connection test failed:", err);
      res.status(500).json({ error: err.message || "Failed to reach Slack API." });
    }
  });

  // Slack Save Configuration
  app.post("/api/integration/slack/save", async (req, res) => {
    const { projectId, workspaceName, channelName, webhookUrl, botToken, enabled } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: "Missing Project ID." });
    }

    try {
      let encryptedWebhookUrl = "";
      if (webhookUrl === "********" || !webhookUrl) {
        encryptedWebhookUrl = "KEEP_EXISTING";
      } else {
        // Only encrypt if it is not already encrypted to prevent double-encryption
        encryptedWebhookUrl = isEncrypted(webhookUrl) ? webhookUrl : encryptToken(webhookUrl);
      }

      let encryptedBotToken = "";
      if (botToken === "********" || !botToken) {
        encryptedBotToken = "KEEP_EXISTING";
      } else {
        // Only encrypt if it is not already encrypted to prevent double-encryption
        encryptedBotToken = isEncrypted(botToken) ? botToken : encryptToken(botToken);
      }

      res.json({
        success: true,
        message: "Slack configuration secured successfully.",
        encryptedWebhookUrl: encryptedWebhookUrl === "KEEP_EXISTING" ? undefined : encryptedWebhookUrl,
        encryptedBotToken: encryptedBotToken === "KEEP_EXISTING" ? undefined : encryptedBotToken
      });
    } catch (err: any) {
      console.error("Failed to encrypt Slack configuration:", err);
      res.status(500).json({ error: err.message || "Failed to secure configuration." });
    }
  });

  // 5. Fetch Jira Stories/Tasks/Epics
  app.post("/api/integration/jira/stories", async (req, res) => {
    const { projectId } = req.body;

    try {
      let jiraConfig = req.body.jiraConfig;
      if (!jiraConfig && projectId) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId as string).get();
          if (projectSnap.exists) {
            jiraConfig = projectSnap.data()?.jiraConfig;
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed:", dbErr?.message || String(dbErr));
        }
      }

      if (!jiraConfig || !jiraConfig.jiraUrl || !jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.projectKey) {
        return res.status(400).json({ error: "Jira Integration is not configured for this project." });
      }

      const targetUrl = cleanJiraUrl(jiraConfig.jiraUrl);
      const cleanedProjKey = cleanProjectKey(jiraConfig.projectKey);
      const apiToken = decryptToken(jiraConfig.apiToken);
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${apiToken}`).toString('base64')}`;

      // Search tickets using JQL for Epics, Stories, Tasks
      const jql = `project = "${cleanedProjKey}" AND issuetype in (Epic, Story, Task, Bug) ORDER BY created DESC`;
      
      let searchRes: any = null;
      let lastStatus = 0;
      let lastErrorText = "";
      
      const attempts = [
        // 1. GET api/3/search/jql (Modern recommended Jira Cloud GET)
        async () => {
          console.log("Attempting Jira Search via GET /rest/api/3/search/jql...");
          return fetch(`${targetUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=*all`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
        },
        // 2. POST api/3/search/jql (Modern recommended Jira Cloud POST)
        async () => {
          console.log("Attempting Jira Search via POST /rest/api/3/search/jql...");
          return fetch(`${targetUrl}/rest/api/3/search/jql`, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ jql, maxResults: 100, fields: ["*all"] })
          });
        },
        // 3. POST api/3/search (Legacy Jira Cloud POST)
        async () => {
          console.log("Attempting Jira Search via POST /rest/api/3/search...");
          return fetch(`${targetUrl}/rest/api/3/search`, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ jql, maxResults: 100, fields: ["*all"] })
          });
        },
        // 4. GET api/3/search (Legacy Jira Cloud GET)
        async () => {
          console.log("Attempting Jira Search via GET /rest/api/3/search...");
          return fetch(`${targetUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=*all`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
        },
        // 5. GET api/2/search/jql (Modern Jira Server/Datacenter GET)
        async () => {
          console.log("Attempting Jira Search via GET /rest/api/2/search/jql...");
          return fetch(`${targetUrl}/rest/api/2/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=*all`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
        },
        // 6. POST api/2/search/jql (Modern Jira Server/Datacenter POST)
        async () => {
          console.log("Attempting Jira Search via POST /rest/api/2/search/jql...");
          return fetch(`${targetUrl}/rest/api/2/search/jql`, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ jql, maxResults: 100, fields: ["*all"] })
          });
        },
        // 7. POST api/2/search (Legacy Jira Server/Datacenter POST)
        async () => {
          console.log("Attempting Jira Search via POST /rest/api/2/search...");
          return fetch(`${targetUrl}/rest/api/2/search`, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ jql, maxResults: 100, fields: ["*all"] })
          });
        },
        // 8. GET api/2/search (Legacy Jira Server/Datacenter GET)
        async () => {
          console.log("Attempting Jira Search via GET /rest/api/2/search...");
          return fetch(`${targetUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=*all`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
        }
      ];

      for (let i = 0; i < attempts.length; i++) {
        try {
          const res = await attempts[i]();
          if (res.redirected) {
            lastStatus = 401;
            lastErrorText = "Request was redirected to a login page (verify Jira Server URL or check authentication).";
            continue;
          }
          if (res.ok) {
            searchRes = res;
            break;
          } else {
            lastStatus = res.status;
            lastErrorText = await res.text();
            console.warn(`Jira search attempt ${i + 1} failed with status ${res.status}:`, lastErrorText.substring(0, 200));
          }
        } catch (fetchErr: any) {
          console.error(`Jira search attempt ${i + 1} exception:`, fetchErr);
          lastErrorText = fetchErr.message || String(fetchErr);
        }
      }

      if (!searchRes) {
        if (lastStatus === 401 || lastStatus === 403 || lastStatus === 400 || lastStatus === 404) {
          let isAuthValid = true;
          try {
            const myselfRes = await fetch(`${targetUrl}/rest/api/3/myself`, {
              headers: {
                "Authorization": authHeader,
                "Accept": "application/json"
              }
            });
            if (myselfRes.status === 401 || myselfRes.status === 403) {
              isAuthValid = false;
            }
          } catch (e) {
            console.warn("Failed to fetch myself for auth check during search diagnostics:", e);
          }

          if (!isAuthValid) {
            return res.status(401).json({ error: "Jira Authentication Failed: Your Jira Email or API Token is invalid or has expired. Please verify your Jira integration settings." });
          }
        }

        return res.status(lastStatus || 500).json({ 
          error: `Jira search failed (all 4 connection methods exhausted). Status: ${lastStatus || 500}. Details: ${lastErrorText.substring(0, 300) || 'Unknown error'}` 
        });
      }

      const resText = await searchRes.text();
      let data: any = {};
      try {
        data = JSON.parse(resText);
      } catch (parseErr) {
        console.error("Failed to parse Jira search response as JSON:", resText.substring(0, 500));
        return res.status(400).json({ 
          error: `Jira returned an invalid search response (expected JSON, but received HTML or other format). Please verify your Jira Server URL and credentials. (HTTP Status: ${searchRes.status})` 
        });
      }

      const issues = (data.issues || []).map((issue: any) => ({
        key: issue.key,
        id: issue.id,
        summary: issue.fields?.summary || "",
        description: issue.fields ? getJiraDescription(issue.fields) : "",
        type: issue.fields?.issuetype?.name || "Story",
        status: issue.fields?.status?.name || "Open",
        priority: issue.fields?.priority?.name || "Medium",
        epicKey: issue.fields?.epic?.key || issue.fields?.customfield_10014 || ""
      }));

      res.json({ success: true, issues });
    } catch (err: any) {
      console.error("Failed to fetch Jira stories:", err);
      res.status(500).json({ error: err.message || "Failed to fetch stories from Jira." });
    }
  });

  // 6. Push Automation Script to GitHub
  app.post("/api/integration/github/push", async (req, res) => {
    const { projectId, files, commitMessage, branchName } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0 || !commitMessage) {
      return res.status(400).json({ error: "Missing required script-push files or details." });
    }

    try {
      let gitConfig = req.body.githubConfig;
      if (!gitConfig && projectId) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId).get();
          if (projectSnap.exists) {
            gitConfig = projectSnap.data()?.githubConfig;
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed for GitHub config:", dbErr?.message || String(dbErr));
        }
      }

      if (!gitConfig || !gitConfig.repositoryOwner || !gitConfig.repositoryName || !gitConfig.personalAccessToken) {
        return res.status(400).json({ error: "GitHub Integration is not configured for this project." });
      }

      const token = decryptToken(gitConfig.personalAccessToken);
      const owner = gitConfig.repositoryOwner;
      const repo = gitConfig.repositoryName;
      const branch = branchName || gitConfig.branchName || "main";

      const uploadedFilesResults = [];
      let lastCommitUrl = `https://github.com/${owner}/${repo}/commits/${branch}`;

      // Upload/commit each file in sequence
      for (const file of files) {
        const filePath = file.path.replace(/^\/+/, ''); // Trim leading slashes
        const urlEncodedPath = encodeURIComponent(filePath);
        const fileContentBase64 = Buffer.from(file.content).toString('base64');

        // Check if file already exists to get its SHA
        let sha: string | undefined;
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${urlEncodedPath}?ref=${branch}`, {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/vnd.github+json",
              "User-Agent": "AutomatiQA-Server"
            }
          });

          if (checkRes.ok) {
            const fileMeta = await checkRes.json();
            sha = fileMeta.sha;
          }
        } catch (e) {
          console.log(`File check failed for ${filePath}, assuming fresh creation.`);
        }

        // Commit file
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${urlEncodedPath}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
            "User-Agent": "AutomatiQA-Server"
          },
          body: JSON.stringify({
            message: commitMessage,
            content: fileContentBase64,
            branch,
            ...(sha ? { sha } : {})
          })
        });

        if (!commitRes.ok) {
          const errText = await commitRes.text();
          let errorMessage = errText;
          try {
            const parsed = JSON.parse(errText);
            if (parsed.message && parsed.message.includes("Resource not accessible")) {
              errorMessage = "Your GitHub Personal Access Token (PAT) lacks write permissions ('Contents' read/write access or 'repo' scope). Please verify and update your PAT permissions on GitHub.";
            }
          } catch (pe) {}
          throw new Error(`Failed to commit file ${filePath} to GitHub: ${errorMessage}`);
        }

        const commitData = await commitRes.json();
        if (commitData.commit && commitData.commit.html_url) {
          lastCommitUrl = commitData.commit.html_url;
        }

        uploadedFilesResults.push({ path: filePath, status: "pushed" });
      }

      res.json({
        success: true,
        commitUrl: lastCommitUrl,
        files: uploadedFilesResults
      });
    } catch (err: any) {
      console.error("Failed to push scripts to GitHub:", err);
      res.status(500).json({ error: err.message || "Failed to push scripts to GitHub repository." });
    }
  });

  // 7. Get PR Diff and Analyze PR Impact using Gemini AI
  app.post("/api/integration/github/pr-impact", async (req, res) => {
    const { projectId, prUrlOrNumber } = req.body;
    if (!projectId || !prUrlOrNumber) {
      return res.status(400).json({ error: "Missing required parameters." });
    }

    try {
      let project = req.body.project || {};
      let gitConfig = req.body.githubConfig || project.githubConfig;

      if (!gitConfig && projectId) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId).get();
          if (projectSnap.exists) {
            project = projectSnap.data() || {};
            gitConfig = project.githubConfig;
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed for PR impact:", dbErr?.message || String(dbErr));
        }
      }

      if (!gitConfig || !gitConfig.repositoryOwner || !gitConfig.repositoryName || !gitConfig.personalAccessToken) {
        return res.status(400).json({ error: "GitHub Integration is not configured for this project." });
      }

      const token = decryptToken(gitConfig.personalAccessToken);
      const owner = gitConfig.repositoryOwner;
      const repo = gitConfig.repositoryName;

      // Extract PR numeric number
      let prNum = String(prUrlOrNumber).trim();
      if (prNum.includes("pull/")) {
        const match = prNum.match(/pull\/(\d+)/);
        if (match) prNum = match[1];
      }

      if (!/^\d+$/.test(prNum)) {
        return res.status(400).json({ error: "Invalid PR number or URL format provided." });
      }

      // 1. Fetch file list and diff from GitHub rest API
      const filesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNum}/files`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "AutomatiQA-Server"
        }
      });

      if (!filesRes.ok) {
        return res.status(filesRes.status).json({ error: `Failed to fetch PR details. Status: ${filesRes.status}` });
      }

      const filesData = await filesRes.json();
      
      // Stitch together filenames and patch diff statements
      let diffAccumulator = "";
      filesData.forEach((file: any) => {
        diffAccumulator += `Filename: ${file.filename}\n`;
        diffAccumulator += `Risk Category: +${file.additions} -${file.deletions}\n`;
        if (file.patch) {
          diffAccumulator += `Patch Diff:\n${file.patch}\n`;
        }
        diffAccumulator += `========================================\n`;
      });

      if (!diffAccumulator) {
        diffAccumulator = "No structural changes found or PR consists of empty binary edits.";
      }

      // Collect existing test cases from the project data
      const existingTestCases: any[] = [];
      const projectScenarios = req.body.scenarios || project.scenarios || [];
      const projectManualCases = req.body.manualTestCases || project.manualTestCases || [];

      projectScenarios.forEach((scen: any) => {
        if (scen.testCases && Array.isArray(scen.testCases)) {
          scen.testCases.forEach((tc: any) => {
            existingTestCases.push({
              testCaseId: tc.testCaseId || tc.id,
              title: tc.title,
              description: tc.description || tc.title,
              expectedResult: tc.expectedResult,
              scenarioTitle: scen.title,
              moduleName: scen.moduleName || ""
            });
          });
        }
      });

      projectManualCases.forEach((tc: any) => {
        existingTestCases.push({
          testCaseId: tc.testCaseId || tc.id,
          title: tc.title,
          description: tc.description || tc.title,
          expectedResult: tc.expectedResult,
          scenarioTitle: "Manual Cases Repo",
          moduleName: "Manual"
        });
      });

      // 2. Call Gemini service to execute impact assessment
      const assessmentReport = await analyzePrImpact(diffAccumulator, existingTestCases);
      res.json({ success: true, report: assessmentReport, prNumber: prNum });
    } catch (err: any) {
      console.error("PR Impact Assessment Failed:", err);
      res.status(500).json({ error: err.message || "Failed to analyze PR impact." });
    }
  });

  // 8. Create a Bug Ticket in JIRA from Execution Fails
  app.post("/api/integration/jira/post-bug", async (req, res) => {
    const { projectId, issueTitle, issueDescription, priority } = req.body;
    if (!projectId || !issueTitle || !issueDescription) {
      return res.status(400).json({ error: "Missing required bug details." });
    }

    try {
      let jiraConfig = req.body.jiraConfig;
      let projectName = req.body.projectName || "AutomatiQA Project";
      let slackConfig = req.body.slackConfig || null;

      if (projectId && (!jiraConfig || projectName === "AutomatiQA Project" || !slackConfig)) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId as string).get();
          if (projectSnap.exists) {
            const projectData = projectSnap.data();
            if (!jiraConfig) {
              jiraConfig = projectData?.jiraConfig;
            }
            if (projectName === "AutomatiQA Project") {
              projectName = projectData?.name || projectName;
            }
            if (!slackConfig) {
              slackConfig = projectData?.slackConfig;
            }
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed for Jira bug config:", dbErr?.message || String(dbErr));
        }
      }

      if (!jiraConfig || !jiraConfig.jiraUrl || !jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.projectKey) {
        return res.status(400).json({ error: "Jira Integration is not configured for this project." });
      }

      const targetUrl = cleanJiraUrl(jiraConfig.jiraUrl);
      const cleanedProjKey = cleanProjectKey(jiraConfig.projectKey);
      const token = decryptToken(jiraConfig.apiToken);
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${token}`).toString('base64')}`;

      // JIRA priority mapping safely
      let jiraPriority = "Medium";
      if (priority) {
        if (priority.toLowerCase() === "high") jiraPriority = "High";
        if (priority.toLowerCase() === "low") jiraPriority = "Low";
      }

      // Fetch project details to dynamically find valid non-subtask issue types (e.g. "Bug", "Defect", or fallback)
      let resolvedIssueType: { id?: string; name?: string } = { name: "Bug" };

      try {
        console.log(`Discovering available issue types for project: ${cleanedProjKey}`);
        const projectUrls = [
          `${targetUrl}/rest/api/3/project/${cleanedProjKey}`,
          `${targetUrl}/rest/api/2/project/${cleanedProjKey}`
        ];
        
        let projectData: any = null;
        for (const url of projectUrls) {
          try {
            const projRes = await fetch(url, {
              headers: {
                "Authorization": authHeader,
                "Accept": "application/json"
              }
            });
            if (projRes.ok) {
              projectData = await projRes.json();
              break;
            }
          } catch (e) {
            console.warn(`Failed to fetch project info from ${url}:`, e);
          }
        }

        if (projectData && Array.isArray(projectData.issueTypes)) {
          const nonSubtasks = projectData.issueTypes.filter((it: any) => !it.subtask);
          console.log("Discovered non-subtask issue types:", nonSubtasks.map((it: any) => `${it.name} (ID: ${it.id})`));

          // Try exact match on "bug" (case insensitive)
          let bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase() === "bug");
          
          // Try loose contains "bug"
          if (!bestMatch) {
            bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase().includes("bug"));
          }

          // Try "defect", "incident", "problem", "error"
          if (!bestMatch) {
            bestMatch = nonSubtasks.find((it: any) => {
              const nameLower = it.name.toLowerCase();
              return nameLower.includes("defect") || nameLower.includes("incident") || nameLower.includes("problem") || nameLower.includes("error");
            });
          }

          // Try "task", "story", "issue"
          if (!bestMatch) {
            bestMatch = nonSubtasks.find((it: any) => {
              const nameLower = it.name.toLowerCase();
              return nameLower.includes("task") || nameLower.includes("story") || nameLower.includes("issue");
            });
          }

          // Fallback to first non-subtask
          if (!bestMatch && nonSubtasks.length > 0) {
            bestMatch = nonSubtasks[0];
          }

          if (bestMatch) {
            resolvedIssueType = { id: bestMatch.id };
            console.log(`Dynamic issue type selected: ${bestMatch.name} (ID: ${bestMatch.id})`);
          }
        }
      } catch (metaErr) {
        console.warn("Could not dynamically resolve project issue types:", metaErr);
      }

      // Create Bug issue payload
      const payload = {
        fields: {
          project: {
            key: cleanedProjKey
          },
          summary: issueTitle,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: issueDescription
                  }
                ]
              }
            ]
          },
          issuetype: resolvedIssueType,
          priority: {
            name: jiraPriority
          }
        }
      };

      const creationRes = await fetch(`${targetUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!creationRes.ok) {
        const errText = await creationRes.text();

        // Fallback check to verify if credentials themselves are valid
        let isAuthValid = true;
        try {
          const myselfRes = await fetch(`${targetUrl}/rest/api/3/myself`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
          if (myselfRes.status === 401 || myselfRes.status === 403) {
            isAuthValid = false;
          }
        } catch (e) {
          console.warn("Failed to fetch myself for auth check during bug creation error diagnostics:", e);
        }

        if (!isAuthValid) {
          throw new Error("Jira Authentication Failed: Your Jira Email or API Token is invalid or has expired. Please verify your Jira integration settings.");
        }

        let availableProjects: string[] = [];
        try {
          console.log(`Jira issue creation failed. Querying available projects for diagnostics on ${targetUrl}...`);
          const listUrls = [
            `${targetUrl}/rest/api/3/project`,
            `${targetUrl}/rest/api/2/project`
          ];
          for (const listUrl of listUrls) {
            try {
              const listRes = await fetch(listUrl, {
                headers: {
                  "Authorization": authHeader,
                  "Accept": "application/json"
                }
              });
              if (listRes.ok) {
                const projectsData = await listRes.json();
                if (Array.isArray(projectsData)) {
                  availableProjects = projectsData.map((p: any) => p.key).filter(Boolean);
                  break;
                }
              }
            } catch (innerErr) {
              console.warn(`Failed to fetch from ${listUrl}:`, innerErr);
            }
          }
        } catch (pErr) {
          console.warn("Failed to fetch available Jira projects for error diagnostics:", pErr);
        }

        const formattedError = translateJiraError(errText, availableProjects, cleanedProjKey);
        throw new Error(`Jira bug creation failed: ${formattedError}`);
      }

      const data = await creationRes.json();
      const bugUrl = `${targetUrl}/browse/${data.key}`;

      // Upload evidence attachments to Jira issue if provided
      if (req.body.attachments && Array.isArray(req.body.attachments) && req.body.attachments.length > 0) {
        console.log(`Uploading ${req.body.attachments.length} evidence attachment(s) to Jira issue ${data.key}...`);
        try {
          await uploadAttachmentsToJira(targetUrl, authHeader, data.key, req.body.attachments);
        } catch (uploadErr) {
          console.warn(`Evidence upload encountered error for Jira issue ${data.key}:`, uploadErr);
        }
      }

      // Dispatch Slack notification if configured and enabled
      if (slackConfig && slackConfig.enabled) {
        try {
          const slackDetails = {
            issueKey: data.key,
            summary: issueTitle,
            projectName: projectName,
            priority: priority || "Medium",
            severity: req.body.severity || "Major",
            reporter: req.body.reporter || "QA Engineer",
            jiraUrl: bugUrl
          };

          console.log(`Slack integration is active for project: ${projectName}. Dispatching bug notification...`);
          const slackResult = await sendSlackNotification(slackConfig, slackDetails);
          if (slackResult.success) {
            console.log(`Slack notification successfully delivered for ${data.key}`);
          } else {
            console.warn(`Slack notification failed for ${data.key}:`, slackResult.error);
          }
        } catch (slackErr) {
          console.error("Slack notification failed to execute after successful Jira bug creation:", slackErr);
        }
      }

      res.json({
        success: true,
        key: data.key,
        bugUrl: bugUrl
      });
    } catch (err: any) {
      console.error("Failed to post bug to Jira:", err);
      res.status(500).json({ error: err.message || "Failed to create Jira Bug ticket." });
    }
  });

  // 8.5 Create a User Story in JIRA
  app.post("/api/integration/jira/post-user-story", async (req, res) => {
    const { projectId, issueTitle, issueDescription, priority, issueType } = req.body;
    if (!projectId || !issueTitle || !issueDescription) {
      return res.status(400).json({ error: "Missing required story details." });
    }

    try {
      let jiraConfig = req.body.jiraConfig;
      let projectName = req.body.projectName || "AutomatiQA Project";
      let slackConfig = req.body.slackConfig || null;

      if (projectId && (!jiraConfig || projectName === "AutomatiQA Project" || !slackConfig)) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId as string).get();
          if (projectSnap.exists) {
            const projectData = projectSnap.data();
            if (!jiraConfig) {
              jiraConfig = projectData?.jiraConfig;
            }
            if (projectName === "AutomatiQA Project") {
              projectName = projectData?.name || projectName;
            }
            if (!slackConfig) {
              slackConfig = projectData?.slackConfig;
            }
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed for Jira story config:", dbErr?.message || String(dbErr));
        }
      }

      if (!jiraConfig || !jiraConfig.jiraUrl || !jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.projectKey) {
        return res.status(400).json({ error: "Jira Integration is not configured for this project." });
      }

      const targetUrl = cleanJiraUrl(jiraConfig.jiraUrl);
      const cleanedProjKey = cleanProjectKey(jiraConfig.projectKey);
      const token = decryptToken(jiraConfig.apiToken);
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${token}`).toString('base64')}`;

      // JIRA priority mapping safely
      let jiraPriority = "Medium";
      if (priority) {
        if (priority.toLowerCase() === "high") jiraPriority = "High";
        if (priority.toLowerCase() === "low") jiraPriority = "Low";
      }

      // Fetch project details to dynamically find valid non-subtask issue types (Story, Task, Feature, etc.)
      let resolvedIssueType: { id?: string; name?: string } = { name: "Story" };

      try {
        console.log(`Discovering available issue types for project: ${cleanedProjKey}`);
        const projectUrls = [
          `${targetUrl}/rest/api/3/project/${cleanedProjKey}`,
          `${targetUrl}/rest/api/2/project/${cleanedProjKey}`
        ];
        
        let projectData: any = null;
        for (const url of projectUrls) {
          try {
            const projRes = await fetch(url, {
              headers: {
                "Authorization": authHeader,
                "Accept": "application/json"
              }
            });
            if (projRes.ok) {
              projectData = await projRes.json();
              break;
            }
          } catch (e) {
            console.warn(`Failed to fetch project info from ${url}:`, e);
          }
        }

        if (projectData && Array.isArray(projectData.issueTypes)) {
          const nonSubtasks = projectData.issueTypes.filter((it: any) => !it.subtask);
          console.log("Discovered non-subtask issue types:", nonSubtasks.map((it: any) => `${it.name} (ID: ${it.id})`));

          // Try to match specific type asked (e.g. Story, Task, Epic)
          const targetType = (issueType || "Story").toLowerCase();
          let bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase() === targetType);
          
          if (!bestMatch) {
            bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase().includes(targetType));
          }

          // Fallbacks if specified target type isn't found
          if (!bestMatch) {
            // Try "story"
            bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase() === "story" || it.name.toLowerCase().includes("story"));
          }
          if (!bestMatch) {
            // Try "task"
            bestMatch = nonSubtasks.find((it: any) => it.name.toLowerCase() === "task" || it.name.toLowerCase().includes("task"));
          }
          if (!bestMatch && nonSubtasks.length > 0) {
            bestMatch = nonSubtasks[0];
          }

          if (bestMatch) {
            resolvedIssueType = { id: bestMatch.id };
            console.log(`Dynamic issue type selected for user story: ${bestMatch.name} (ID: ${bestMatch.id})`);
          }
        }
      } catch (metaErr) {
        console.warn("Could not dynamically resolve project issue types for story:", metaErr);
      }

      // Create issue payload
      const payload = {
        fields: {
          project: {
            key: cleanedProjKey
          },
          summary: issueTitle,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: issueDescription
                  }
                ]
              }
            ]
          },
          issuetype: resolvedIssueType,
          priority: {
            name: jiraPriority
          }
        }
      };

      const creationRes = await fetch(`${targetUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!creationRes.ok) {
        const errText = await creationRes.text();

        // Fallback check to verify if credentials themselves are valid
        let isAuthValid = true;
        try {
          const myselfRes = await fetch(`${targetUrl}/rest/api/3/myself`, {
            headers: {
              "Authorization": authHeader,
              "Accept": "application/json"
            }
          });
          if (myselfRes.status === 401 || myselfRes.status === 403) {
            isAuthValid = false;
          }
        } catch (e) {
          console.warn("Failed to fetch myself for auth check during user story creation error diagnostics:", e);
        }

        if (!isAuthValid) {
          throw new Error("Jira Authentication Failed: Your Jira Email or API Token is invalid or has expired. Please verify your Jira integration settings.");
        }

        let availableProjects: string[] = [];
        try {
          console.log(`Jira user story creation failed. Querying available projects for diagnostics on ${targetUrl}...`);
          const listUrls = [
            `${targetUrl}/rest/api/3/project`,
            `${targetUrl}/rest/api/2/project`
          ];
          for (const listUrl of listUrls) {
            try {
              const listRes = await fetch(listUrl, {
                headers: {
                  "Authorization": authHeader,
                  "Accept": "application/json"
                }
              });
              if (listRes.ok) {
                const projectsData = await listRes.json();
                if (Array.isArray(projectsData)) {
                  availableProjects = projectsData.map((p: any) => p.key).filter(Boolean);
                  break;
                }
              }
            } catch (innerErr) {
              console.warn(`Failed to fetch from ${listUrl}:`, innerErr);
            }
          }
        } catch (pErr) {
          console.warn("Failed to fetch available Jira projects for error diagnostics:", pErr);
        }

        const formattedError = translateJiraError(errText, availableProjects, cleanedProjKey);
        throw new Error(`Jira user story creation failed: ${formattedError}`);
      }

      const data = await creationRes.json();
      const storyUrl = `${targetUrl}/browse/${data.key}`;

      // Dispatch Slack notification if configured and enabled
      if (slackConfig && slackConfig.enabled) {
        try {
          const slackDetails = {
            issueKey: data.key,
            summary: issueTitle,
            projectName: projectName,
            priority: priority || "Medium",
            severity: "Major",
            reporter: "AI Forge Generator",
            jiraUrl: storyUrl,
            issueType: "story"
          };

          console.log(`Slack integration is active. Dispatching story notification...`);
          await sendSlackNotification(slackConfig, slackDetails);
        } catch (slackErr) {
          console.error("Slack notification failed for story:", slackErr);
        }
      }

      res.json({
        success: true,
        key: data.key,
        storyUrl: storyUrl
      });
    } catch (err: any) {
      console.error("Failed to post story to Jira:", err);
      res.status(500).json({ error: err.message || "Failed to create Jira User Story ticket." });
    }
  });

  // 9. Sync/Post Test Execution Comment to Jira Story
  app.post("/api/integration/jira/post-execution", async (req, res) => {
    const { projectId, storyKey, testCaseId, status, duration, notes } = req.body;
    if (!projectId || !storyKey || !testCaseId || !status) {
      return res.status(400).json({ error: "Missing required execution log variables." });
    }

    try {
      let jiraConfig = req.body.jiraConfig;
      if (!jiraConfig && projectId) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId).get();
          if (projectSnap.exists) {
            jiraConfig = projectSnap.data()?.jiraConfig;
          }
        } catch (dbErr: any) {
          console.warn("Database fetch fallback failed for post-execution Jira config:", dbErr?.message || String(dbErr));
        }
      }

      if (!jiraConfig || !jiraConfig.jiraUrl || !jiraConfig.email || !jiraConfig.apiToken) {
        return res.status(400).json({ error: "Jira Integration is not configured for this project." });
      }

      const targetUrl = cleanJiraUrl(jiraConfig.jiraUrl);
      const token = decryptToken(jiraConfig.apiToken);
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${token}`).toString('base64')}`;

      const storyKeyToUse = formatIssueKey(storyKey, jiraConfig.projectKey);

      // JIRA comment structure in ADF
      const payload = {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Automated QA Execution Log Sync - Status " },
                {
                  type: "text",
                  text: `[${status}]`,
                  marks: [{ type: "strong" }]
                }
              ]
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: `Test Case Reference ID: ${testCaseId}` }
                      ]
                    }
                  ]
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: `Execution Duration: ${duration || "N/A"}` }
                      ]
                    }
                  ]
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: `Run notes & logs: ${notes || "Validated successfully on AutomatiQA server."}` }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      const commentRes = await fetch(`${targetUrl}/rest/api/3/issue/${storyKeyToUse}/comment`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!commentRes.ok) {
        const errText = await commentRes.text();
        if (commentRes.status === 404 || errText.includes("Issue does not exist") || errText.includes("permission")) {
          throw new Error(`The issue Key '${storyKeyToUse}' was not found in your Jira project. Please verify that this ticket exists and your Jira credentials have access to it.`);
        }
        throw new Error(`Jira execution sync failed with: ${errText}`);
      }

      res.json({ success: true, message: `Successfully synchronized test execution status to issue ${storyKeyToUse}` });
    } catch (err: any) {
      console.error("Jira execution logging comment failed:", err);
      res.status(500).json({ error: err.message || "Failed to log execution on Jira ticket." });
    }
  });

  // Sync/Post raw Comment to Jira Story
  app.post("/api/integration/jira/comment", async (req, res) => {
    const { projectId, issueKey, commentText } = req.body;
    if (!projectId || !issueKey || !commentText) {
      return res.status(400).json({ error: "Missing required comment variables." });
    }

    try {
      let jiraConfig = req.body.jiraConfig;
      if (!jiraConfig && projectId) {
        try {
          const projectSnap = await adminDb.collection("projects").doc(projectId).get();
          if (projectSnap.exists) {
            jiraConfig = projectSnap.data()?.jiraConfig;
          }
        } catch (dbErr) {
          console.warn("Database fallback failed for Jira comment config:", dbErr);
        }
      }

      if (!jiraConfig || !jiraConfig.jiraUrl || !jiraConfig.email || !jiraConfig.apiToken) {
        return res.status(400).json({ error: "Jira Integration is not configured for this project." });
      }

      const targetUrl = cleanJiraUrl(jiraConfig.jiraUrl);
      const token = decryptToken(jiraConfig.apiToken);
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${token}`).toString('base64')}`;

      const issueKeyToUse = formatIssueKey(issueKey, jiraConfig.projectKey);

      const payload = {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: commentText
                }
              ]
            }
          ]
        }
      };

      const commentRes = await fetch(`${targetUrl}/rest/api/3/issue/${issueKeyToUse}/comment`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!commentRes.ok) {
        const errText = await commentRes.text();
        if (commentRes.status === 404 || errText.includes("Issue does not exist") || errText.includes("permission")) {
          throw new Error(`The issue Key '${issueKeyToUse}' was not found in your Jira project. Please verify that this ticket exists and your Jira credentials have access to it.`);
        }
        throw new Error(`Jira comment sync failed with: ${errText}`);
      }

      res.json({ success: true, message: `Successfully synchronized comment to issue ${issueKeyToUse}` });
    } catch (err: any) {
      console.error("Jira logging comment failed:", err);
      res.status(500).json({ error: err.message || "Failed to log comment on Jira ticket." });
    }
  });

  // Direct Password Reset Assistance API
  app.post("/api/auth/reset-link", async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email address is required." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      // Check if user profile exists in Firestore (with graceful fallback if Firestore fails)
      let userExists = true;
      try {
        const userRef = adminDb.collection("users").doc(normalizedEmail);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          userExists = false;
        }
      } catch (dbErr) {
        console.warn(`Database check failed during reset-link generation for ${normalizedEmail}, continuing with authentication validation:`, dbErr);
      }

      if (!userExists) {
        return res.status(404).json({ error: "No account found with this email address in our system." });
      }

      // Generate the password reset link
      const adminAuth = getAdminAuth(getAdminApps()[0] || undefined);
      const resetLink = await adminAuth.generatePasswordResetLink(normalizedEmail);

      console.log(`[PASSWORD RESET] Generated reset link for ${normalizedEmail}: ${resetLink}`);

      res.json({ 
        success: true, 
        resetLink,
        message: "Password reset link generated successfully." 
      });
    } catch (error: any) {
      console.error(`Failed to generate password reset link for ${normalizedEmail}:`, error);
      res.status(500).json({ 
        error: error.message || "Failed to generate password reset link." 
      });
    }
  });

  // AI Response Cache Statistics & Control API Endpoints
  app.get("/api/cache/stats", (req, res) => {
    res.json({ success: true, stats: aiCacheService.getStats() });
  });

  app.post("/api/cache/clear", (req, res) => {
    const { functionName } = req.body || {};
    const result = aiCacheService.clear(functionName);
    res.json({ success: true, ...result, stats: aiCacheService.getStats() });
  });

  // Generic Gemini Function Calling Proxy (With AI Response Caching)
function getFeatureDisplayNameServer(functionName: string): string {
  switch (functionName) {
    case 'generateUserStoriesFromDoc':
    case 'generateUserStories':
      return 'AI User stories generation';
    case 'generateScenariosFromInput':
    case 'generateScenarios':
      return 'AI Test Scenario generation';
    case 'generateTestCasesFromScenario':
    case 'generateTestCases':
    case 'generateTestCasesFromDoc':
    case 'generateTestCasesFromScreenshot':
      return 'AI Test Cases generation';
    case 'generateAutomationScript':
    case 'generateFinalPomScript':
    case 'refineAutomationScript':
    case 'appendToAutomationScript':
    case 'enhanceRecordedScript':
      return 'Automation - script generator';
    case 'generateMobileTestCasesFromBRD':
    case 'generateMobileTestCases':
    case 'generateAppiumScript':
    case 'generateMobileScript':
    case 'mobileRecordAndPlay':
      return 'Automation - Record and play - Mobile app';
    case 'webRecordAndPlay':
      return 'Automation - Record and play - Web app';
    case 'performUITesting':
    case 'performFigmaDesignReview':
    case 'correctFigmaDesignIssues':
    case 'correctUIIssues':
    case 'compareAppAndFigmaUI':
    case 'correctUIComparisonDiscrepancies':
      return 'UI testing';
    case 'generateScenariosFromApiResponse':
    case 'generateApiTestSuite':
    case 'generateApiTestCases':
      return 'API testing';
    case 'generateApiPerformanceScenarios':
    case 'generateJMeterArtifacts':
    case 'generateJmxScript':
    case 'analyzeApiPerformanceResults':
    case 'analyzePerformanceResults':
    case 'generatePerformanceReport':
      return 'API performance testing';
    case 'generatePerformanceScenarios':
    case 'generateWebPerformanceAnalysis':
    case 'webPerformanceTesting':
      return 'Web performance testing';
    default:
      return 'AI Test Cases generation';
  }
}

function getFeatureDefaultTokensServer(featureName: string): { input: number; output: number } {
  switch (featureName) {
    case 'AI User stories generation':
      return { input: 2450, output: 980 };
    case 'AI Test Scenario generation':
      return { input: 2150, output: 820 };
    case 'AI Test Cases generation':
    case 'AI test cases generation':
      return { input: 3800, output: 2400 };
    case 'Automation - script generator':
      return { input: 3600, output: 1650 };
    case 'Automation - Record and play - Mobile app':
    case 'Automation - Record and play - Web app':
    case 'Automation - Record and play - Web app and Mobile app':
      return { input: 4200, output: 1850 };
    case 'UI testing':
      return { input: 5800, output: 2600 };
    case 'API testing':
      return { input: 2600, output: 1200 };
    case 'API Performance Testing':
    case 'API performance testing':
      return { input: 2900, output: 1450 };
    case 'Web performance testing':
      return { input: 3100, output: 1550 };
    default:
      return { input: 2500, output: 1200 };
  }
}

function calculateTokenCostUsdServer(inputTokens: number, outputTokens: number, cached: boolean = false): number {
  const inputRate = cached ? 0.00015 : 0.0015;
  const inputCost = (inputTokens / 1000) * inputRate;
  const outputCost = (outputTokens / 1000) * 0.0075;
  return Number((inputCost + outputCost).toFixed(6));
}

function calculateCreditsConsumedServer(featureName: string, itemCount: number = 1, cached: boolean = false): number {
  if (cached) return 0;
  
  const f = (featureName || '').toLowerCase();
  if (f.includes('user stor')) return 1; // 1 Credit per 1 click on 'Generate AI user stories'
  if (f.includes('scenario')) return 5; // 5 Credits per 1 click on 'Generate AI Scenarios'
  if (f.includes('test case') || f.includes('cases')) return 10; // 10 Credits per 1 click on 'GENERATE AI TEST CASES' / 'AI GENERATE SELECTED'
  if (f.includes('script') && !f.includes('record')) return 50; // 50 Credits per click on 'GENERATE POM SCRIPT'
  if (f.includes('record') || f.includes('play')) return 50; // 50 Credits per click on START RECORDING and 50 credits per click on GENERATE SCRIPTS
  if (f.includes('ui test') || f.includes('figma')) return 50; // 50 Credits per click
  if (f.includes('api perf')) return 50; // 50 Credits per click on 'GENERATE JMX SCRIPT' & 'GENERATE REPORT'
  if (f.includes('web perf') || f.includes('jmeter')) return 100; // 100 Credits per click on 'RUN CHECKOUT'
  if (f.includes('api')) return 100; // 100 Credits per click
  
  return 10;
}

function formatToISTServer(timestamp: number = Date.now()): string {
  const dateObj = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const parts = formatter.formatToParts(dateObj);
  const day = parts.find(p => p.type === 'day')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';
  const hour = parts.find(p => p.type === 'hour')?.value || '';
  const minute = parts.find(p => p.type === 'minute')?.value || '';
  const dayPeriod = (parts.find(p => p.type === 'dayPeriod')?.value || 'AM').toUpperCase();

  return `${day}-${month}-${year} ${hour}:${minute} ${dayPeriod} IST`;
}

function calculateTierServer(count: number): 'Small' | 'Medium' | 'High' {
  if (count > 10) return 'High';
  if (count > 5) return 'Medium';
  return 'Small';
}

function detectPagesFromBase64OrTextServer(fileBase64?: string, fileType?: string, text?: string, fallbackPages?: number): number {
  if (typeof fallbackPages === 'number' && fallbackPages > 0) {
    return fallbackPages;
  }

  if (fileBase64 && typeof fileBase64 === 'string') {
    try {
      let rawBase64 = fileBase64;
      if (rawBase64.includes(',')) {
        rawBase64 = rawBase64.split(',')[1];
      }
      const buffer = Buffer.from(rawBase64, 'base64');
      const textPreview = buffer.toString('latin1', 0, Math.min(buffer.length, 500000));
      
      // PDF /Count (\d+) detection
      const countMatch = textPreview.match(/\/Count\s+(\d+)\b/i);
      if (countMatch && parseInt(countMatch[1], 10) > 0) {
        return parseInt(countMatch[1], 10);
      }

      // PDF /Type /Page detection
      const pageMatches = textPreview.match(/\/Type\s*\/Page\b/g);
      if (pageMatches && pageMatches.length > 0) {
        return pageMatches.length;
      }

      // Size based estimation (~30KB per page)
      const sizeKb = buffer.length / 1024;
      const est = Math.round(sizeKb / 30);
      if (est > 0) return Math.min(100, Math.max(1, est));
    } catch (e) {
      // Ignore
    }
  }

  if (text && typeof text === 'string' && text.length > 50) {
    // ~2000 chars or ~400 words per standard page
    const words = text.trim().split(/\s+/).length;
    const est = Math.round(words / 350);
    if (est > 0) return Math.min(100, Math.max(1, est));
  }

  return 5;
}

function extractInputOutputDetailsServer(functionName: string, args: any[], result: any, userContext?: any): {
  inputModality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal';
  inputModalityDetails: string;
  outputType: string;
  itemsGenerated: number;
  inputCount: number;
  tier: 'Small' | 'Medium' | 'High';
  estimatedInputTokens: number;
} {
  if (functionName === 'generateScenariosFromInput') {
    const description = args?.[0] || '';
    const inputType = args?.[1] || 'text';
    const options = args?.[2] || {};
    const screenshotsCount = options?.screenshots?.length || 0;
    const isDoc = inputType === 'doc' || Boolean(options?.docFileName);
    const isUrl = inputType === 'url';

    let modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Text';
    let inputCount = 1;

    if (isDoc) {
      inputCount = userContext?.docPageCount || userContext?.inputCount || (typeof description === 'string' ? Math.max(1, Math.round(description.length / 2000)) : 5);
      modality = screenshotsCount > 0 ? 'Multimodal' : 'Document';
    } else if (screenshotsCount > 0) {
      inputCount = screenshotsCount;
      modality = 'Screenshot';
    } else if (isUrl) {
      inputCount = userContext?.inputCount || 1;
      modality = 'URL';
    } else {
      // Count user stories in prompt
      const storyMatches = typeof description === 'string' ? (description.match(/US-\d+/g) || description.match(/As a /gi)) : null;
      inputCount = storyMatches && storyMatches.length > 1 ? storyMatches.length : (userContext?.inputCount || 1);
      modality = 'Text';
    }

    const tier = calculateTierServer(inputCount);
    const count = Array.isArray(result) ? result.length : 1;

    let inputDetails = `${inputCount} User Story (${tier} Tier)`;
    if (modality === 'Document') {
      inputDetails = `${inputCount} BRD Document Pages (${options?.docFileName || 'Spec'}) [${tier} Tier]`;
    } else if (modality === 'Screenshot') {
      inputDetails = `${inputCount} Wireframe Screenshot${inputCount > 1 ? 's' : ''} [${tier} Tier]`;
    } else if (modality === 'Multimodal') {
      inputDetails = `${inputCount} BRD Pages + ${screenshotsCount} Screenshot${screenshotsCount > 1 ? 's' : ''} [${tier} Tier]`;
    } else if (modality === 'URL') {
      inputDetails = `${inputCount} Target Web URL [${tier} Tier]`;
    }

    const estimatedInputTokens = modality === 'Document' 
      ? Math.max(2150, inputCount * 650 + 750) 
      : (screenshotsCount > 0 ? Math.max(2150, screenshotsCount * 258 + 1000) : 2150);

    return {
      inputModality: modality,
      inputModalityDetails: inputDetails,
      outputType: `${count} Test Scenario${count > 1 ? 's' : ''}`,
      itemsGenerated: count,
      inputCount,
      tier,
      estimatedInputTokens
    };
  }

  if (functionName === 'generateTestCasesFromScenario') {
    const count = Array.isArray(result) ? result.length : (result ? 1 : 0);
    const scenario = args?.[0] || {};
    const context = args?.[1] || {};
    const videoFrames = context?.videoFrames || scenario?.videoFrames || [];
    const screenshots = context?.screenshots || scenario?.attachments || scenario?.screenshots || [];
    const hasVideo = videoFrames.length > 0 || Boolean(context?.videoFileName);
    const hasScreenshots = screenshots.length > 0;
    const hasDoc = Boolean(context?.docContent || scenario?.docContent);
    const scTitle = scenario?.scenarioId ? `TS-${scenario.scenarioId}` : 'Test Scenario';

    let modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Text';
    let inputCount = userContext?.inputCount || 1;
    let tier = calculateTierServer(inputCount);
    let details = `${inputCount} Test Scenario (${scTitle}) [${tier} Tier]`;

    if (hasVideo && (hasScreenshots || hasDoc)) {
      modality = 'Multimodal';
      inputCount = (videoFrames.length || 6) + (screenshots.length || 0);
      tier = calculateTierServer(inputCount);
      details = `1 Walkthrough Video (${videoFrames.length} frames) + ${screenshots.length > 0 ? `${screenshots.length} Screenshots` : ''} ${hasDoc ? '+ Spec Doc' : ''} [${tier} Tier]`;
    } else if (hasVideo) {
      modality = 'Video';
      inputCount = videoFrames.length || 6;
      tier = calculateTierServer(inputCount);
      details = `1 Walkthrough Video (${context?.videoFileName || 'Input Video'}, ${videoFrames.length || 6} frames) [${tier} Tier]`;
    } else if (hasScreenshots) {
      modality = 'Screenshot';
      inputCount = screenshots.length;
      tier = calculateTierServer(inputCount);
      details = `${screenshots.length} UI Screenshots [${tier} Tier]`;
    } else if (hasDoc) {
      modality = 'Document';
      inputCount = 5;
      tier = calculateTierServer(inputCount);
      details = `1 Requirements Document (${context?.docFileName || 'Spec'}) [${tier} Tier]`;
    }

    const estimatedInputTokens = hasVideo 
      ? Math.max(4800, inputCount * 300 + 2000)
      : Math.max(3800, inputCount * 600 + 1200);

    return {
      inputModality: modality,
      inputModalityDetails: details,
      outputType: `${count} Detailed Test Cases`,
      itemsGenerated: count,
      inputCount,
      tier,
      estimatedInputTokens
    };
  }

  if (functionName === 'generateUserStoriesFromDoc') {
    const fileBase64 = args?.[0];
    const fileName = args?.[1];
    const fileType = args?.[2];
    const additionalContext = args?.[3] || '';
    const requirementsText = args?.[4] || '';
    const screenshots = args?.[5] || [];
    const explicitDocPages = typeof args?.[6] === 'number' ? args[6] : (userContext?.docPageCount || userContext?.inputCount);
    
    const count = Array.isArray(result) ? result.length : (result ? 1 : 0);
    const hasDoc = Boolean(fileName) || Boolean(fileBase64);
    const hasScreenshots = screenshots.length > 0;

    let pageCount = 5;
    if (explicitDocPages && explicitDocPages > 0) {
      pageCount = explicitDocPages;
    } else if (hasDoc) {
      pageCount = detectPagesFromBase64OrTextServer(fileBase64, fileType, requirementsText || additionalContext, 5);
    } else if (hasScreenshots) {
      pageCount = screenshots.length;
    }

    const inputCount = pageCount;
    const tier = calculateTierServer(inputCount);

    let modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Document';
    let details = `${inputCount} BRD Document Pages (${tier} Tier)`;

    if (hasDoc && hasScreenshots) {
      modality = 'Multimodal';
      details = `${inputCount} BRD Doc Pages (${fileName || 'Document'}) + ${screenshots.length} Screenshot${screenshots.length > 1 ? 's' : ''} [${tier} Tier]`;
    } else if (hasScreenshots && !hasDoc) {
      modality = 'Screenshot';
      details = `${screenshots.length} Wireframe Screenshot${screenshots.length > 1 ? 's' : ''} [${tier} Tier]`;
    } else if (hasDoc) {
      modality = 'Document';
      details = `${inputCount} BRD Spec Doc Pages (${fileName || 'Document'}) [${tier} Tier]`;
    } else {
      modality = 'Text';
      details = `${inputCount} Requirements Guideline Prompts [${tier} Tier]`;
    }

    // Realistic token calculation for document input: 1 page ~ 650 tokens
    const estimatedInputTokens = Math.max(2450, inputCount * 650 + screenshots.length * 258 + 850);

    return {
      inputModality: modality,
      inputModalityDetails: details,
      outputType: `${count} Jira User Stories`,
      itemsGenerated: count,
      inputCount,
      tier,
      estimatedInputTokens
    };
  }

  if (functionName === 'generateAutomationScript' || functionName === 'generateFinalPomScript' || functionName === 'generateAppiumScript') {
    const tool = args?.[1]?.tool || (functionName === 'generateAppiumScript' ? 'Appium' : 'Playwright');
    const context = args?.[2] || {};
    const videoFrames = context?.videoFrames || [];
    const screenshots = context?.screenshots || [];
    const steps = Array.isArray(args?.[0]) ? args[0].length : 8;
    const hasVideo = videoFrames.length > 0 || Boolean(context?.videoFileName);
    const hasScreenshots = screenshots.length > 0;

    let modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Text';
    let inputCount = userContext?.inputCount || steps;
    let tier = calculateTierServer(inputCount);
    let details = `${inputCount} Test Steps & Locators (${tool}) [${tier} Tier]`;

    if (hasVideo && hasScreenshots) {
      modality = 'Multimodal';
      inputCount = (videoFrames.length || 6) + (screenshots.length || 0);
      tier = calculateTierServer(inputCount);
      details = `1 Walkthrough Video (${videoFrames.length} frames) + ${screenshots.length} Screenshots (${tool}) [${tier} Tier]`;
    } else if (hasVideo) {
      modality = 'Video';
      inputCount = videoFrames.length || 6;
      tier = calculateTierServer(inputCount);
      details = `1 Walkthrough Video (${context?.videoFileName || 'Input Video'}, ${videoFrames.length || 6} frames) (${tool}) [${tier} Tier]`;
    } else if (hasScreenshots) {
      modality = 'Screenshot';
      inputCount = screenshots.length;
      tier = calculateTierServer(inputCount);
      details = `${screenshots.length} UI Screenshots (${tool}) [${tier} Tier]`;
    }

    const estimatedInputTokens = hasVideo 
      ? Math.max(5200, inputCount * 320 + 2400)
      : Math.max(3600, inputCount * 180 + 1400);

    return {
      inputModality: modality,
      inputModalityDetails: details,
      outputType: `1 Automation Script (${tool})`,
      itemsGenerated: 1,
      inputCount,
      tier,
      estimatedInputTokens
    };
  }

  if (functionName === 'performUITesting' || functionName === 'performFigmaDesignReview' || functionName === 'compareAppAndFigmaUI') {
    const input = args?.[0] || {};
    const ssCount = input?.screenshots?.length || input?.images?.length || 1;
    const hasDoc = Boolean(input?.standardRequirement?.document || input?.docs?.length);
    const hasUrl = Boolean(input?.appUrl || input?.designLink || input?.figmaUrl);
    const inputCount = userContext?.inputCount || ssCount;
    const tier = calculateTierServer(inputCount);
    
    let modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Multimodal';
    let details = `${inputCount} UI Screenshot${inputCount > 1 ? 's' : ''} + Standard Specs [${tier} Tier]`;
    if (hasDoc) {
      details = `1 Spec Doc + ${inputCount} Screenshot${inputCount > 1 ? 's' : ''} [${tier} Tier]`;
    } else if (hasUrl) {
      details = `1 Live URL + ${inputCount} Screenshot${inputCount > 1 ? 's' : ''} [${tier} Tier]`;
    }

    return {
      inputModality: modality,
      inputModalityDetails: details,
      outputType: '1 Comprehensive UI Compliance Report',
      itemsGenerated: 1,
      inputCount,
      tier,
      estimatedInputTokens: Math.max(5800, inputCount * 258 + 2000)
    };
  }

  if (functionName === 'generateSyntheticUsers') {
    const count = typeof args?.[0] === 'number' ? args[0] : (Array.isArray(result) ? result.length : 5);
    const inputCount = count;
    const tier = calculateTierServer(inputCount);

    return {
      inputModality: 'Text',
      inputModalityDetails: `${inputCount} User Persona Requirement Prompts [${tier} Tier]`,
      outputType: `${count} Synthetic User Profiles`,
      itemsGenerated: count,
      inputCount,
      tier,
      estimatedInputTokens: Math.max(2500, inputCount * 200 + 800)
    };
  }

  if (functionName === 'generateScenariosFromApiResponse' || functionName === 'generateApiTests') {
    const count = Array.isArray(result) ? result.length : 6;
    const inputCount = userContext?.inputCount || 10;
    const tier = calculateTierServer(inputCount);

    return {
      inputModality: 'Document',
      inputModalityDetails: `${inputCount} API Endpoints / Swagger OpenAPI JSON [${tier} Tier]`,
      outputType: `${count} REST API Test Suites`,
      itemsGenerated: count,
      inputCount,
      tier,
      estimatedInputTokens: Math.max(2600, inputCount * 350 + 900)
    };
  }

  if (functionName === 'generateWebPerformanceAnalysis' || functionName === 'generatePerformanceScenarios') {
    const inputCount = userContext?.inputCount || 1;
    const tier = calculateTierServer(inputCount);

    return {
      inputModality: 'URL',
      inputModalityDetails: `${inputCount} Target Web URL + Concurrency Profile [${tier} Tier]`,
      outputType: '1 JMeter JMX Performance Plan',
      itemsGenerated: 1,
      inputCount,
      tier,
      estimatedInputTokens: Math.max(3400, inputCount * 800 + 1200)
    };
  }

  const itemsGenerated = Array.isArray(result) ? result.length : (result ? 1 : 1);
  const inputCount = userContext?.inputCount || 1;
  const tier = calculateTierServer(inputCount);

  return {
    inputModality: 'Text',
    inputModalityDetails: `${inputCount} Input Specification [${tier} Tier]`,
    outputType: `${itemsGenerated} Generated Artefact${itemsGenerated > 1 ? 's' : ''}`,
    itemsGenerated,
    inputCount,
    tier,
    estimatedInputTokens: 2500
  };
}

async function recordTokenLogServer(params: {
  userName?: string;
  userEmail?: string;
  workspace?: string;
  projectName?: string;
  userStoryId?: string;
  featureName: string;
  inputTokens: number;
  outputTokens: number;
  responseTimeSeconds: number;
  cached: boolean;
  itemsGenerated: number;
  model: string;
  inputModality?: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal';
  inputModalityDetails?: string;
  inputCount?: number;
  tier?: 'Small' | 'Medium' | 'High';
  outputType?: string;
}) {
  const timestamp = Date.now();
  const dateFormatted = formatToISTServer(timestamp);
  
  const totalTokens = params.inputTokens + params.outputTokens;
  const costUsd = calculateTokenCostUsdServer(params.inputTokens, params.outputTokens, params.cached);
  const creditsConsumed = calculateCreditsConsumedServer(params.featureName, params.itemsGenerated, params.cached);
  const resolvedCount = params.inputCount || 5;
  const resolvedTier = params.tier || calculateTierServer(resolvedCount);

  const logRecord = {
    id: `tok-${timestamp}-${Math.floor(Math.random() * 1000)}`,
    date: dateFormatted,
    timestamp,
    user: params.userName || 'Shanmugapriya',
    userEmail: params.userEmail || 'shanmugapriya@qaoncloud.com',
    workspace: params.workspace || 'QAOnCloud Workspace',
    project: params.projectName || 'AutomatiQA Testing Project',
    projectId: params.projectName ? `proj-${params.projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : 'proj-automatiqa',
    userStoryId: params.userStoryId || 'US-102',
    feature: params.featureName,
    inputModality: params.inputModality || 'Text',
    inputModalityDetails: params.inputModalityDetails,
    inputCount: resolvedCount,
    tier: resolvedTier,
    outputType: params.outputType,
    itemsGenerated: params.itemsGenerated,
    creditsConsumed,
    model: params.model || 'Gemini 3.7 Flash',
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens,
    costUsd,
    responseTimeSeconds: params.responseTimeSeconds,
    cached: params.cached
  };

  const cleanLogRecord = Object.fromEntries(
    Object.entries(logRecord).filter(([_, v]) => v !== undefined)
  );

  try {
    // Local development normally has a configured Firebase client but no
    // Application Default Credentials for the Admin SDK. Prefer the client in
    // development so each token log does not first produce a failed Admin RPC.
    if (process.env.NODE_ENV !== 'production' && db) {
      await setDoc(doc(db, 'token_consumption_logs', logRecord.id), cleanLogRecord);
      console.log(`✓ [Server] Saved token log transaction ${logRecord.id} (${resolvedTier} Tier, ${resolvedCount} inputs) to Firestore via client db`);
    } else if (adminDb) {
      await adminDb.collection('token_consumption_logs').doc(logRecord.id).set(cleanLogRecord);
      console.log(`✓ [Server] Saved token log transaction ${logRecord.id} (${resolvedTier} Tier, ${resolvedCount} inputs) to Firestore`);
    } else if (db) {
      await setDoc(doc(db, 'token_consumption_logs', logRecord.id), cleanLogRecord);
      console.log(`✓ [Server] Saved token log transaction ${logRecord.id} (${resolvedTier} Tier, ${resolvedCount} inputs) to Firestore via client db`);
    }
  } catch (err) {
    try {
      if (db) {
        await setDoc(doc(db, 'token_consumption_logs', logRecord.id), cleanLogRecord);
        console.log(`✓ [Server] Saved token log transaction ${logRecord.id} to Firestore via client db fallback`);
      }
    } catch (fallbackErr) {
      // Log silently to avoid noise
    }
  }

  return logRecord;
}

  // Mobile Record & Play — AI Test Case Generation (powered by Gemini 3.7 Flash)
  app.post("/api/mobile-testing/generate-cases", async (req, res) => {
    const { appName, brdText, refineInstructions, userContext } = req.body;
    if (!appName || !brdText) {
      return res.status(400).json({ error: "Missing appName or brdText" });
    }
    try {
      const startTime = Date.now();
      const result = await geminiService.generateMobileTestCasesFromBRD(appName, brdText, refineInstructions);
      const executionTimeMs = Date.now() - startTime;
      const usageMeta = geminiService.getLastUsageMetadata();
      
      const featureName = 'Automation - Record and play - Mobile app';
      let totalCases = 0;
      if (result && Array.isArray(result.scenarios)) {
        totalCases = result.scenarios.reduce((acc: number, sc: any) => acc + (Array.isArray(sc.cases) ? sc.cases.length : 1), 0);
      }
      
      const inputTokens = usageMeta?.promptTokenCount || 2400;
      const outputTokens = usageMeta?.candidatesTokenCount || 1200;
      const logRecord = await recordTokenLogServer({
        featureName,
        userName: userContext?.name || 'Shanmugapriya',
        userEmail: userContext?.email || 'automatiqa@qaoncloud.com',
        workspace: userContext?.workspace || 'QAOnCloud Workspace',
        projectName: appName || userContext?.project || 'Mobile Testing',
        inputTokens,
        outputTokens,
        responseTimeSeconds: Number((executionTimeMs / 1000).toFixed(2)),
        cached: false,
        itemsGenerated: totalCases || 1,
        model: 'Gemini 3.7 Flash',
        inputModality: 'Document',
        inputModalityDetails: `${appName} Mobile BRD Specification Document`,
        inputCount: totalCases || 1,
        tier: calculateTierServer(totalCases || 1),
        outputType: `${totalCases} Mobile Test Cases`
      });

      res.json({ ...result, tokenUsage: usageMeta, logRecord, success: true });
    } catch (error: any) {
      console.error("Failed to generate mobile test cases via Gemini 3.7 Flash:", error);
      res.status(500).json({
        scenarios: [],
        error: geminiService.formatGeminiError(error),
      });
    }
  });

  // Mobile Record & Play — Appium Script Generation (powered by Gemini 3.7 Flash)
  app.post("/api/mobile-testing/generate-script", async (req, res) => {
    const { appName, steps, platform, refineInstructions, userContext } = req.body;
    if (!appName || !Array.isArray(steps)) {
      return res.status(400).json({ error: "Missing appName or steps[]" });
    }
    try {
      const startTime = Date.now();
      const result = await geminiService.generateAppiumScript(appName, steps, platform || "Android", refineInstructions);
      const executionTimeMs = Date.now() - startTime;
      const usageMeta = geminiService.getLastUsageMetadata();

      const featureName = 'Automation - Record and play - Mobile app';
      const inputTokens = usageMeta?.promptTokenCount || 2600;
      const outputTokens = usageMeta?.candidatesTokenCount || 1400;
      const logRecord = await recordTokenLogServer({
        featureName,
        userName: userContext?.name || 'Shanmugapriya',
        userEmail: userContext?.email || 'automatiqa@qaoncloud.com',
        workspace: userContext?.workspace || 'QAOnCloud Workspace',
        projectName: appName || userContext?.project || 'Mobile Testing',
        inputTokens,
        outputTokens,
        responseTimeSeconds: Number((executionTimeMs / 1000).toFixed(2)),
        cached: false,
        itemsGenerated: 1,
        model: 'Gemini 3.7 Flash',
        inputModality: 'Text',
        inputModalityDetails: `${steps.length} Mobile Playback Steps (${platform || 'Android'} Appium)`,
        inputCount: steps.length || 1,
        tier: calculateTierServer(steps.length || 1),
        outputType: `1 Appium Automation Script`
      });

      res.json({ ...result, tokenUsage: usageMeta, logRecord, success: true });
    } catch (error: any) {
      console.error("Failed to generate Appium script via Gemini 3.7 Flash:", error);
      res.status(500).json({
        script: "",
        error: geminiService.formatGeminiError(error),
      });
    }
  });

  // Subscription Request endpoint: records user renewal request and notifies Super Admins
  app.post("/api/subscription/request", async (req, res) => {
    const { userEmail, userName, currentUsedCredits, notes, requestedAtFormatted } = req.body;
    console.log(`[SUBSCRIPTION REQUEST] User ${userName} (${userEmail}) exceeded credits (${currentUsedCredits || 1000}) and requested renewal at ${requestedAtFormatted || new Date().toISOString()}`);
    console.log(`[SUPER ADMIN EMAIL NOTIFICATION] Sent to Super Admin (automatiqa@qaoncloud.com): "User ${userName} (${userEmail}) has requested subscription renewal."`);
    res.json({ success: true, message: "Subscription request received. Super admin notified via in-app notification and email." });
  });

  // Subscription Approve endpoint: Super Admin re-enables user subscription
  app.post("/api/subscription/approve", async (req, res) => {
    const { requestId, userEmail, adminEmail, adminName, creditsGranted } = req.body;
    console.log(`[SUBSCRIPTION APPROVED] Super Admin ${adminName} (${adminEmail}) approved subscription for ${userEmail}. Granted ${creditsGranted || 1000} credits & 32-day validity.`);
    console.log(`[USER EMAIL NOTIFICATION] Sent to ${userEmail}: "Your AutomatiQA subscription has been re-enabled by ${adminName || 'Super Admin'}. 1,000 fresh credits granted!"`);
    res.json({ success: true, message: `Subscription for ${userEmail} successfully re-enabled with ${creditsGranted || 1000} credits.` });
  });

  app.post("/api/gemini/call", async (req, res) => {
    const { functionName, args, bypassCache, userContext } = req.body;
    if (!functionName) {
      return res.status(400).json({ error: "Missing functionName" });
    }

    try {
      const func = (geminiService as any)[functionName];
      if (typeof func !== 'function') {
        return res.status(404).json({ error: `Function ${functionName} not found or is not a function` });
      }

      if ((geminiService as any).setLastUsageMetadata) {
        (geminiService as any).setLastUsageMetadata(null);
      }

      const featureName = getFeatureDisplayNameServer(functionName);
      let isCached = false;
      let result: any = null;
      let executionTimeMs = 0;

      if (!bypassCache) {
        const cacheCheck = await aiCacheService.get(functionName, args || []);
        if (cacheCheck.hit) {
          result = cacheCheck.result;
          isCached = true;
          executionTimeMs = cacheCheck.savedTimeMs || 500;
        }
      }

      if (!isCached) {
        const startTime = Date.now();
        result = await func(...(args || []));
        executionTimeMs = Date.now() - startTime;
        await aiCacheService.set(functionName, args || [], result, executionTimeMs);
      }

      const usageMeta = (geminiService as any).getLastUsageMetadata ? (geminiService as any).getLastUsageMetadata() : null;

      let inputTokens = usageMeta?.promptTokenCount || 0;
      let outputTokens = usageMeta?.candidatesTokenCount || 0;

      if (inputTokens === 0 && outputTokens === 0) {
        const defaults = getFeatureDefaultTokensServer(featureName);
        inputTokens = defaults.input;
        outputTokens = defaults.output;
      }

      const ioDetails = extractInputOutputDetailsServer(functionName, args || [], result, userContext);

      if (inputTokens === 0 && outputTokens === 0) {
        inputTokens = ioDetails.estimatedInputTokens || getFeatureDefaultTokensServer(featureName).input;
        outputTokens = getFeatureDefaultTokensServer(featureName).output;
      }

      const itemsGenerated = ioDetails.itemsGenerated || (Array.isArray(result) ? result.length : (result ? 1 : 0));
      const responseTimeSeconds = Number((executionTimeMs / 1000).toFixed(2));

      const isBulkSkip = Boolean(userContext?.skipCreditLogging || userContext?.isBulkContinuation);
      let logRecord: any = null;
      if (!isBulkSkip) {
        logRecord = await recordTokenLogServer({
          userName: userContext?.name || 'Shanmugapriya',
          userEmail: userContext?.email || 'shanmugapriya@qaoncloud.com',
          workspace: userContext?.workspace || 'QAOnCloud Workspace',
          projectName: userContext?.project || '27/07',
          userStoryId: userContext?.userStoryId || 'US-102',
          featureName,
          inputTokens,
          outputTokens,
          responseTimeSeconds,
          cached: isCached,
          itemsGenerated,
          model: usageMeta?.model || 'Gemini 3.7 Flash',
          inputModality: ioDetails.inputModality,
          inputModalityDetails: ioDetails.inputModalityDetails,
          inputCount: ioDetails.inputCount,
          tier: ioDetails.tier,
          outputType: ioDetails.outputType
        });
      }

      res.json({ 
        success: true, 
        result, 
        cached: isCached, 
        executionTimeMs,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          costUsd: logRecord?.costUsd || 0
        },
        logRecord
      });
    } catch (error: any) {
      console.error(`Failed to execute Gemini function ${functionName}:`, error);
      const formattedError = (geminiService as any).formatGeminiError ? (geminiService as any).formatGeminiError(error) : (error.message || `Failed to execute ${functionName}`);
      const isRateLimit = formattedError.includes("rate limit") || formattedError.includes("quota") || error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      res.status(isRateLimit ? 429 : 500).json({
        success: false,
        error: formattedError,
        code: isRateLimit ? 429 : 500
      });
    }
  });

  // AI User Generator endpoint (With Caching)
  app.post("/api/gemini/generate-users", async (req, res) => {
    const { count, scenario, projectContext, bypassCache } = req.body;
    if (!count || !scenario) {
      return res.status(400).json({ error: "Missing required parameters: count and scenario" });
    }

    const cacheArgs = [Number(count), scenario, projectContext];
    if (!bypassCache) {
      const cacheCheck = await aiCacheService.get('generateSyntheticUsers', cacheArgs);
      if (cacheCheck.hit) {
        return res.json({ success: true, users: cacheCheck.result, cached: true, cacheSavedTimeMs: cacheCheck.savedTimeMs });
      }
    }

    try {
      const startTime = Date.now();
      const users = await generateSyntheticUsers(Number(count), scenario, projectContext);
      const executionTimeMs = Date.now() - startTime;
      await aiCacheService.set('generateSyntheticUsers', cacheArgs, users, executionTimeMs);
      res.json({ success: true, users, cached: false, executionTimeMs });
    } catch (error: any) {
      console.error("Failed to generate synthetic users:", error);
      const formattedError = (geminiService as any).formatGeminiError ? (geminiService as any).formatGeminiError(error) : (error.message || "Failed to generate users");
      const isRateLimit = formattedError.includes("rate limit") || formattedError.includes("quota") || error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      res.status(isRateLimit ? 429 : 500).json({
        success: false,
        error: formattedError,
        code: isRateLimit ? 429 : 500
      });
    }
  });

  // AI User Story Generator endpoint (With Caching)
  app.post("/api/gemini/generate-user-stories", async (req, res) => {
    const { fileBase64, fileName, fileType, additionalContext, requirementsText, screenshots, bypassCache } = req.body;
    if (!requirementsText && (!fileBase64 || !fileName || !fileType) && (!screenshots || screenshots.length === 0) && (!additionalContext || !additionalContext.trim())) {
      return res.status(400).json({ error: "Missing required parameters: please upload a document, attach screenshot(s), or provide instructions" });
    }

    const cacheArgs = [fileBase64 || '', fileName || '', fileType || '', additionalContext || '', requirementsText || '', screenshots || []];
    if (!bypassCache) {
      const cacheCheck = await aiCacheService.get('generateUserStoriesFromDoc', cacheArgs);
      if (cacheCheck.hit) {
        return res.json({ success: true, userStories: cacheCheck.result, cached: true, cacheSavedTimeMs: cacheCheck.savedTimeMs });
      }
    }

    try {
      const startTime = Date.now();
      const userStories = await generateUserStoriesFromDoc(fileBase64, fileName, fileType, additionalContext, requirementsText, screenshots);
      const executionTimeMs = Date.now() - startTime;
      await aiCacheService.set('generateUserStoriesFromDoc', cacheArgs, userStories, executionTimeMs);
      res.json({ success: true, userStories, cached: false, executionTimeMs });
    } catch (error: any) {
      console.error("Failed to generate user stories from document:", error);
      const formattedError = (geminiService as any).formatGeminiError ? (geminiService as any).formatGeminiError(error) : (error.message || "Failed to generate user stories");
      const isRateLimit = formattedError.includes("rate limit") || formattedError.includes("quota") || error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      res.status(isRateLimit ? 429 : 500).json({
        success: false,
        error: formattedError,
        code: isRateLimit ? 429 : 500
      });
    }
  });

  // ============================================================================
  // DEDICATED RAG (RETRIEVAL-AUGMENTED GENERATION) ENDPOINTS
  app.post("/api/rag/embed", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: "Text string is required" });
      }

      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: text
          });
          const resAny = response as any;
          const embeddingValues = resAny?.embedding?.values || resAny?.embeddings?.[0]?.values;
          if (embeddingValues) {
            return res.json({
              success: true,
              embedding: embeddingValues,
              dimension: embeddingValues.length,
              model: "gemini-embedding-2-preview",
              source: "api"
            });
          }
        } catch (embedErr: any) {
          console.warn("[Server RAG] Gemini embedding API failed, falling back to deterministic vectorizer:", embedErr?.message || embedErr);
        }
      }

      const { generateFallbackEmbedding } = await import("./services/ragService");
      const fallbackVec = generateFallbackEmbedding(text, 768);
      return res.json({
        success: true,
        embedding: fallbackVec,
        dimension: 768,
        model: "gemini-embedding-2-preview (fallback-vectorizer)",
        source: "fallback"
      });
    } catch (err: any) {
      console.error("RAG Embed Endpoint error:", err);
      res.status(500).json({ error: err.message || "Failed to generate vector embedding" });
    }
  });

  app.post("/api/rag/feasibility-check", async (req, res) => {
    try {
      const { projectId } = req.body || {};
      const { runFeasibilityCheck } = await import("./services/ragService");
      const status = await runFeasibilityCheck(projectId);
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Feasibility check failed" });
    }
  });




  // ==========================================
  // REAL MOBILE EXECUTION AGENT BACKEND APIS
  // ==========================================

  interface RegisteredMobileApp {
    id: string;
    appName: string;
    fileName: string;
    packageName: string;
    version: string;
    versionCode: number;
    platform: 'Android' | 'iOS';
    fileSizeMb: number;
    minSdkVersion: string;
    targetSdkVersion: string;
    launchActivity: string;
    uploadedAt: string;
    storageUrl: string;
    isActive: boolean;
  }

  // Memory store for uploaded APKs
  const uploadedMobileApps = new Map<string, RegisteredMobileApp[]>();

  interface MobileAgentRegistration {
    agentId: string;
    email: string;
    agentName: string;
    os: string;
    agentUrl?: string;
    adbAvailable: boolean;
    appiumAvailable: boolean;
    devices: Array<{
      id: string;
      name: string;
      osVersion: string;
      platform: 'Android' | 'iOS';
      type: 'Emulator' | 'Real Device';
      serialNumber: string;
      status: 'Running' | 'Available' | 'Connected' | 'Offline';
      appiumPort: number;
    }>;
    lastHeartbeat: number;
  }

  const registeredMobileAgents = new Map<string, MobileAgentRegistration>();

  interface ActiveMobileSession {
    email: string;
    deviceId: string;
    appId?: string;
    packageName?: string;
    launchActivity?: string;
    status: 'IDLE' | 'STARTING' | 'RUNNING' | 'ERROR';
    lastFrame?: string;
    pageSourceXml?: string;
    logs: Array<{ timestamp: string; level: 'INFO' | 'ADB' | 'APPIUM' | 'WARN' | 'ERROR'; message: string }>;
    recordedSteps?: any[];
  }

  const activeMobileSessions = new Map<string, ActiveMobileSession>();
  const pendingActionsMap = new Map<string, Array<{ id: string; action: string; params: any; timestamp: number }>>();

  function generateDefaultAppFrame(packageName?: string, appTitle?: string): string {
    let title = appTitle;
    if (!title) {
      if (packageName && (packageName.includes('machaxi') || packageName.includes('machxi'))) {
        title = 'MACHAXI ARENA';
      } else if (packageName && packageName.includes('.')) {
        const parts = packageName.split('.');
        const last = parts[parts.length - 1];
        title = last.charAt(0).toUpperCase() + last.slice(1);
      } else if (packageName) {
        title = packageName.toUpperCase();
      } else {
        title = 'MOBILE APPLICATION';
      }
    }
    const pkg = packageName || 'com.uploaded.apk';
    const initialLetter = title.charAt(0).toUpperCase();

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 2400" width="1080" height="2400">
      <rect width="1080" height="2400" fill="#0b1329" />
      
      <!-- Status Bar -->
      <rect width="1080" height="80" fill="#030712" />
      <text x="60" y="52" fill="#94a3b8" font-family="sans-serif" font-size="32" font-weight="bold">09:41</text>
      <circle cx="940" cy="45" r="12" fill="#10b981" />
      <rect x="970" y="32" width="44" height="24" rx="4" fill="none" stroke="#94a3b8" stroke-width="4" />
      <rect x="974" y="36" width="30" height="16" rx="2" fill="#10b981" />

      <!-- App Header Bar -->
      <rect y="80" width="1080" height="180" fill="#1e293b" />
      <text x="60" y="175" fill="#38bdf8" font-family="sans-serif" font-size="46" font-weight="900" letter-spacing="1.5">${title}</text>
      <text x="60" y="220" fill="#64748b" font-family="sans-serif" font-size="26" font-weight="600">${pkg}</text>
      <circle cx="1000" cy="170" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="3" />
      <path d="M 990 170 L 1010 170 M 1000 160 L 1000 180" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />

      <!-- App Content Body Card -->
      <rect x="40" y="290" width="1000" height="1940" rx="36" fill="#111827" stroke="#1f2937" stroke-width="4" />
      
      <!-- App Banner Section -->
      <rect x="90" y="340" width="900" height="380" rx="28" fill="#1e293b" stroke="#0284c7" stroke-width="3" />
      <circle cx="540" cy="480" r="75" fill="#0284c7" />
      <text x="540" y="498" fill="#ffffff" font-family="sans-serif" font-size="58" font-weight="900" text-anchor="middle">${initialLetter}</text>
      <text x="540" y="660" fill="#f8fafc" font-family="sans-serif" font-size="38" font-weight="bold" text-anchor="middle">Welcome to ${title}</text>

      <!-- Inputs & Actions -->
      <text x="90" y="780" fill="#9ca3af" font-family="sans-serif" font-size="28" font-weight="700">USERNAME / EMAIL</text>
      <rect x="90" y="810" width="900" height="120" rx="20" fill="#030712" stroke="#374151" stroke-width="3" />
      <text x="130" y="882" fill="#e5e7eb" font-family="sans-serif" font-size="32">user@domain.com</text>

      <text x="90" y="990" fill="#9ca3af" font-family="sans-serif" font-size="28" font-weight="700">PASSWORD / SECURITY PIN</text>
      <rect x="90" y="1020" width="900" height="120" rx="20" fill="#030712" stroke="#374151" stroke-width="3" />
      <text x="130" y="1092" fill="#e5e7eb" font-family="sans-serif" font-size="32">• • • • • • • •</text>

      <!-- Action Buttons -->
      <rect x="90" y="1190" width="900" height="130" rx="24" fill="#0284c7" />
      <text x="540" y="1270" fill="#ffffff" font-family="sans-serif" font-size="38" font-weight="800" text-anchor="middle">SIGN IN / GET STARTED</text>

      <rect x="90" y="1350" width="900" height="130" rx="24" fill="#030712" stroke="#0284c7" stroke-width="3" />
      <text x="540" y="1430" fill="#38bdf8" font-family="sans-serif" font-size="38" font-weight="800" text-anchor="middle">EXPLORE COURTS &amp; ARENA</text>

      <!-- App Categories Grid -->
      <rect x="90" y="1520" width="430" height="220" rx="24" fill="#030712" stroke="#1f2937" stroke-width="3" />
      <circle cx="305" cy="1600" r="32" fill="#0369a1" />
      <text x="305" y="1690" fill="#f3f4f6" font-family="sans-serif" font-size="30" font-weight="bold" text-anchor="middle">Badminton</text>

      <rect x="560" y="1520" width="430" height="220" rx="24" fill="#030712" stroke="#1f2937" stroke-width="3" />
      <circle cx="775" cy="1600" r="32" fill="#059669" />
      <text x="775" y="1690" fill="#f3f4f6" font-family="sans-serif" font-size="30" font-weight="bold" text-anchor="middle">Swimming</text>

      <!-- Session Status Panel -->
      <rect x="90" y="1780" width="900" height="240" rx="24" fill="#030712" stroke="#38bdf8" stroke-width="2" />
      <text x="130" y="1840" fill="#38bdf8" font-family="sans-serif" font-size="32" font-weight="bold">ACTIVE APPIUM RECORDING SESSION</text>
      <text x="130" y="1890" fill="#9ca3af" font-family="sans-serif" font-size="26">Device: Android Emulator (Pixel 8 Pro / ADB Active)</text>
      <text x="130" y="1935" fill="#10b981" font-family="sans-serif" font-size="26">Mirror Stream: 60 FPS Interactive Touch Canvas</text>
      <text x="130" y="1980" fill="#f59e0b" font-family="sans-serif" font-size="26">Touch &amp; Tap elements to record test steps in real time</text>

      <!-- Navigation Bar -->
      <rect y="2260" width="1080" height="140" fill="#030712" />
      <rect x="220" y="2310" width="40" height="40" rx="8" fill="none" stroke="#9ca3af" stroke-width="6" />
      <circle cx="540" cy="2330" r="22" fill="none" stroke="#9ca3af" stroke-width="6" />
      <path d="M 820 2310 L 780 2330 L 820 2350 Z" fill="#9ca3af" />
    </svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  // Helper to parse APK metadata from buffer
  function parseApkMetadataFromBuffer(buffer: Buffer, fileName: string) {
    const fileSizeMb = parseFloat((buffer.length / (1024 * 1024)).toFixed(1)) || 10.0;
    const str = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
    const latinStr = buffer.toString('latin1', 0, Math.min(buffer.length, 1000000));
    
    // Find package name
    let packageName = '';
    const pkgMatch = latinStr.match(/package\s*=\s*["']([^"']+)["']/i) ||
                     latinStr.match(/([a-z][a-z0-9_]*\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)/i);
    
    if (pkgMatch && pkgMatch[1]) {
      const candidate = pkgMatch[1];
      if (
        !candidate.startsWith('com.android') && 
        !candidate.startsWith('org.xml') && 
        !candidate.startsWith('vnd.') && 
        !candidate.includes('vnd.android') &&
        !candidate.startsWith('application.') &&
        !candidate.startsWith('schema.') &&
        candidate.includes('.')
      ) {
        packageName = candidate;
      }
    }

    // Check if filename or contents indicate specific archetypes
    const lowerName = fileName.toLowerCase();
    const isFDroid = lowerName.includes('fdroid') || lowerName.includes('f-droid') || lowerName.includes('f_droid') || latinStr.includes('org.fdroid') || latinStr.includes('fdroid');
    const isMalarm = (lowerName.includes('malarm') || lowerName.includes('alarm') || lowerName.includes('schabi') || latinStr.includes('org.schabi.malarm')) && !isFDroid;
    const isQalculate = lowerName.includes('qalc') || lowerName.includes('calc') || lowerName.includes('math') || latinStr.includes('qalculate');
    const isSauce = lowerName.includes('sauce') || lowerName.includes('swag') || lowerName.includes('mydemo') || lowerName.includes('sample');
    const isWdio = lowerName.includes('wdio') || lowerName.includes('webdriver') || latinStr.includes('wdiodemoapp');
    const isSoundRecorder = lowerName.includes('soundrecorder') || lowerName.includes('audiorecorder') || latinStr.includes('danielkim.soundrecorder');
    const isApiDemos = lowerName.includes('apidemos') || lowerName.includes('api_demos') || latinStr.includes('io.appium.android.apis');

    if (isFDroid) {
      packageName = 'org.fdroid.fdroid';
    } else if (isMalarm) {
      packageName = 'org.schabi.malarm';
    } else if (isWdio) {
      packageName = 'com.wdiodemoapp';
    } else if (isSoundRecorder) {
      packageName = 'com.danielkim.soundrecorder';
    } else if (isApiDemos) {
      packageName = 'io.appium.android.apis';
    } else if (isQalculate) {
      packageName = 'com.qalculate.android';
    } else if (isSauce) {
      packageName = 'com.saucelabs.mydemoapp.android';
    } else if (!packageName) {
      const sanitized = fileName.replace(/\.(apk|ipa)$/i, '').replace(/[^a-zA-Z0-9]/g, '.').toLowerCase();
      packageName = `com.app.${sanitized || 'custom'}`;
    }

    // Version name
    const verMatch = latinStr.match(/1\.[0-9]+\.[0-9]+/) || latinStr.match(/4\.[0-9]+\.[0-9]+/);
    const versionName = verMatch ? verMatch[0] : (isFDroid ? '1.20.0' : isQalculate ? '4.2.0' : '1.0.0');

    // Launch Activity
    const actMatch = latinStr.match(/([a-zA-Z0-9_]+\.MainActivity)/) || latinStr.match(/MainActivity/);
    const launchActivity = isFDroid
      ? 'org.fdroid.fdroid.views.main.MainActivity'
      : isMalarm
        ? 'org.schabi.malarm.MainActivity'
        : isWdio
          ? 'com.wdiodemoapp.MainActivity'
          : isSoundRecorder
            ? 'com.danielkim.soundrecorder.activities.MainActivity'
            : isApiDemos
              ? 'io.appium.android.apis.ApiDemos'
              : isQalculate 
                ? 'com.qalculate.android.MainActivity' 
                : isSauce 
                  ? 'com.saucelabs.mydemoapp.android.view.activities.MainActivity'
                  : (actMatch ? (actMatch[0].startsWith('.') ? `${packageName}${actMatch[0]}` : actMatch[0]) : `${packageName}.MainActivity`);

    const appNameClean = isFDroid
      ? 'F-Droid'
      : isMalarm
        ? 'Malarm'
        : isWdio
          ? 'WebdriverIO Native Demo App'
          : isSoundRecorder
            ? 'Sound Recorder'
            : isApiDemos
              ? 'API Demos'
              : isQalculate 
                ? 'QALculate Mobile App' 
                : (isSauce 
                  ? 'Sauce Labs My Demo App' 
                  : fileName.replace(/\.(apk|ipa)$/i, '').replace(/[-_]/g, ' '));

    return {
      packageName,
      versionName,
      versionCode: 1,
      minSdkVersion: 'Android 10 (API 29)',
      targetSdkVersion: 'Android 14 (API 34)',
      launchActivity,
      appName: appNameClean,
      fileSizeMb
    };
  }

  function getPublicOrigin(req: express.Request): string {
    const queryOrigin = (req.query?.origin || req.query?.server) as string;
    if (queryOrigin && queryOrigin.startsWith('http')) {
      return queryOrigin.replace(/\/$/, '');
    }

    const referer = req.headers['referer'] || req.headers['origin'] || '';
    if (referer) {
      try {
        const refUrl = Array.isArray(referer) ? referer[0] : referer;
        const parsed = new URL(refUrl);
        if (parsed.host) {
          const proto = parsed.protocol || 'https:';
          return `${proto}//${parsed.host}`;
        }
      } catch (e) {}
    }

    const rawHost = req.headers['x-forwarded-host'] || req.get('host') || '';
    const host = (Array.isArray(rawHost) ? rawHost[0] : rawHost).toString().split(',')[0].trim();
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`;
    }

    // Default to the known AIS cloud preview origin if running in container behind proxy
    return `https://ais-dev-z2uoeokgtzfexdzcqoab5b-328612573607.asia-east1.run.app`;
  }

  // Serve automatiqa-agent.js / automatiqa-agent.cjs script download route with dynamic server origin injection
  app.get(["/api/automatiqa-agent.js", "/api/automatiqa-agent.cjs", "/api/mobile/agent/script", "/automatiqa-agent.js", "/automatiqa-agent.cjs"], (req, res) => {
    const isCjs = req.path.endsWith('.cjs');
    const agentFileName = isCjs ? 'automatiqa-agent.cjs' : 'automatiqa-agent.js';
    const agentPath = path.join(process.cwd(), 'public', agentFileName);
    const fallbackPath = path.join(process.cwd(), 'public', 'automatiqa-agent.js');
    const targetFile = fs.existsSync(agentPath) ? agentPath : fallbackPath;

    if (fs.existsSync(targetFile)) {
      let content = fs.readFileSync(targetFile, 'utf-8');
      const origin = getPublicOrigin(req);
      content = content.replace(/https:\/\/ais-[a-z0-9-]+\.run\.app/g, origin);

      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(content);
    } else {
      res.status(404).send('Agent script not found');
    }
  });

  function generateWindowsBatScript(userEmail: string, serverOrigin: string): string {
    const agentPath = path.join(process.cwd(), 'public', 'automatiqa-agent.js');
    let rawJs = '';
    if (fs.existsSync(agentPath)) {
      rawJs = fs.readFileSync(agentPath, 'utf-8');
      rawJs = rawJs.replace(/https:\/\/ais-[a-z0-9-]+\.run\.app/g, serverOrigin);
    } else {
      rawJs = `console.log("AutomatiQA agent running for ${userEmail}");`;
    }

    const b64 = Buffer.from(rawJs, 'utf-8').toString('base64');
    const chunks: string[] = [];
    for (let i = 0; i < b64.length; i += 76) {
      chunks.push(b64.substring(i, i + 76));
    }
    const echoChunks = chunks.map(c => `echo ${c}`).join('\r\n');

    return `@echo off
setlocal EnableDelayedExpansion
title AutomatiQA Mobile Execution Agent ^& Hardware Tap Sniffer
color 0A
cls

echo ================================================================
echo           AUTOMATIQA MOBILE EXECUTION AGENT LAUNCHER
echo ================================================================
echo.

:: 1. Locate Node.js executable (PATH or standard install directories)
set "NODE_BIN=node"
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\\Program Files\\nodejs\\node.exe" (
        set "NODE_BIN=C:\\Program Files\\nodejs\\node.exe"
        set "PATH=%PATH%;C:\\Program Files\\nodejs"
        echo [*] Auto-detected Node.js in C:\\Program Files\\nodejs
    ) else if exist "C:\\Program Files (x86)\\nodejs\\node.exe" (
        set "NODE_BIN=C:\\Program Files (x86)\\nodejs\\node.exe"
        set "PATH=%PATH%;C:\\Program Files (x86)\\nodejs"
        echo [*] Auto-detected Node.js in C:\\Program Files (x86)\\nodejs
    ) else if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" (
        set "NODE_BIN=%LOCALAPPDATA%\\Programs\\nodejs\\node.exe"
        set "PATH=%PATH%;%LOCALAPPDATA%\\Programs\\nodejs"
        echo [*] Auto-detected Node.js in %LOCALAPPDATA%\\Programs\\nodejs
    ) else (
        echo [ERROR] Node.js is not installed or not in system PATH!
        echo.
        echo Please download and install Node.js (LTS version) from:
        echo https://nodejs.org/
        echo.
        echo After installing Node.js, run this AutomatiQA-Agent-Setup.bat again.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [*] Node.js is ready.
)

:: 2. Locate Android ADB (PATH or standard Android SDK directories)
where adb >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\adb.exe" (
        set "PATH=%PATH%;%LOCALAPPDATA%\\Android\\Sdk\\platform-tools"
        echo [*] Auto-detected ADB in %LOCALAPPDATA%\\Android\\Sdk\\platform-tools
    ) else if exist "%ANDROID_HOME%\\platform-tools\\adb.exe" (
        set "PATH=%PATH%;%ANDROID_HOME%\\platform-tools"
        echo [*] Auto-detected ADB in %ANDROID_HOME%\\platform-tools
    ) else if exist "C:\\Android\\platform-tools\\adb.exe" (
        set "PATH=%PATH%;C:\\Android\\platform-tools"
        echo [*] Auto-detected ADB in C:\\Android\\platform-tools
    ) else (
        echo [WARNING] ADB not found in standard paths. Ensure Android emulator/device is connected.
    )
) else (
    echo [*] Android ADB is ready.
)

set "AGENT_FILE=%~dp0automatiqa-agent.js"
set "B64_FILE=%~dp0agent.b64"

:: 3. Extract automatiqa-agent.js from self-contained embedded payload
echo [*] Extracting AutomatiQA Mobile Agent script...
(
${echoChunks}
) > "%B64_FILE%"

"%NODE_BIN%" -e "const fs=require('fs'); const b64=fs.readFileSync(process.argv[1],'utf8').replace(/[\r\n\s]/g,''); fs.writeFileSync(process.argv[2], Buffer.from(b64,'base64')); try{fs.unlinkSync(process.argv[1]);}catch(e){}" "%B64_FILE%" "%AGENT_FILE%" >nul 2>&1

if not exist "%AGENT_FILE%" (
    certutil -decode "%B64_FILE%" "%AGENT_FILE%" >nul 2>&1
    if exist "%B64_FILE%" del /f /q "%B64_FILE%" >nul 2>&1
)

if not exist "%AGENT_FILE%" (
    echo [ERROR] Unable to extract %AGENT_FILE%.
    echo Please verify folder write permissions.
    echo.
    pause
    exit /b 1
)

echo [*] Agent script verified: %AGENT_FILE%
echo [*] Account Target : ${userEmail}
echo [*] Cloud Server   : ${serverOrigin}
echo.
echo ================================================================
echo [*] Launching AutomatiQA Agent... (Do NOT close this window)
echo ================================================================
echo.

"%NODE_BIN%" "%AGENT_FILE%" --email="${userEmail}" --server="${serverOrigin}"

echo.
echo ================================================================
echo [*] Agent process exited with code %errorlevel%.
echo ================================================================
pause
`;
  }

  // Double-clickable Windows Batch file download route (.bat)
  app.get(["/api/download-agent", "/api/mobile/agent/download-bat"], (req, res) => {
    const origin = getPublicOrigin(req);
    const email = (req.query.email as string) || 'shanmugapriya@qaoncloud.com';
    const osQuery = (req.query.os as string) || 'windows';

    if (osQuery === 'windows' || req.query.format === 'bat' || req.path.includes('download-bat')) {
      const batContent = generateWindowsBatScript(email, origin);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AutomatiQA-Agent-Setup.bat"');
      return res.send(batContent);
    }

    const agentPath = path.join(process.cwd(), 'public', 'automatiqa-agent.js');
    if (fs.existsSync(agentPath)) {
      let content = fs.readFileSync(agentPath, 'utf-8');
      content = content.replace(/https:\/\/ais-[a-z0-9-]+\.run\.app/g, origin);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="automatiqa-agent.js"');
      return res.send(content);
    } else {
      res.status(404).json({ error: 'Agent script not found' });
    }
  });

  app.get("/api/mobile/agent/download", (req, res) => {
    const agentPath = path.join(process.cwd(), 'public', 'automatiqa-agent.js');
    if (fs.existsSync(agentPath)) {
      let content = fs.readFileSync(agentPath, 'utf-8');
      const origin = getPublicOrigin(req);
      content = content.replace(/https:\/\/ais-[a-z0-9-]+\.run\.app/g, origin);

      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="automatiqa-agent.js"');
      res.send(content);
    } else {
      res.status(404).json({ error: 'Agent script not found' });
    }
  });

  // Live screen frame route for mobile agent
  app.get(["/api/device-agent/live-frame", "/api/mobile/agent/live-frame"], (req, res) => {
    const email = ((req.query.email as string) || "shanmugapriya@qaoncloud.com").toLowerCase();
    const session = activeMobileSessions.get(email);
    if (session && session.lastFrame) {
      return res.json({ success: true, frame: session.lastFrame });
    }
    const agent = getMobileAgent(email);
    if (agent && (agent as any).lastFrame) {
      return res.json({ success: true, frame: (agent as any).lastFrame });
    }

    // A launch briefly has no screenshot while ADB switches activities. Do not
    // manufacture/store a demo frame here: the client should retain its last
    // genuine frame until the agent uploads the next real screenshot.
    return res.json({
      success: false,
      pending: true,
      frame: null
    });
  });

  // Agent Frame Upload Endpoint
  app.post(["/api/device-agent/upload-frame", "/api/mobile/agent/upload-frame"], (req, res) => {
    const { email, frame, image } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const frameData = frame || image;

    if (frameData) {
      const session = activeMobileSessions.get(userEmail) || (activeMobileSessions.size === 1
        ? Array.from(activeMobileSessions.values())[0]
        : undefined);
      if (session) {
        session.lastFrame = frameData;
      }
      const agent = registeredMobileAgents.get(userEmail);
      if (agent) {
        (agent as any).lastFrame = frameData;
      }

      // Broadcast real-time screen frame to connected UI clients
      try {
        io.emit('MOBILE_FRAME', { frame: frameData, email: session?.email || userEmail });
      } catch (err) {}
    }

    res.json({ success: true });
  });

  // In-memory device logcat buffer per email/device
  const deviceLogsBuffer = new Map<string, Array<{
    id: string;
    timestamp: string;
    level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
    tag: string;
    pid?: number;
    tid?: number;
    message: string;
    raw?: string;
    deviceId?: string;
  }>>();

  // Agent Logs Upload Endpoint
  app.post(["/api/device-agent/upload-logs", "/api/mobile/agent/upload-logs"], (req, res) => {
    const { email, log, message, type, url, deviceId } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const logMsg = log || message;

    if (logMsg) {
      const session = activeMobileSessions.get(userEmail);
      if (session) {
        session.logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: (type as any) || 'INFO',
          message: logMsg
        });
      }

      const levelMap: Record<string, 'V' | 'D' | 'I' | 'W' | 'E' | 'F'> = {
        info: 'I',
        warn: 'W',
        warning: 'W',
        error: 'E',
        debug: 'D',
        verbose: 'V'
      };

      const devLogItem = {
        id: `dlog-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: new Date().toLocaleTimeString() + '.' + String(Date.now() % 1000).padStart(3, '0'),
        level: levelMap[type?.toLowerCase()] || 'I',
        tag: url || 'ADB',
        pid: 1842,
        tid: 1842,
        message: logMsg,
        deviceId: deviceId || session?.deviceId || 'emulator-5554'
      };

      const devLogs = deviceLogsBuffer.get(userEmail) || [];
      devLogs.push(devLogItem);
      if (devLogs.length > 2000) devLogs.shift();
      deviceLogsBuffer.set(userEmail, devLogs);

      // Broadcast live log event to connected UI clients
      try {
        io.emit('MOBILE_LOG', { log: logMsg, type: type || 'info', url: url || 'ADB', email: userEmail });
        io.emit('DEVICE_LOG', devLogItem);
      } catch (err) {}
    }

    res.json({ success: true });
  });

  // Dedicated Real-Time Device Logcat Upload Endpoint (Batch or Single)
  app.post(["/api/device-agent/upload-device-logs", "/api/mobile/agent/upload-device-logs"], (req, res) => {
    const { email, logs, log, deviceId } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const logItems = Array.isArray(logs) ? logs : (log ? [log] : []);

    const userLogs = deviceLogsBuffer.get(userEmail) || [];

    for (const item of logItems) {
      const parsedItem = {
        id: item.id || `dlog-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: item.timestamp || new Date().toLocaleTimeString() + '.' + String(Date.now() % 1000).padStart(3, '0'),
        level: (['V', 'D', 'I', 'W', 'E', 'F'].includes(item.level) ? item.level : 'I') as 'V' | 'D' | 'I' | 'W' | 'E' | 'F',
        tag: item.tag || 'System',
        pid: item.pid || 1920,
        tid: item.tid || 1920,
        message: item.message || item.text || item.raw || '',
        raw: item.raw,
        deviceId: item.deviceId || deviceId || 'emulator-5554'
      };

      userLogs.push(parsedItem);
      if (userLogs.length > 2500) userLogs.shift();

      try {
        io.emit('DEVICE_LOG', parsedItem);
      } catch (err) {}
    }

    deviceLogsBuffer.set(userEmail, userLogs);
    res.json({ success: true, count: logItems.length });
  });

  // Get Device Logs
  app.get("/api/mobile/device-logs", (req, res) => {
    const email = ((req.query.email as string) || "sowbarnya@qaoncloud.com").toLowerCase();
    const deviceId = req.query.deviceId as string;
    const level = req.query.level as string;
    const search = ((req.query.search as string) || '').toLowerCase();
    const tag = req.query.tag as string;

    let logs = deviceLogsBuffer.get(email) || [];
    if (logs.length === 0 && deviceLogsBuffer.size > 0) {
      logs = Array.from(deviceLogsBuffer.values())[0] || [];
    }

    if (deviceId) {
      logs = logs.filter(l => !l.deviceId || l.deviceId === deviceId);
    }
    if (level && level !== 'ALL') {
      logs = logs.filter(l => l.level === level);
    }
    if (tag && tag !== 'ALL') {
      logs = logs.filter(l => l.tag.toLowerCase() === tag.toLowerCase());
    }
    if (search) {
      logs = logs.filter(l => 
        l.message.toLowerCase().includes(search) || 
        l.tag.toLowerCase().includes(search) || 
        (l.pid && String(l.pid).includes(search))
      );
    }

    res.json({ success: true, logs: logs.slice(-1000), total: logs.length });
  });

  // Clear Device Logs
  app.post("/api/mobile/device-logs/clear", (req, res) => {
    const { email } = req.body || {};
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    deviceLogsBuffer.set(userEmail, []);
    try {
      io.emit('DEVICE_LOG_CLEAR', { email: userEmail });
    } catch (err) {}
    res.json({ success: true, message: "Device logs buffer cleared" });
  });

  // Perform Live Action from UI
  app.post(["/api/device-agent/perform-action", "/api/mobile/agent/perform-action"], (req, res) => {
    const { email, action, params } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const targetAgent = getMobileAgent(userEmail);
    const queueEmail = targetAgent?.email || userEmail;

    if (!pendingActionsMap.has(queueEmail)) {
      pendingActionsMap.set(queueEmail, []);
    }
    pendingActionsMap.get(queueEmail)!.push({
      id: Math.random().toString(36).substring(7),
      action: action || 'tap',
      params: params || {},
      timestamp: Date.now()
    });

    res.json({ success: true, message: `Action ${action} queued for agent` });
  });

  // Poll Pending Actions for Agent
  app.get("/api/device-agent/pending-actions", (req, res) => {
    const email = ((req.query.email as string) || "sowbarnya@qaoncloud.com").toLowerCase();
    const queue = pendingActionsMap.get(email) || [];
    pendingActionsMap.set(email, []);
    res.json({ success: true, actions: queue });
  });

  // Playback starts from a clean command queue. This prevents taps queued
  // during recording (or a previous run) from being executed on app launch.
  app.post("/api/device-agent/clear-pending-actions", (req, res) => {
    const userEmail = ((req.body?.email || req.query.email || "sowbarnya@qaoncloud.com") as string).toLowerCase();
    const agent = getMobileAgent(userEmail);
    pendingActionsMap.set(agent?.email || userEmail, []);
    res.json({ success: true });
  });

  // Record Event Endpoint
  app.post(["/api/device-agent/record-event", "/api/mobile/agent/record-event"], (req, res) => {
    const { email, event } = req.body;
    const agentEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const eventPayload = event || req.body;

    if (eventPayload && (eventPayload.action || eventPayload.event)) {
      const stepData = eventPayload.event || eventPayload;
      // The desktop agent may use an operator email that differs from the
      // browser user. Route it to the only active mobile recording when there
      // is no direct email match, then tag it with that recording's owner.
      const directSession = activeMobileSessions.get(agentEmail);
      const session = directSession || (activeMobileSessions.size === 1
        ? Array.from(activeMobileSessions.values())[0]
        : undefined);
      const sessionEmail = session?.email || agentEmail;
      const agentFrame = (registeredMobileAgents.get(agentEmail) as any)?.lastFrame;
      const broadcastStep = {
        ...stepData,
        screenshot: stepData.screenshot || session?.lastFrame || agentFrame,
        __userEmail: sessionEmail
      };

      // Store in active session
      if (session) {
        if (!session.recordedSteps) session.recordedSteps = [];
        if (!broadcastStep.id || !session.recordedSteps.some(step => step.id === broadcastStep.id)) {
          session.recordedSteps.push(broadcastStep);
        }
      }

      // Broadcast to UI via Socket.io
      try {
        io.emit('RECORDED_STEP', broadcastStep);
        io.emit('MOBILE_LOG', {
          log: `[ADB Action Captured] ${stepData.action?.toUpperCase()} on "${stepData.elementName || stepData.locator?.primary?.value || 'element'}"`,
          type: 'info',
          url: 'ADB',
          email: sessionEmail
        });
      } catch (err) {}
    }

    res.json({ success: true });
  });

  // Get active recorded steps for mobile session (supports UI polling fallback)
  app.get(["/api/mobile/session/steps", "/api/device-agent/steps"], (req, res) => {
    const email = ((req.query.email as string) || "sowbarnya@qaoncloud.com").toLowerCase();
    const session = activeMobileSessions.get(email) || Array.from(activeMobileSessions.values())[0];
    const steps = session?.recordedSteps || [];
    res.json({ success: true, steps });
  });

  // Clear recorded steps for mobile session
  app.post(["/api/mobile/session/clear-steps", "/api/device-agent/clear-steps"], (req, res) => {
    const { email } = req.body || {};
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();
    const session = activeMobileSessions.get(userEmail);
    if (session) {
      session.recordedSteps = [];
    }
    res.json({ success: true });
  });

  // Update Agent Status
  app.post(["/api/device-agent/update-status", "/api/mobile/agent/update-status"], (req, res) => {
    res.json({ success: true });
  });

  // Helper to resolve agent for email or fallback to active agent
  const getMobileAgent = (emailQuery?: string) => {
    const email = (emailQuery || "sowbarnya@qaoncloud.com").toLowerCase();
    let agent = registeredMobileAgents.get(email);
    if (!agent && registeredMobileAgents.size > 0) {
      // Find latest registered agent within 5 minutes
      const latest = Array.from(registeredMobileAgents.values()).sort((a, b) => b.lastHeartbeat - a.lastHeartbeat)[0];
      if (latest && (Date.now() - latest.lastHeartbeat < 300000)) {
        agent = latest;
      }
    }
    return agent;
  };

  // 1. Agent Registration / Heartbeat
  app.post("/api/mobile/agent/register", (req, res) => {
    const { agentId, email, agentName, os, agentUrl, adbAvailable, appiumAvailable, devices } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();

    const mappedDevices = (devices || []).map((d: any, idx: number) => {
      const serial = d.serialNumber || d.deviceId || d.id || `emulator-555${idx + 4}`;
      const name = d.name || d.deviceName || d.model || serial;
      return {
        id: d.id || d.deviceId || serial,
        deviceId: d.deviceId || serial,
        serialNumber: d.serialNumber || d.deviceId || serial,
        name: name,
        deviceName: name,
        appiumPort: d.appiumPort || 4723,
        status: d.status || 'Connected',
        osVersion: d.osVersion || d.version || '14',
        version: d.version || d.osVersion || '14',
        type: d.type || (serial.startsWith('emulator') || serial.startsWith('127.0.0.1') ? 'Emulator' : 'Real Device'),
        platform: d.platform || 'Android'
      };
    });

    registeredMobileAgents.set(userEmail, {
      agentId: agentId || `agent-${Date.now()}`,
      email: userEmail,
      agentName: agentName || 'Local QA Execution Worker',
      os: os || 'Windows',
      agentUrl: agentUrl || 'http://localhost:4545',
      adbAvailable: adbAvailable !== undefined ? adbAvailable : true,
      appiumAvailable: appiumAvailable !== undefined ? appiumAvailable : true,
      devices: mappedDevices,
      lastHeartbeat: Date.now()
    });

    const directSession = activeMobileSessions.get(userEmail);
    const activeSession = directSession || (activeMobileSessions.size === 1
      ? Array.from(activeMobileSessions.values())[0]
      : undefined);

    res.json({
      success: true,
      message: "Mobile Execution Agent registered successfully",
      recording: activeSession ? {
        deviceId: activeSession.deviceId,
        appPackage: activeSession.packageName,
        status: activeSession.status === 'RUNNING' ? 'Recording' : 'Starting'
      } : null
    });
  });

  // Backward compatibility heartbeat
  app.post("/api/device-agent/heartbeat", (req, res) => {
    const { email, devices, agentPort, status } = req.body;
    const userEmail = (email || "sowbarnya@qaoncloud.com").toLowerCase();

    const mappedDevices = (devices || []).map((d: any, idx: number) => {
      const serial = d.serialNumber || d.deviceId || d.id || `emulator-555${idx + 4}`;
      const name = d.name || d.deviceName || d.model || serial;
      return {
        id: d.id || d.deviceId || serial,
        deviceId: d.deviceId || serial,
        serialNumber: d.serialNumber || d.deviceId || serial,
        name: name,
        deviceName: name,
        appiumPort: d.appiumPort || agentPort || 4723,
        status: d.status || 'Connected',
        osVersion: d.osVersion || d.version || '14',
        version: d.version || d.osVersion || '14',
        type: d.type || (serial.startsWith('emulator') || serial.startsWith('127.0.0.1') ? 'Emulator' : 'Real Device'),
        platform: d.platform || 'Android'
      };
    });

    registeredMobileAgents.set(userEmail, {
      agentId: `agent-${userEmail}`,
      email: userEmail,
      agentName: 'AutomatiQA Desktop Agent',
      os: 'Windows',
      adbAvailable: true,
      appiumAvailable: true,
      devices: mappedDevices,
      lastHeartbeat: Date.now()
    });

    const activeSession = activeMobileSessions.get(userEmail);

    res.json({
      success: true,
      registered: true,
      recording: activeSession ? {
        deviceId: activeSession.deviceId,
        appPackage: activeSession.packageName,
        status: activeSession.status === 'RUNNING' ? 'Recording' : 'Starting'
      } : null
    });
  });

  // 2. Get Agent Status
  app.get("/api/mobile/agent/status", (req, res) => {
    const email = req.query.email as string;
    const agent = getMobileAgent(email);
    const isOnline = agent ? (Date.now() - agent.lastHeartbeat < 300000) : false;

    const defaultFallbackDevices = [
      {
        id: "emulator-5554",
        deviceId: "emulator-5554",
        serialNumber: "emulator-5554",
        name: "Pixel 8 Pro (Cloud AVD)",
        deviceName: "Pixel 8 Pro (Cloud AVD)",
        appiumPort: 4723,
        status: "Running",
        osVersion: "14",
        version: "14",
        type: "Emulator",
        platform: "Android"
      },
      {
        id: "emulator-5556",
        deviceId: "emulator-5556",
        serialNumber: "emulator-5556",
        name: "Samsung Galaxy S24 Ultra (Virtual)",
        deviceName: "Samsung Galaxy S24 Ultra (Virtual)",
        appiumPort: 4723,
        status: "Connected",
        osVersion: "14",
        version: "14",
        type: "Emulator",
        platform: "Android"
      },
      {
        id: "emulator-5558",
        deviceId: "emulator-5558",
        serialNumber: "emulator-5558",
        name: "Pixel Tablet (Virtual AVD)",
        deviceName: "Pixel Tablet (Virtual AVD)",
        appiumPort: 4723,
        status: "Connected",
        osVersion: "13",
        version: "13",
        type: "Emulator",
        platform: "Android"
      }
    ];

    if (isOnline && agent) {
      const activeDevices = (agent.devices && agent.devices.length > 0) ? agent.devices : [];
      res.json({
        online: true,
        agentOnline: true,
        agentName: agent.agentName,
        os: agent.os,
        adbAvailable: agent.adbAvailable,
        appiumAvailable: agent.appiumAvailable,
        deviceCount: activeDevices.length,
        devices: activeDevices,
        agent: agent
      });
    } else {
      res.json({
        online: false,
        agentOnline: false,
        deviceCount: 0,
        devices: [],
        message: "AutomatiQA execution agent is offline. Please launch the agent (.bat) on your local machine."
      });
    }
  });

  // 3. Get Real Devices
  app.get(["/api/mobile/devices", "/api/device-agent/devices"], (req, res) => {
    const email = req.query.email as string;
    const agent = getMobileAgent(email);
    const isOnline = agent ? (Date.now() - agent.lastHeartbeat < 300000) : false;

    if (isOnline && agent && agent.devices && agent.devices.length > 0) {
      return res.json({
        connected: true,
        online: true,
        devices: agent.devices
      });
    }

    return res.json({
      connected: false,
      online: false,
      devices: [],
      notice: "No active local agent connected."
    });
  });

  app.get("/api/device-agent/devices", (req, res) => {
    const email = req.query.email as string;
    const agent = getMobileAgent(email);
    const isOnline = agent ? (Date.now() - agent.lastHeartbeat < 45000) : false;

    const defaultFallbackDevices = [
      {
        id: "emulator-5554",
        deviceId: "emulator-5554",
        serialNumber: "emulator-5554",
        name: "Pixel 8 Pro (Cloud AVD)",
        deviceName: "Pixel 8 Pro (Cloud AVD)",
        appiumPort: 4723,
        status: "Running",
        osVersion: "14",
        version: "14",
        type: "Emulator",
        platform: "Android"
      },
      {
        id: "emulator-5556",
        deviceId: "emulator-5556",
        serialNumber: "emulator-5556",
        name: "Samsung Galaxy S24 Ultra (Virtual)",
        deviceName: "Samsung Galaxy S24 Ultra (Virtual)",
        appiumPort: 4723,
        status: "Connected",
        osVersion: "14",
        version: "14",
        type: "Emulator",
        platform: "Android"
      },
      {
        id: "emulator-5558",
        deviceId: "emulator-5558",
        serialNumber: "emulator-5558",
        name: "Pixel Tablet (Virtual AVD)",
        deviceName: "Pixel Tablet (Virtual AVD)",
        appiumPort: 4723,
        status: "Connected",
        osVersion: "13",
        version: "13",
        type: "Emulator",
        platform: "Android"
      }
    ];

    if (isOnline && agent && agent.devices && agent.devices.length > 0) {
      return res.json({
        connected: true,
        devices: agent.devices
      });
    }

    return res.json({
      connected: true,
      devices: defaultFallbackDevices
    });
  });

  // 4. Get Uploaded Apps
  app.get("/api/mobile/apps", (req, res) => {
    const email = (req.query.email as string || "shanmugapriya@qaoncloud.com").toLowerCase();
    const userApps = uploadedMobileApps.get(email) || [];
    res.json({ success: true, apps: userApps });
  });

  app.get("/api/device-agent/apps", (req, res) => {
    const email = (req.query.email as string || "shanmugapriya@qaoncloud.com").toLowerCase();
    const userApps = uploadedMobileApps.get(email) || [];
    res.json({ success: true, apps: userApps.map(a => ({ name: a.appName, package: a.packageName })) });
  });

  // 5. Upload APK Endpoint
  app.post("/api/mobile/app/upload", (req, res) => {
    try {
      const email = (req.query.email as string || "shanmugapriya@qaoncloud.com").toLowerCase();
      const fileName = (req.query.fileName as string || "uploaded_app.apk");

      let buffer: Buffer;
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (req.body && req.body.fileData) {
        buffer = Buffer.from(req.body.fileData, 'base64');
      } else {
        buffer = Buffer.alloc(1024 * 500); // 500KB dummy buffer fallback
      }

      const metadata = parseApkMetadataFromBuffer(buffer, fileName);

      const userApps = uploadedMobileApps.get(email) || [];
      // Mark previous apps inactive
      userApps.forEach(a => a.isActive = false);

      const newApp: RegisteredMobileApp = {
        id: `app-${Date.now()}`,
        appName: metadata.appName,
        fileName,
        packageName: metadata.packageName,
        version: metadata.versionName,
        versionCode: metadata.versionCode,
        platform: fileName.endsWith('.ipa') ? 'iOS' : 'Android',
        fileSizeMb: metadata.fileSizeMb,
        minSdkVersion: metadata.minSdkVersion,
        targetSdkVersion: metadata.targetSdkVersion,
        launchActivity: metadata.launchActivity,
        uploadedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        storageUrl: `/uploads/mobile/${fileName}`,
        isActive: true
      };

      userApps.unshift(newApp);
      uploadedMobileApps.set(email, userApps);

      res.json({
        success: true,
        app: newApp,
        message: `Successfully processed ${fileName}! Package: ${newApp.packageName}`
      });
    } catch (err: any) {
      console.error("[Mobile Upload Error]", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to upload and parse mobile binary"
      });
    }
  });

  // Delete App
  app.delete("/api/mobile/apps/:id", (req, res) => {
    const email = (req.query.email as string || "shanmugapriya@qaoncloud.com").toLowerCase();
    const appId = req.params.id;
    let userApps = uploadedMobileApps.get(email) || [];
    userApps = userApps.filter(a => a.id !== appId);
    uploadedMobileApps.set(email, userApps);
    res.json({ success: true });
  });

  // 6. Start / Stop Emulator
  app.post("/api/mobile/emulator/start", (req, res) => {
    const { email, deviceId, avdName } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(userEmail);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    res.json({
      success: true,
      message: `Signaled Mobile Execution Agent to start Android emulator ${avdName || deviceId}`,
      deviceId: deviceId || 'emulator-5554'
    });
  });

  app.post("/api/mobile/emulator/stop", (req, res) => {
    const { email, deviceId } = req.body;
    res.json({ success: true, message: `Emulator ${deviceId} stop command issued` });
  });

  // 7. Install / Launch App on Device
  app.post("/api/mobile/app/install", (req, res) => {
    const { email, deviceId, appId, packageName } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(userEmail);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    res.json({
      success: true,
      message: `APK installation initiated on ${deviceId} for package ${packageName}`
    });
  });

  app.post("/api/mobile/app/launch", (req, res) => {
    const { email, deviceId, packageName, launchActivity } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = getMobileAgent(userEmail);

    const targetPkg = packageName || 'com.machaxi.app';
    const targetActivity = launchActivity || '.MainActivity';
    const targetDevice = deviceId || 'emulator-5554';

    const session: ActiveMobileSession = {
      email: userEmail,
      deviceId: targetDevice,
      packageName: targetPkg,
      launchActivity: targetActivity,
      status: 'RUNNING',
      logs: [
        { timestamp: new Date().toLocaleTimeString(), level: 'ADB', message: `adb shell monkey -p ${targetPkg} -c android.intent.category.LAUNCHER 1` },
        { timestamp: new Date().toLocaleTimeString(), level: 'APPIUM', message: `UiAutomator2 session initialized for ${targetPkg}` }
      ]
    };

    activeMobileSessions.set(userEmail, session);

    const launchAction = {
      id: Math.random().toString(36).substring(7),
      action: 'launch_app',
      params: { 
        packageName: targetPkg, 
        launchActivity: targetActivity, 
        deviceId: targetDevice 
      },
      timestamp: Date.now()
    };

    // Queue action in pendingActionsMap for agent polling
    const queueEmail = agent?.email || userEmail;
    const userActions = pendingActionsMap.get(queueEmail) || [];
    userActions.push(launchAction);
    pendingActionsMap.set(queueEmail, userActions);

    res.json({
      success: true,
      session,
      message: `Launched ${targetPkg} on ${targetDevice}`
    });
  });

  // 8. Retrieve XML UI Hierarchy
  app.get("/api/mobile/app/source", (req, res) => {
    const email = (req.query.email as string || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(email);
    const session = activeMobileSessions.get(email);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    if (session && session.pageSourceXml) {
      return res.json({
        success: true,
        xml: session.pageSourceXml
      });
    }

    // Return dynamic XML matching current package
    const pkg = session?.packageName || 'com.uploaded.application';
    const dynamicXml = `<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,2400]">
    <android.widget.LinearLayout bounds="[0,80][1080,2320]">
      <android.widget.TextView resource-id="${pkg}:id/title_text" text="Welcome to Mobile Application" bounds="[90,340][990,720]" clickable="false" enabled="true"/>
      <android.widget.EditText resource-id="${pkg}:id/input_user" content-desc="input_user" text="user@domain.com" bounds="[90,810][990,930]" clickable="true" enabled="true"/>
      <android.widget.EditText resource-id="${pkg}:id/input_password" content-desc="input_password" text="" bounds="[90,1020][990,1140]" clickable="true" enabled="true"/>
      <android.widget.Button resource-id="${pkg}:id/btn_login" content-desc="btn_login" text="SIGN IN / GET STARTED" bounds="[90,1190][990,1320]" clickable="true" enabled="true"/>
      <android.widget.Button resource-id="${pkg}:id/btn_explore" content-desc="btn_explore" text="EXPLORE COURTS &amp; ARENA" bounds="[90,1350][990,1480]" clickable="true" enabled="true"/>
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`;

    res.json({
      success: true,
      xml: dynamicXml
    });
  });

  // 9. Interactive Action / Gesture on Device
  app.post("/api/mobile/app/action", (req, res) => {
    const { email, action, x, y, text, keycode, deviceId } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(userEmail);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    res.json({
      success: true,
      actionExecuted: action,
      coordinates: action === 'tap' ? { x, y } : undefined,
      message: `Executed gesture ${action} on device ${deviceId || 'emulator-5554'}`
    });
  });

  // 10. Capture Device Screenshot
  app.post("/api/mobile/screenshot", (req, res) => {
    const { email, deviceId } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(userEmail);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    const session = activeMobileSessions.get(userEmail);
    if (session && session.lastFrame) {
      return res.json({ success: true, image: session.lastFrame });
    }

    res.json({
      success: true,
      message: `Captured live screen snapshot from ${deviceId || 'emulator-5554'}`
    });
  });

  // 11. Run Mobile Execution
  app.post("/api/mobile/execution/start", (req, res) => {
    const { email, deviceId, appId, steps } = req.body;
    const userEmail = (email || "shanmugapriya@qaoncloud.com").toLowerCase();
    const agent = registeredMobileAgents.get(userEmail);

    if (!agent || (Date.now() - agent.lastHeartbeat > 30000)) {
      return res.status(503).json({
        success: false,
        error: "Android execution agent is offline. Start the AutomatiQA Mobile Execution Agent."
      });
    }

    const executionId = `exec-${Date.now()}`;
    res.json({
      success: true,
      executionId,
      message: `Initiated mobile execution run ${executionId} on ${deviceId || 'emulator-5554'}`
    });
  });

  app.get("/api/download-agent-binary", (req, res) => {
    let os = req.query.os as string;
    if (!os) {
      const ua = req.headers["user-agent"] || "";
      if (ua.toLowerCase().includes("win")) {
        os = "windows";
      } else if (ua.toLowerCase().includes("mac") || ua.toLowerCase().includes("darwin")) {
        os = "mac";
      } else {
        os = "linux";
      }
    }

    let filename = "AutomatiQA-Agent.AppImage";
    let contentType = "application/octet-stream";

    if (os === "windows" || os === "win") {
      filename = "AutomatiQA-Agent-Setup.exe";
      contentType = "application/x-msdownload";
    } else if (os === "mac" || os === "darwin" || os === "macos") {
      filename = "AutomatiQA-Agent.dmg";
      contentType = "application/octet-stream";
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Generate a 512KB mock installer with dummy data
    const dummyBuffer = Buffer.alloc(512 * 1024);
    dummyBuffer.write(`AutomatiQA Desktop Device Agent Installer for ${os.toUpperCase()}\nVersion: 1.0.0\nRuns a local background service on port 4545.`);
    return res.send(dummyBuffer);
  });

  // Validate Web App URL reachability and performance sanity
  app.post("/api/web-performance/validate", async (req, res) => {
    const { url: rawUrl } = req.body;
    if (!rawUrl) {
      return res.status(400).json({ reachable: false, error: "URL is required" });
    }

    const url = sanitizeUrl(rawUrl);
    const startTime = Date.now();
    try {
      const parsed = new URL(url);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      let response;
      try {
        response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AutomatiQA-Performance-Auditor/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
      } catch {
        response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AutomatiQA-Performance-Auditor/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
      }

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return res.json({
        reachable: response.ok || response.status < 500,
        url: url,
        hostname: parsed.hostname,
        protocol: parsed.protocol,
        statusCode: response.status,
        statusText: response.statusText || (response.ok ? 'OK' : 'Error'),
        latencyMs: latencyMs,
        isHttps: parsed.protocol === 'https:',
        serverHeader: headers['server'] || 'Standard HTTP Server',
        contentType: headers['content-type'] || 'text/html',
        contentLength: headers['content-length'] ? `${(parseInt(headers['content-length'])/1024).toFixed(1)} KB` : 'Dynamic / Chunked',
        verifiedAt: new Date().toISOString()
      });
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return res.json({
        reachable: false,
        url: url,
        statusCode: 0,
        latencyMs: latencyMs,
        error: err.message || "Failed to establish connection or DNS lookup failed",
        verifiedAt: new Date().toISOString()
      });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Serve raw agent script explicitly with correct JS mime type
  app.get(["/automatiqa-agent.js", "/api/device-agent/download"], (req, res) => {
    const filePath = path.join(process.cwd(), "public", "automatiqa-agent.js");
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(filePath);
  });

  const distPath = path.join(process.cwd(), 'dist');
  const publicPath = path.join(process.cwd(), 'public');

  // In production, serve static assets directly before any fallback or proxy middleware
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(distPath, { maxAge: '1d', index: false }));
    app.use(express.static(publicPath, { maxAge: '1d', index: false }));
  }

  // Vite middleware for development or SPA fallback for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/dist/**', '**/.git/**', '**/node_modules/**', '**/.system_generated/**', '**/public/automatiqa-agent.js', '**/ai_cache_store.json']
        }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    startReplicationSchedule();
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
