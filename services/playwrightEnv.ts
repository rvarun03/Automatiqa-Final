import fs from 'fs';
import path from 'path';

// Setup Playwright browsers path before any Playwright modules are loaded
export function initPlaywrightEnvironment(): void {
  try {
    const candidates = [
      '/tmp/ms-playwright',
      '/root/.cache/ms-playwright',
      '/www-data-home/.cache/ms-playwright'
    ];

    let foundPath = '';
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const files = fs.readdirSync(cand);
          if (files && files.length > 0) {
            foundPath = cand;
            break;
          }
        } catch {}
      }
    }

    if (foundPath) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = foundPath;
    } else if (fs.existsSync('/tmp/ms-playwright')) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = '/tmp/ms-playwright';
    }

    // Ensure /root/.cache symlink exists pointing to /tmp/ms-playwright if needed
    if (fs.existsSync('/tmp/ms-playwright')) {
      try {
        if (!fs.existsSync('/root/.cache')) {
          fs.mkdirSync('/root/.cache', { recursive: true });
        }
        if (!fs.existsSync('/root/.cache/ms-playwright')) {
          try {
            fs.symlinkSync('/tmp/ms-playwright', '/root/.cache/ms-playwright', 'dir');
          } catch {}
        }
      } catch {}
    }
  } catch (err) {
    // Ignore environment initialization errors gracefully
  }
}

initPlaywrightEnvironment();
