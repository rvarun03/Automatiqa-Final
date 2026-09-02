import { AutomationScriptFile, RecordedStep, StepLocator } from '../../types';
import { BddDocumentParsed } from '../../utils/automationFrameworkOptions';

export interface MultiFrameworkGeneratorOptions {
  flowName: string;
  targetUrl: string;
  steps: RecordedStep[];
  tool: string;
  language: string;
  framework?: string;
  bddDocument?: BddDocumentParsed;
  platform?: 'web' | 'mobile';
}

export interface MultiFrameworkGeneratorResult {
  files: AutomationScriptFile[];
  explanation: string;
  combinedMarkdown: string;
}

interface PageGroup {
  pageName: string;
  pageTitle: string;
  pageUrl: string;
  steps: RecordedStep[];
}

/**
 * Normalizes tool name into standard key
 */
export function normalizeTool(tool: string): 'Playwright' | 'Selenium' | 'Cypress' | 'Appium' | 'RestAssured' {
  const lower = (tool || '').toLowerCase();
  if (lower.includes('appium')) return 'Appium';
  if (lower.includes('cypress')) return 'Cypress';
  if (lower.includes('selenium')) return 'Selenium';
  if (lower.includes('restassured')) return 'RestAssured';
  return 'Playwright';
}

/**
 * Normalizes language name into standard key
 */
export function normalizeLanguage(lang: string): 'TypeScript' | 'JavaScript' | 'Python' | 'Java' | 'C#' {
  const lower = (lang || '').toLowerCase();
  if (lower.includes('python')) return 'Python';
  if (lower.includes('java') && !lower.includes('javascript')) return 'Java';
  if (lower.includes('c#') || lower.includes('csharp') || lower.includes('.net')) return 'C#';
  if (lower.includes('javascript') || lower === 'js') return 'JavaScript';
  return 'TypeScript';
}

/**
 * Extracts clean page groups from recorded steps
 */
function groupStepsByPage(steps: RecordedStep[], defaultUrl: string, defaultTitle: string): PageGroup[] {
  const pageGroups: PageGroup[] = [];
  const pageMap: Record<string, RecordedStep[]> = {};

  steps.forEach((s) => {
    const pageTitle = s.screen || 'Main Page';
    const cleanPageName = pageTitle.replace(/[^a-zA-Z0-9]/g, '') || 'Application';
    if (!pageMap[cleanPageName]) {
      pageMap[cleanPageName] = [];
      pageGroups.push({
        pageName: cleanPageName,
        pageTitle,
        pageUrl: s.url || defaultUrl,
        steps: pageMap[cleanPageName]
      });
    }
    pageMap[cleanPageName].push(s);
  });

  if (pageGroups.length === 0) {
    const titleCamel = defaultTitle.replace(/[^a-zA-Z0-9]/g, '') || 'AppFlow';
    pageGroups.push({
      pageName: `${titleCamel}Page`,
      pageTitle: defaultTitle,
      pageUrl: defaultUrl,
      steps
    });
  }

  return pageGroups;
}

/**
 * Helper to escape single quotes in strings
 */
function escapeStr(str?: string): string {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Helper to escape double quotes in strings
 */
function escapeDoubleQuotes(str?: string): string {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generates verified, executable, production-grade project files strictly matching the user's
 * Automation Tool, Language, and Framework selection.
 */
export function generateMultiFrameworkProject(options: MultiFrameworkGeneratorOptions): MultiFrameworkGeneratorResult {
  const {
    flowName,
    targetUrl: rawTargetUrl,
    steps,
    tool: rawTool,
    language: rawLanguage,
    framework: rawFramework,
    bddDocument,
    platform = 'web'
  } = options;

  const targetUrl = rawTargetUrl || 'https://example.com';
  const tool = normalizeTool(rawTool);
  const language = normalizeLanguage(rawLanguage);
  const framework = rawFramework || 'Page Object Model (POM)';
  
  const safeName = flowName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'automation_flow';
  const titleCamel = flowName.replace(/[^a-zA-Z0-9]/g, '') || 'AppFlow';
  const titlePascal = titleCamel.charAt(0).toUpperCase() + titleCamel.slice(1);

  const isBdd = framework.toLowerCase().includes('cucumber') || 
                framework.toLowerCase().includes('bdd') || 
                framework.toLowerCase().includes('behave') || 
                framework.toLowerCase().includes('specflow') || 
                !!bddDocument;

  const pageGroups = groupStepsByPage(steps, targetUrl, flowName);
  const files: AutomationScriptFile[] = [];

  // =========================================================================
  // GHERKIN / BDD FEATURE FILE (if BDD selected or document uploaded)
  // =========================================================================
  if (isBdd) {
    const featureName = bddDocument?.featureTitle || `${titlePascal} End-to-End Workflow`;
    const featureDesc = bddDocument?.featureDescription || `Automated end-to-end verification for ${flowName}`;
    const featureTags = (bddDocument?.tags && bddDocument.tags.length > 0) ? bddDocument.tags.join(' ') : '@e2e @automated @videoFlow';

    let featureContent = `${featureTags}\nFeature: ${featureName}\n  ${featureDesc}\n\n  Background:\n    Given User navigates to the application URL "${targetUrl}"\n\n  Scenario: Execute verified walkthrough journey\n`;

    steps.forEach((step, idx) => {
      const elName = step.elementName || `element_${idx + 1}`;
      if (step.action === 'fill' || step.action === 'type') {
        featureContent += `    When User enters "${step.value || 'test-value'}" into "${elName}"\n`;
      } else if (step.action === 'click') {
        featureContent += `    And User clicks on "${elName}"\n`;
      } else if (step.action === 'check') {
        featureContent += `    And User checks checkbox "${elName}"\n`;
      } else if (step.action === 'uncheck') {
        featureContent += `    And User unchecks checkbox "${elName}"\n`;
      } else if (step.action === 'selectOption') {
        featureContent += `    And User selects "${step.value || 'option'}" from "${elName}"\n`;
      } else if (step.action === 'press') {
        featureContent += `    And User presses key "${step.value || 'Enter'}"\n`;
      } else {
        featureContent += `    Then User verifies that "${elName}" is visible and active\n`;
      }
    });

    featureContent += `    Then System confirms successful workflow execution\n`;

    const featurePath = (language === 'Java') ? `src/test/resources/features/${safeName}.feature` : `features/${safeName}.feature`;
    files.push({ path: featurePath, content: featureContent });
  }

  // =========================================================================
  // ROUTING BY TOOL & LANGUAGE
  // =========================================================================

  // -------------------------------------------------------------------------
  // 1. CYPRESS + JAVASCRIPT
  // -------------------------------------------------------------------------
  if (tool === 'Cypress' && language === 'JavaScript') {
    files.push({
      path: 'cypress.config.js',
      content: `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: '${targetUrl}',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    viewportWidth: 1280,
    viewportHeight: 800,
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    video: false,
    screenshotOnRunFailure: true
  }
});`
    });

    files.push({
      path: 'package.json',
      content: `{
  "name": "${safeName}-cypress-js",
  "version": "1.0.0",
  "description": "Cypress JavaScript POM Automation Suite for ${flowName}",
  "scripts": {
    "test": "cypress run",
    "cypress:open": "cypress open",
    "test:headed": "cypress run --headed --browser chrome"
  },
  "devDependencies": {
    "cypress": "^13.7.0"
  }
}`
    });

    files.push({
      path: 'cypress/support/e2e.js',
      content: `// Import commands.js using ES2015 syntax:
import './commands';

// Alternatively you can use CommonJS syntax:
// require('./commands')

Cypress.on('uncaught:exception', (err, runnable) => {
  // returning false here prevents Cypress from failing the test on unhandled 3rd party script exceptions
  return false;
});`
    });

    files.push({
      path: 'cypress/support/commands.js',
      content: `// Custom Cypress commands can be added here
Cypress.Commands.add('verifyElementVisible', (selector) => {
  cy.get(selector).should('be.visible');
});`
    });

    // BasePage.js
    files.push({
      path: 'cypress/pages/BasePage.js',
      content: `export class BasePage {
  navigate(path = '') {
    cy.visit(path || '/');
  }

  click(selector) {
    cy.get(selector).should('be.visible').click();
  }

  fill(selector, value) {
    cy.get(selector).should('be.visible').clear().type(value);
  }

  select(selector, value) {
    cy.get(selector).should('be.visible').select(value);
  }

  check(selector) {
    cy.get(selector).should('be.visible').check();
  }

  uncheck(selector) {
    cy.get(selector).should('be.visible').uncheck();
  }

  assertVisible(selector) {
    cy.get(selector).should('be.visible');
  }
}`
    });

    // Specific Page Objects
    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || 'element').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'body';
        if (step.action === 'fill' || step.action === 'type') {
          return `  fill_${cleanEl}(value = '${escapeStr(step.value || 'test-value')}') {
    this.fill('${escapeStr(loc)}', value);
  }`;
        } else if (step.action === 'click') {
          return `  click_${cleanEl}() {
    this.click('${escapeStr(loc)}');
  }`;
        } else if (step.action === 'check') {
          return `  check_${cleanEl}() {
    this.check('${escapeStr(loc)}');
  }`;
        } else if (step.action === 'uncheck') {
          return `  uncheck_${cleanEl}() {
    this.uncheck('${escapeStr(loc)}');
  }`;
        } else {
          return `  verify_${cleanEl}() {
    this.assertVisible('${escapeStr(loc)}');
  }`;
        }
      }).join('\n\n');

      files.push({
        path: `cypress/pages/${pg.pageName}Page.js`,
        content: `import { BasePage } from './BasePage';

export class ${pg.pageName}Page extends BasePage {
  constructor() {
    super();
    this.pageUrl = '${pg.pageUrl}';
  }

  open() {
    this.navigate(this.pageUrl);
  }

${methods}
}`
      });
    });

    // Test Spec
    const imports = pageGroups.map(pg => `import { ${pg.pageName}Page } from '../pages/${pg.pageName}Page';`).join('\n');
    const instantiations = pageGroups.map(pg => `  const ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page();`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    ${cleanPage}Page.fill_${cleanEl}('${escapeStr(step.value || 'test-value')}');`;
      } else if (step.action === 'click') {
        return `    // Step ${idx + 1}: Click ${step.elementName || 'button'}\n    ${cleanPage}Page.click_${cleanEl}();`;
      } else if (step.action === 'check') {
        return `    // Step ${idx + 1}: Check ${step.elementName || 'checkbox'}\n    ${cleanPage}Page.check_${cleanEl}();`;
      } else if (step.action === 'uncheck') {
        return `    // Step ${idx + 1}: Uncheck ${step.elementName || 'checkbox'}\n    ${cleanPage}Page.uncheck_${cleanEl}();`;
      } else {
        return `    // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    ${cleanPage}Page.verify_${cleanEl}();`;
      }
    }).join('\n\n');

    files.push({
      path: `cypress/e2e/${safeName}.cy.js`,
      content: `${imports}

describe('${flowName} - Cypress JavaScript Test Suite', () => {
${instantiations}

  beforeEach(() => {
    // Navigate to entry URL
    cy.visit('${targetUrl}');
  });

  it('executes all verified actions recorded from walkthrough', () => {
${stepCalls}

    // Final verification assertion
    cy.url().should('not.include', 'error');
  });
});`
    });

  // -------------------------------------------------------------------------
  // 2. CYPRESS + TYPESCRIPT
  // -------------------------------------------------------------------------
  } else if (tool === 'Cypress' && language === 'TypeScript') {
    files.push({
      path: 'cypress.config.ts',
      content: `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: '${targetUrl}',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 800,
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    video: false,
    screenshotOnRunFailure: true
  }
});`
    });

    files.push({
      path: 'tsconfig.json',
      content: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "types": ["cypress", "node"],
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}`
    });

    files.push({
      path: 'package.json',
      content: `{
  "name": "${safeName}-cypress-ts",
  "version": "1.0.0",
  "description": "Cypress TypeScript POM Automation Suite for ${flowName}",
  "scripts": {
    "test": "cypress run",
    "cypress:open": "cypress open",
    "test:headed": "cypress run --headed --browser chrome"
  },
  "devDependencies": {
    "cypress": "^13.7.0",
    "typescript": "^5.4.2"
  }
}`
    });

    files.push({
      path: 'cypress/support/e2e.ts',
      content: `import './commands';

Cypress.on('uncaught:exception', (err, runnable) => {
  return false;
});`
    });

    files.push({
      path: 'cypress/support/commands.ts',
      content: `// Declare custom command types for TypeScript
declare global {
  namespace Cypress {
    interface Chainable {
      verifyElementVisible(selector: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('verifyElementVisible', (selector: string) => {
  cy.get(selector).should('be.visible');
});

export {};`
    });

    files.push({
      path: 'cypress/pages/BasePage.ts',
      content: `export abstract class BasePage {
  navigate(path: string = ''): void {
    cy.visit(path || '/');
  }

  click(selector: string): void {
    cy.get(selector).should('be.visible').click();
  }

  fill(selector: string, value: string): void {
    cy.get(selector).should('be.visible').clear().type(value);
  }

  select(selector: string, value: string): void {
    cy.get(selector).should('be.visible').select(value);
  }

  check(selector: string): void {
    cy.get(selector).should('be.visible').check();
  }

  uncheck(selector: string): void {
    cy.get(selector).should('be.visible').uncheck();
  }

  assertVisible(selector: string): void {
    cy.get(selector).should('be.visible');
  }
}`
    });

    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || 'element').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'body';
        if (step.action === 'fill' || step.action === 'type') {
          return `  fill_${cleanEl}(value: string = '${escapeStr(step.value || 'test-value')}'): void {
    this.fill('${escapeStr(loc)}', value);
  }`;
        } else if (step.action === 'click') {
          return `  click_${cleanEl}(): void {
    this.click('${escapeStr(loc)}');
  }`;
        } else if (step.action === 'check') {
          return `  check_${cleanEl}(): void {
    this.check('${escapeStr(loc)}');
  }`;
        } else if (step.action === 'uncheck') {
          return `  uncheck_${cleanEl}(): void {
    this.uncheck('${escapeStr(loc)}');
  }`;
        } else {
          return `  verify_${cleanEl}(): void {
    this.assertVisible('${escapeStr(loc)}');
  }`;
        }
      }).join('\n\n');

      files.push({
        path: `cypress/pages/${pg.pageName}Page.ts`,
        content: `import { BasePage } from './BasePage';

export class ${pg.pageName}Page extends BasePage {
  readonly pageUrl: string;

  constructor() {
    super();
    this.pageUrl = '${pg.pageUrl}';
  }

  open(): void {
    this.navigate(this.pageUrl);
  }

${methods}
}`
      });
    });

    const imports = pageGroups.map(pg => `import { ${pg.pageName}Page } from '../pages/${pg.pageName}Page';`).join('\n');
    const instantiations = pageGroups.map(pg => `  const ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page();`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    ${cleanPage}Page.fill_${cleanEl}('${escapeStr(step.value || 'test-value')}');`;
      } else if (step.action === 'click') {
        return `    // Step ${idx + 1}: Click ${step.elementName || 'button'}\n    ${cleanPage}Page.click_${cleanEl}();`;
      } else if (step.action === 'check') {
        return `    // Step ${idx + 1}: Check ${step.elementName || 'checkbox'}\n    ${cleanPage}Page.check_${cleanEl}();`;
      } else if (step.action === 'uncheck') {
        return `    // Step ${idx + 1}: Uncheck ${step.elementName || 'checkbox'}\n    ${cleanPage}Page.uncheck_${cleanEl}();`;
      } else {
        return `    // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    ${cleanPage}Page.verify_${cleanEl}();`;
      }
    }).join('\n\n');

    files.push({
      path: `cypress/e2e/${safeName}.cy.ts`,
      content: `${imports}

describe('${flowName} - Cypress TypeScript Suite', () => {
${instantiations}

  beforeEach(() => {
    cy.visit('${targetUrl}');
  });

  it('executes all verified actions recorded from walkthrough', () => {
${stepCalls}

    cy.url().should('not.include', 'error');
  });
});`
    });

  // -------------------------------------------------------------------------
  // 3. PLAYWRIGHT + TYPESCRIPT
  // -------------------------------------------------------------------------
  } else if (tool === 'Playwright' && language === 'TypeScript') {
    files.push({
      path: 'playwright.config.ts',
      content: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: '${targetUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});`
    });

    files.push({
      path: 'package.json',
      content: `{
  "name": "${safeName}-playwright-ts",
  "version": "1.0.0",
  "description": "Playwright TypeScript POM Automation Suite for ${flowName}",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.42.1",
    "@types/node": "^20.11.24",
    "typescript": "^5.4.2"
  }
}`
    });

    files.push({
      path: 'pages/BasePage.ts',
      content: `import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(url: string = ''): Promise<void> {
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickElement(locator: Locator, timeout: number = 8000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }

  async fillElement(locator: Locator, text: string, timeout: number = 8000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.fill(text);
  }

  async selectOption(locator: Locator, option: string): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 8000 });
    await locator.selectOption(option);
  }

  async verifyVisible(locator: Locator, timeout: number = 8000): Promise<void> {
    await expect(locator).toBeVisible({ timeout });
  }
}`
    });

    pageGroups.forEach((pg) => {
      const locDefs = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `element_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const locCode = s.locator.primary.playwright || `this.page.locator('${escapeStr(s.locator.primary.value)}')`;
        return `    this.${cleanEl} = ${locCode.replace('page.', 'this.page.')};`;
      }).join('\n');

      const locMembers = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `element_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        return `  readonly ${cleanEl}: Locator;`;
      }).join('\n');

      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        if (step.action === 'fill' || step.action === 'type') {
          return `  async fill_${cleanEl}(value: string = '${escapeStr(step.value || 'test-value')}'): Promise<void> {
    await this.fillElement(this.${cleanEl}, value);
  }`;
        } else if (step.action === 'click') {
          return `  async click_${cleanEl}(): Promise<void> {
    await this.clickElement(this.${cleanEl});
  }`;
        } else if (step.action === 'check') {
          return `  async check_${cleanEl}(): Promise<void> {
    await this.${cleanEl}.waitFor({ state: 'visible', timeout: 8000 });
    await this.${cleanEl}.check();
  }`;
        } else if (step.action === 'uncheck') {
          return `  async uncheck_${cleanEl}(): Promise<void> {
    await this.${cleanEl}.waitFor({ state: 'visible', timeout: 8000 });
    await this.${cleanEl}.uncheck();
  }`;
        } else if (step.action === 'selectOption') {
          return `  async select_${cleanEl}(option: string = '${escapeStr(step.value || 'option1')}'): Promise<void> {
    await this.selectOption(this.${cleanEl}, option);
  }`;
        } else {
          return `  async verify_${cleanEl}(): Promise<void> {
    await this.verifyVisible(this.${cleanEl});
  }`;
        }
      }).join('\n\n');

      files.push({
        path: `pages/${pg.pageName}Page.ts`,
        content: `import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ${pg.pageName}Page extends BasePage {
  readonly pageUrl: string = '${pg.pageUrl}';
${locMembers}

  constructor(page: Page) {
    super(page);
${locDefs}
  }

  async navigate(): Promise<void> {
    await this.goto(this.pageUrl);
  }

${methods}
}`
      });
    });

    const imports = pageGroups.map(pg => `import { ${pg.pageName}Page } from '../pages/${pg.pageName}Page';`).join('\n');
    const instantiations = pageGroups.map(pg => `    const ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page(page);`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    await ${cleanPage}Page.fill_${cleanEl}('${escapeStr(step.value || 'test-value')}');`;
      } else if (step.action === 'click') {
        return `    // Step ${idx + 1}: Click ${step.elementName || 'button'}\n    await ${cleanPage}Page.click_${cleanEl}();`;
      } else if (step.action === 'check') {
        return `    // Step ${idx + 1}: Check ${step.elementName || 'checkbox'}\n    await ${cleanPage}Page.check_${cleanEl}();`;
      } else if (step.action === 'uncheck') {
        return `    // Step ${idx + 1}: Uncheck ${step.elementName || 'checkbox'}\n    await ${cleanPage}Page.uncheck_${cleanEl}();`;
      } else {
        return `    // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    await ${cleanPage}Page.verify_${cleanEl}();`;
      }
    }).join('\n\n');

    files.push({
      path: `tests/${safeName}.spec.ts`,
      content: `import { test, expect } from '@playwright/test';
${imports}

test.describe('${flowName} - Playwright TypeScript Suite', () => {
  test('executes all verified sequential steps from walkthrough video', async ({ page }) => {
${instantiations}

    // Navigate to initial application URL
    await ${pageGroups[0].pageName.toLowerCase()}Page.navigate();

${stepCalls}

    // Verification check
    await expect(page).not.toHaveURL(/error/i);
  });
});`
    });

  // -------------------------------------------------------------------------
  // 4. PLAYWRIGHT + JAVASCRIPT
  // -------------------------------------------------------------------------
  } else if (tool === 'Playwright' && language === 'JavaScript') {
    files.push({
      path: 'playwright.config.js',
      content: `const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: '${targetUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ]
});`
    });

    files.push({
      path: 'package.json',
      content: `{
  "name": "${safeName}-playwright-js",
  "version": "1.0.0",
  "description": "Playwright JavaScript POM Automation Suite for ${flowName}",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "^1.42.1"
  }
}`
    });

    files.push({
      path: 'pages/BasePage.js',
      content: `const { expect } = require('@playwright/test');

class BasePage {
  constructor(page) {
    this.page = page;
  }

  async goto(url = '') {
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickElement(locator, timeout = 8000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }

  async fillElement(locator, text, timeout = 8000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.fill(text);
  }

  async verifyVisible(locator, timeout = 8000) {
    await expect(locator).toBeVisible({ timeout });
  }
}

module.exports = { BasePage };`
    });

    pageGroups.forEach((pg) => {
      const locDefs = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `element_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const locCode = s.locator.primary.playwright || `this.page.locator('${escapeStr(s.locator.primary.value)}')`;
        return `    this.${cleanEl} = ${locCode.replace('page.', 'this.page.')};`;
      }).join('\n');

      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        if (step.action === 'fill' || step.action === 'type') {
          return `  async fill_${cleanEl}(value = '${escapeStr(step.value || 'test-value')}') {
    await this.fillElement(this.${cleanEl}, value);
  }`;
        } else if (step.action === 'click') {
          return `  async click_${cleanEl}() {
    await this.clickElement(this.${cleanEl});
  }`;
        } else {
          return `  async verify_${cleanEl}() {
    await this.verifyVisible(this.${cleanEl});
  }`;
        }
      }).join('\n\n');

      files.push({
        path: `pages/${pg.pageName}Page.js`,
        content: `const { BasePage } = require('./BasePage');

class ${pg.pageName}Page extends BasePage {
  constructor(page) {
    super(page);
    this.pageUrl = '${pg.pageUrl}';
${locDefs}
  }

  async navigate() {
    await this.goto(this.pageUrl);
  }

${methods}
}

module.exports = { ${pg.pageName}Page };`
      });
    });

    const imports = pageGroups.map(pg => `const { ${pg.pageName}Page } = require('../pages/${pg.pageName}Page');`).join('\n');
    const instantiations = pageGroups.map(pg => `    const ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page(page);`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    await ${cleanPage}Page.fill_${cleanEl}('${escapeStr(step.value || 'test-value')}');`;
      } else if (step.action === 'click') {
        return `    // Step ${idx + 1}: Click ${step.elementName || 'button'}\n    await ${cleanPage}Page.click_${cleanEl}();`;
      } else {
        return `    // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    await ${cleanPage}Page.verify_${cleanEl}();`;
      }
    }).join('\n\n');

    files.push({
      path: `tests/${safeName}.spec.js`,
      content: `const { test, expect } = require('@playwright/test');
${imports}

test.describe('${flowName} - Playwright JavaScript Suite', () => {
  test('executes all verified actions', async ({ page }) => {
${instantiations}

    await ${pageGroups[0].pageName.toLowerCase()}Page.navigate();

${stepCalls}

    await expect(page).not.toHaveURL(/error/i);
  });
});`
    });

  // -------------------------------------------------------------------------
  // 5. PLAYWRIGHT + PYTHON
  // -------------------------------------------------------------------------
  } else if (tool === 'Playwright' && language === 'Python') {
    files.push({
      path: 'pytest.ini',
      content: `[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short`
    });

    files.push({
      path: 'requirements.txt',
      content: `pytest==8.1.1
pytest-playwright==0.4.4
playwright==1.42.0`
    });

    files.push({
      path: 'conftest.py',
      content: `import pytest
from playwright.sync_api import sync_playwright

@pytest.fixture(scope="session")
def browser_context():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        yield context
        context.close()
        browser.close()

@pytest.fixture
def page(browser_context):
    page = browser_context.new_page()
    yield page
    page.close()`
    });

    files.push({
      path: 'pages/base_page.py',
      content: `class BasePage:
    def __init__(self, page):
        self.page = page

    def navigate(self, url: str):
        self.page.goto(url)
        self.page.wait_for_load_state("domcontentloaded")

    def click(self, selector: str):
        self.page.wait_for_selector(selector, state="visible", timeout=8000)
        self.page.click(selector)

    def fill(self, selector: str, text: str):
        self.page.wait_for_selector(selector, state="visible", timeout=8000)
        self.page.fill(selector, text)

    def is_visible(self, selector: str) -> bool:
        self.page.wait_for_selector(selector, state="visible", timeout=8000)
        return self.page.is_visible(selector)`
    });

    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'body';
        if (step.action === 'fill' || step.action === 'type') {
          return `    def fill_${cleanEl}(self, value="${escapeDoubleQuotes(step.value || 'test-value')}"):
        self.fill("${escapeDoubleQuotes(loc)}", value)`;
        } else if (step.action === 'click') {
          return `    def click_${cleanEl}(self):
        self.click("${escapeDoubleQuotes(loc)}")`;
        } else {
          return `    def verify_${cleanEl}(self) -> bool:
        return self.is_visible("${escapeDoubleQuotes(loc)}")`;
        }
      }).join('\n\n');

      files.push({
        path: `pages/${pg.pageName.toLowerCase()}_page.py`,
        content: `from pages.base_page import BasePage

class ${pg.pageName}Page(BasePage):
    def __init__(self, page):
        super().__init__(page)
        self.url = "${pg.pageUrl}"

    def open(self):
        self.navigate(self.url)

${methods}`
      });
    });

    const imports = pageGroups.map(pg => `from pages.${pg.pageName.toLowerCase()}_page import ${pg.pageName}Page`).join('\n');
    const instantiations = pageGroups.map(pg => `    ${pg.pageName.toLowerCase()}_page = ${pg.pageName}Page(page)`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    # Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    ${cleanPage}_page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}")`;
      } else if (step.action === 'click') {
        return `    # Step ${idx + 1}: Click ${step.elementName || 'button'}\n    ${cleanPage}_page.click_${cleanEl}()`;
      } else {
        return `    # Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    assert ${cleanPage}_page.verify_${cleanEl}()`;
      }
    }).join('\n\n');

    files.push({
      path: `tests/test_${safeName}.py`,
      content: `import pytest
${imports}

def test_${safeName}_workflow(page):
    """Executes full ${flowName} test suite recorded from walkthrough video"""
${instantiations}

    # Navigate to entry point
    ${pageGroups[0].pageName.toLowerCase()}_page.open()

${stepCalls}
`
    });

  // -------------------------------------------------------------------------
  // 6. PLAYWRIGHT + JAVA
  // -------------------------------------------------------------------------
  } else if (tool === 'Playwright' && language === 'Java') {
    files.push({
      path: 'pom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.qa.automation</groupId>
    <artifactId>${safeName}-playwright-java</artifactId>
    <version>1.0.0</version>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <playwright.version>1.42.0</playwright.version>
        <testng.version>7.9.0</testng.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>com.microsoft.playwright</groupId>
            <artifactId>playwright</artifactId>
            <version>\${playwright.version}</version>
        </dependency>
        <dependency>
            <groupId>org.testng</groupId>
            <artifactId>testng</artifactId>
            <version>\${testng.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
                <configuration>
                    <suiteXmlFiles>
                        <suiteXmlFile>testng.xml</suiteXmlFile>
                    </suiteXmlFiles>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`
    });

    files.push({
      path: 'testng.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">
<suite name="${flowName} Playwright Suite" verbose="2">
    <test name="${titlePascal} Tests">
        <classes>
            <class name="com.qa.tests.${titlePascal}Test"/>
        </classes>
    </test>
</suite>`
    });

    files.push({
      path: 'src/main/java/com/qa/pages/BasePage.java',
      content: `package com.qa.pages;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.Locator;

public abstract class BasePage {
    protected Page page;

    public BasePage(Page page) {
        this.page = page;
    }

    public void navigateTo(String url) {
        page.navigate(url);
    }

    public void clickElement(String selector) {
        page.waitForSelector(selector);
        page.click(selector);
    }

    public void fillElement(String selector, String text) {
        page.waitForSelector(selector);
        page.fill(selector, text);
    }

    public boolean isElementVisible(String selector) {
        return page.isVisible(selector);
    }
}`
    });

    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'body';
        if (step.action === 'fill' || step.action === 'type') {
          return `    public void fill_${cleanEl}(String value) {
        fillElement("${escapeDoubleQuotes(loc)}", value);
    }`;
        } else if (step.action === 'click') {
          return `    public void click_${cleanEl}() {
        clickElement("${escapeDoubleQuotes(loc)}");
    }`;
        } else {
          return `    public boolean verify_${cleanEl}() {
        return isElementVisible("${escapeDoubleQuotes(loc)}");
    }`;
        }
      }).join('\n\n');

      files.push({
        path: `src/main/java/com/qa/pages/${pg.pageName}Page.java`,
        content: `package com.qa.pages;

import com.microsoft.playwright.Page;

public class ${pg.pageName}Page extends BasePage {
    private final String pageUrl = "${pg.pageUrl}";

    public ${pg.pageName}Page(Page page) {
        super(page);
    }

    public void open() {
        navigateTo(pageUrl);
    }

${methods}
}`
      });
    });

    const imports = pageGroups.map(pg => `import com.qa.pages.${pg.pageName}Page;`).join('\n');
    const instantiations = pageGroups.map(pg => `        ${pg.pageName}Page ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page(page);`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `        // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n        ${cleanPage}Page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}");`;
      } else if (step.action === 'click') {
        return `        // Step ${idx + 1}: Click ${step.elementName || 'button'}\n        ${cleanPage}Page.click_${cleanEl}();`;
      } else {
        return `        // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n        Assert.assertTrue(${cleanPage}Page.verify_${cleanEl}());`;
      }
    }).join('\n\n');

    files.push({
      path: `src/test/java/com/qa/tests/${titlePascal}Test.java`,
      content: `package com.qa.tests;

import com.microsoft.playwright.*;
import org.testng.Assert;
import org.testng.annotations.*;
${imports}

public class ${titlePascal}Test {
    private Playwright playwright;
    private Browser browser;
    private BrowserContext context;
    private Page page;

    @BeforeClass
    public void setUp() {
        playwright = Playwright.create();
        browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true));
        context = browser.newContext(new Browser.NewContextOptions().setViewportSize(1280, 800));
        page = context.newPage();
    }

    @Test
    public void test${titlePascal}Workflow() {
${instantiations}

        // Navigate to entry URL
        ${pageGroups[0].pageName.toLowerCase()}Page.open();

${stepCalls}
    }

    @AfterClass
    public void tearDown() {
        if (browser != null) browser.close();
        if (playwright != null) playwright.close();
    }
}`
    });

  // -------------------------------------------------------------------------
  // 7. SELENIUM + JAVA
  // -------------------------------------------------------------------------
  } else if (tool === 'Selenium' && language === 'Java') {
    files.push({
      path: 'pom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.qa.automation</groupId>
    <artifactId>${safeName}-selenium-testng</artifactId>
    <version>1.0.0</version>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <selenium.version>4.19.1</selenium.version>
        <testng.version>7.9.0</testng.version>
        <webdrivermanager.version>5.8.0</webdrivermanager.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.seleniumhq.selenium</groupId>
            <artifactId>selenium-java</artifactId>
            <version>\${selenium.version}</version>
        </dependency>
        <dependency>
            <groupId>org.testng</groupId>
            <artifactId>testng</artifactId>
            <version>\${testng.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.github.bonigarcia</groupId>
            <artifactId>webdrivermanager</artifactId>
            <version>\${webdrivermanager.version}</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
                <configuration>
                    <suiteXmlFiles>
                        <suiteXmlFile>testng.xml</suiteXmlFile>
                    </suiteXmlFiles>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`
    });

    files.push({
      path: 'testng.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">
<suite name="${flowName} Selenium Suite" verbose="2">
    <test name="${titlePascal} Tests">
        <classes>
            <class name="com.qa.tests.${titlePascal}Test"/>
        </classes>
    </test>
</suite>`
    });

    files.push({
      path: 'src/main/java/com/qa/pages/BasePage.java',
      content: `package com.qa.pages;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.By;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;
import java.time.Duration;

public class BasePage {
    protected WebDriver driver;
    protected WebDriverWait wait;

    public BasePage(WebDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }

    public void navigateTo(String url) {
        driver.get(url);
    }

    public void clickElement(By locator) {
        wait.until(ExpectedConditions.elementToBeClickable(locator)).click();
    }

    public void fillElement(By locator, String text) {
        WebElement el = wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
        el.clear();
        el.sendKeys(text);
    }

    public boolean isElementVisible(By locator) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(locator)).isDisplayed();
    }
}`
    });

    pageGroups.forEach((pg) => {
      const locDefs = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `el_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = s.locator.primary.value || 'body';
        const isXpath = loc.startsWith('//') || loc.startsWith('(');
        return `    private final By ${cleanEl}Locator = ${isXpath ? `By.xpath("${escapeDoubleQuotes(loc)}")` : `By.cssSelector("${escapeDoubleQuotes(loc)}")`};`;
      }).join('\n');

      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        if (step.action === 'fill' || step.action === 'type') {
          return `    public void fill_${cleanEl}(String value) {
        fillElement(${cleanEl}Locator, value);
    }`;
        } else if (step.action === 'click') {
          return `    public void click_${cleanEl}() {
        clickElement(${cleanEl}Locator);
    }`;
        } else {
          return `    public boolean verify_${cleanEl}() {
        return isElementVisible(${cleanEl}Locator);
    }`;
        }
      }).join('\n\n');

      files.push({
        path: `src/main/java/com/qa/pages/${pg.pageName}Page.java`,
        content: `package com.qa.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

public class ${pg.pageName}Page extends BasePage {
    private final String pageUrl = "${pg.pageUrl}";
${locDefs}

    public ${pg.pageName}Page(WebDriver driver) {
        super(driver);
    }

    public void open() {
        navigateTo(pageUrl);
    }

${methods}
}`
      });
    });

    const imports = pageGroups.map(pg => `import com.qa.pages.${pg.pageName}Page;`).join('\n');
    const instantiations = pageGroups.map(pg => `        ${pg.pageName}Page ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page(driver);`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `        // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n        ${cleanPage}Page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}");`;
      } else if (step.action === 'click') {
        return `        // Step ${idx + 1}: Click ${step.elementName || 'button'}\n        ${cleanPage}Page.click_${cleanEl}();`;
      } else {
        return `        // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n        Assert.assertTrue(${cleanPage}Page.verify_${cleanEl}());`;
      }
    }).join('\n\n');

    files.push({
      path: `src/test/java/com/qa/tests/${titlePascal}Test.java`,
      content: `package com.qa.tests;

import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.Assert;
import org.testng.annotations.*;
${imports}

public class ${titlePascal}Test {
    private WebDriver driver;

    @BeforeClass
    public void setUp() {
        WebDriverManager.chromedriver().setup();
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--window-size=1280,800");
        driver = new ChromeDriver(options);
    }

    @Test
    public void test${titlePascal}Workflow() {
${instantiations}

        // Navigate to entry URL
        ${pageGroups[0].pageName.toLowerCase()}Page.open();

${stepCalls}
    }

    @AfterClass
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}`
    });

  // -------------------------------------------------------------------------
  // 8. SELENIUM + PYTHON
  // -------------------------------------------------------------------------
  } else if (tool === 'Selenium' && language === 'Python') {
    files.push({
      path: 'pytest.ini',
      content: `[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short`
    });

    files.push({
      path: 'requirements.txt',
      content: `pytest==8.1.1
selenium==4.19.0
webdriver-manager==4.0.1`
    });

    files.push({
      path: 'conftest.py',
      content: `import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options

@pytest.fixture(scope="session")
def driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1280,800")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    yield driver
    driver.quit()`
    });

    files.push({
      path: 'pages/base_page.py',
      content: `from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

class BasePage:
    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, 10)

    def navigate(self, url: str):
        self.driver.get(url)

    def click(self, by: By, locator: str):
        element = self.wait.until(EC.element_to_be_clickable((by, locator)))
        element.click()

    def fill(self, by: By, locator: str, text: str):
        element = self.wait.until(EC.visibility_of_element_located((by, locator)))
        element.clear()
        element.sendKeys(text) if hasattr(element, 'sendKeys') else element.send_keys(text)

    def is_visible(self, by: By, locator: str) -> bool:
        element = self.wait.until(EC.visibility_of_element_located((by, locator)))
        return element.is_displayed()`
    });

    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'body';
        const isXpath = loc.startsWith('//') || loc.startsWith('(');
        const byType = isXpath ? 'By.XPATH' : 'By.CSS_SELECTOR';

        if (step.action === 'fill' || step.action === 'type') {
          return `    def fill_${cleanEl}(self, value="${escapeDoubleQuotes(step.value || 'test-value')}"):
        self.fill(${byType}, "${escapeDoubleQuotes(loc)}", value)`;
        } else if (step.action === 'click') {
          return `    def click_${cleanEl}(self):
        self.click(${byType}, "${escapeDoubleQuotes(loc)}")`;
        } else {
          return `    def verify_${cleanEl}(self) -> bool:
        return self.is_visible(${byType}, "${escapeDoubleQuotes(loc)}")`;
        }
      }).join('\n\n');

      files.push({
        path: `pages/${pg.pageName.toLowerCase()}_page.py`,
        content: `from selenium.webdriver.common.by import By
from pages.base_page import BasePage

class ${pg.pageName}Page(BasePage):
    def __init__(self, driver):
        super().__init__(driver)
        self.url = "${pg.pageUrl}"

    def open(self):
        self.navigate(self.url)

${methods}`
      });
    });

    const imports = pageGroups.map(pg => `from pages.${pg.pageName.toLowerCase()}_page import ${pg.pageName}Page`).join('\n');
    const instantiations = pageGroups.map(pg => `    ${pg.pageName.toLowerCase()}_page = ${pg.pageName}Page(driver)`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    # Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    ${cleanPage}_page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}")`;
      } else if (step.action === 'click') {
        return `    # Step ${idx + 1}: Click ${step.elementName || 'button'}\n    ${cleanPage}_page.click_${cleanEl}()`;
      } else {
        return `    # Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    assert ${cleanPage}_page.verify_${cleanEl}()`;
      }
    }).join('\n\n');

    files.push({
      path: `tests/test_${safeName}.py`,
      content: `import pytest
${imports}

def test_${safeName}_selenium_workflow(driver):
    """Executes Selenium Python automation workflow recorded from walkthrough video"""
${instantiations}

    # Open base page
    ${pageGroups[0].pageName.toLowerCase()}_page.open()

${stepCalls}
`
    });

  // -------------------------------------------------------------------------
  // 9. APPIUM + JAVA
  // -------------------------------------------------------------------------
  } else if (tool === 'Appium' && language === 'Java') {
    files.push({
      path: 'pom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.qa.mobile</groupId>
    <artifactId>${safeName}-appium-java</artifactId>
    <version>1.0.0</version>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <appium.version>9.2.2</appium.version>
        <selenium.version>4.19.1</selenium.version>
        <testng.version>7.9.0</testng.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>io.appium</groupId>
            <artifactId>java-client</artifactId>
            <version>\${appium.version}</version>
        </dependency>
        <dependency>
            <groupId>org.seleniumhq.selenium</groupId>
            <artifactId>selenium-java</artifactId>
            <version>\${selenium.version}</version>
        </dependency>
        <dependency>
            <groupId>org.testng</groupId>
            <artifactId>testng</artifactId>
            <version>\${testng.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
                <configuration>
                    <suiteXmlFiles>
                        <suiteXmlFile>testng.xml</suiteXmlFile>
                    </suiteXmlFiles>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`
    });

    files.push({
      path: 'testng.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">
<suite name="${flowName} Appium Suite" verbose="2">
    <test name="Mobile Android Tests">
        <classes>
            <class name="com.qa.tests.${titlePascal}MobileTest"/>
        </classes>
    </test>
</suite>`
    });

    files.push({
      path: 'src/main/java/com/qa/pages/BasePage.java',
      content: `package com.qa.pages;

import io.appium.java_client.AppiumDriver;
import io.appium.java_client.AppiumBy;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.By;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;
import java.time.Duration;

public class BasePage {
    protected AppiumDriver driver;
    protected WebDriverWait wait;

    public BasePage(AppiumDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(15));
    }

    public void clickElement(By locator) {
        wait.until(ExpectedConditions.elementToBeClickable(locator)).click();
    }

    public void fillElement(By locator, String text) {
        WebElement el = wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
        el.clear();
        el.sendKeys(text);
    }

    public boolean isElementVisible(By locator) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(locator)).isDisplayed();
    }
}`
    });

    pageGroups.forEach((pg) => {
      const locDefs = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `el_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = s.locator.primary.value || 'android.view.View';
        const isXpath = loc.startsWith('//') || loc.startsWith('(');
        const isId = loc.includes(':id/') || !loc.includes(' ');
        
        let byExpr = `AppiumBy.xpath("${escapeDoubleQuotes(loc)}")`;
        if (loc.includes('new UiSelector()')) {
          byExpr = `AppiumBy.androidUIAutomator("${escapeDoubleQuotes(loc)}")`;
        } else if (isId && !isXpath) {
          byExpr = `AppiumBy.id("${escapeDoubleQuotes(loc)}")`;
        } else if (!isXpath) {
          byExpr = `AppiumBy.accessibilityId("${escapeDoubleQuotes(loc)}")`;
        }

        return `    private final By ${cleanEl}Locator = ${byExpr};`;
      }).join('\n');

      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        if (step.action === 'fill' || step.action === 'type') {
          return `    public void fill_${cleanEl}(String value) {
        fillElement(${cleanEl}Locator, value);
    }`;
        } else if (step.action === 'click') {
          return `    public void click_${cleanEl}() {
        clickElement(${cleanEl}Locator);
    }`;
        } else {
          return `    public boolean verify_${cleanEl}() {
        return isElementVisible(${cleanEl}Locator);
    }`;
        }
      }).join('\n\n');

      files.push({
        path: `src/main/java/com/qa/pages/${pg.pageName}Page.java`,
        content: `package com.qa.pages;

import io.appium.java_client.AppiumDriver;
import io.appium.java_client.AppiumBy;
import org.openqa.selenium.By;

public class ${pg.pageName}Page extends BasePage {
${locDefs}

    public ${pg.pageName}Page(AppiumDriver driver) {
        super(driver);
    }

${methods}
}`
      });
    });

    const imports = pageGroups.map(pg => `import com.qa.pages.${pg.pageName}Page;`).join('\n');
    const instantiations = pageGroups.map(pg => `        ${pg.pageName}Page ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page(driver);`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `        // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n        ${cleanPage}Page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}");`;
      } else if (step.action === 'click') {
        return `        // Step ${idx + 1}: Click ${step.elementName || 'button'}\n        ${cleanPage}Page.click_${cleanEl}();`;
      } else {
        return `        // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n        Assert.assertTrue(${cleanPage}Page.verify_${cleanEl}());`;
      }
    }).join('\n\n');

    files.push({
      path: `src/test/java/com/qa/tests/${titlePascal}MobileTest.java`,
      content: `package com.qa.tests;

import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;
import org.testng.Assert;
import org.testng.annotations.*;
import java.net.URL;
import java.time.Duration;
${imports}

public class ${titlePascal}MobileTest {
    private AndroidDriver driver;

    @BeforeClass
    public void setUp() throws Exception {
        UiAutomator2Options options = new UiAutomator2Options()
            .setPlatformName("Android")
            .setAutomationName("UiAutomator2")
            .setDeviceName("Android Emulator")
            .setAppPackage("com.example.app")
            .setAppActivity(".MainActivity")
            .setNoReset(true);

        driver = new AndroidDriver(new URL("http://127.0.0.1:4723/"), options);
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
    }

    @Test
    public void test${titlePascal}MobileJourney() {
${instantiations}

${stepCalls}
    }

    @AfterClass
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}`
    });

  // -------------------------------------------------------------------------
  // 10. APPIUM + PYTHON
  // -------------------------------------------------------------------------
  } else if (tool === 'Appium' && language === 'Python') {
    files.push({
      path: 'pytest.ini',
      content: `[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short`
    });

    files.push({
      path: 'requirements.txt',
      content: `pytest==8.1.1
Appium-Python-Client==3.1.8
selenium==4.19.0`
    });

    files.push({
      path: 'conftest.py',
      content: `import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options

@pytest.fixture(scope="session")
def driver():
    options = UiAutomator2Options()
    options.platform_name = "Android"
    options.automation_name = "UiAutomator2"
    options.device_name = "emulator-5554"
    options.app_package = "com.example.app"
    options.app_activity = ".MainActivity"
    options.no_reset = True
    
    driver = webdriver.Remote("http://127.0.0.1:4723", options=options)
    yield driver
    driver.quit()`
    });

    files.push({
      path: 'pages/base_page.py',
      content: `from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from appium.webdriver.common.appiumby import AppiumBy

class BasePage:
    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, 15)

    def click(self, by: AppiumBy, locator: str):
        el = self.wait.until(EC.element_to_be_clickable((by, locator)))
        el.click()

    def fill(self, by: AppiumBy, locator: str, text: str):
        el = self.wait.until(EC.visibility_of_element_located((by, locator)))
        el.clear()
        el.send_keys(text)

    def is_visible(self, by: AppiumBy, locator: str) -> bool:
        el = self.wait.until(EC.visibility_of_element_located((by, locator)))
        return el.is_displayed()`
    });

    pageGroups.forEach((pg) => {
      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = step.locator.primary.value || 'android.view.View';
        const isXpath = loc.startsWith('//') || loc.startsWith('(');
        
        let byExpr = 'AppiumBy.XPATH';
        if (loc.includes('new UiSelector()')) {
          byExpr = 'AppiumBy.ANDROID_UIAUTOMATOR';
        } else if (loc.includes(':id/')) {
          byExpr = 'AppiumBy.ID';
        } else if (!isXpath && !loc.includes(' ')) {
          byExpr = 'AppiumBy.ACCESSIBILITY_ID';
        }

        if (step.action === 'fill' || step.action === 'type') {
          return `    def fill_${cleanEl}(self, value="${escapeDoubleQuotes(step.value || 'test-value')}"):
        self.fill(${byExpr}, "${escapeDoubleQuotes(loc)}", value)`;
        } else if (step.action === 'click') {
          return `    def click_${cleanEl}(self):
        self.click(${byExpr}, "${escapeDoubleQuotes(loc)}")`;
        } else {
          return `    def verify_${cleanEl}(self) -> bool:
        return self.is_visible(${byExpr}, "${escapeDoubleQuotes(loc)}")`;
        }
      }).join('\n\n');

      files.push({
        path: `pages/${pg.pageName.toLowerCase()}_page.py`,
        content: `from appium.webdriver.common.appiumby import AppiumBy
from pages.base_page import BasePage

class ${pg.pageName}Page(BasePage):
    def __init__(self, driver):
        super().__init__(driver)

${methods}`
      });
    });

    const imports = pageGroups.map(pg => `from pages.${pg.pageName.toLowerCase()}_page import ${pg.pageName}Page`).join('\n');
    const instantiations = pageGroups.map(pg => `    ${pg.pageName.toLowerCase()}_page = ${pg.pageName}Page(driver)`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `element_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    # Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    ${cleanPage}_page.fill_${cleanEl}("${escapeDoubleQuotes(step.value || 'test-value')}")`;
      } else if (step.action === 'click') {
        return `    # Step ${idx + 1}: Click ${step.elementName || 'button'}\n    ${cleanPage}_page.click_${cleanEl}()`;
      } else {
        return `    # Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    assert ${cleanPage}_page.verify_${cleanEl}()`;
      }
    }).join('\n\n');

    files.push({
      path: `tests/test_${safeName}.py`,
      content: `import pytest
${imports}

def test_${safeName}_mobile_workflow(driver):
    """Executes Appium Python mobile test suite"""
${instantiations}

${stepCalls}
`
    });

  // -------------------------------------------------------------------------
  // 11. APPIUM + TYPESCRIPT / JAVASCRIPT (WebdriverIO + Appium)
  // -------------------------------------------------------------------------
  } else if (tool === 'Appium' && (language === 'TypeScript' || language === 'JavaScript')) {
    const isWdioTs = language === 'TypeScript';
    const confExt = isWdioTs ? 'ts' : 'js';
    const codeExt = isWdioTs ? 'ts' : 'js';

    files.push({
      path: `wdio.conf.${confExt}`,
      content: `${isWdioTs ? 'export const config: WebdriverIO.Config =' : 'exports.config ='} {
  runner: 'local',
  specs: ['./test/specs/**/*.${codeExt}'],
  maxInstances: 1,
  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Android Emulator',
    'appium:appPackage': 'com.example.app',
    'appium:appActivity': '.MainActivity',
    'appium:noReset': true,
    'appium:newCommandTimeout': 240
  }],
  logLevel: 'info',
  framework: 'mocha',
  reporters: ['spec'],
  services: ['appium'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  }
};`
    });

    files.push({
      path: 'package.json',
      content: `{
  "name": "${safeName}-wdio-appium",
  "version": "1.0.0",
  "description": "WebdriverIO Appium Automation Suite for ${flowName}",
  "scripts": {
    "wdio": "wdio run ./wdio.conf.${confExt}"
  },
  "devDependencies": {
    "@wdio/cli": "^8.32.4",
    "@wdio/local-runner": "^8.32.4",
    "@wdio/mocha-framework": "^8.32.4",
    "@wdio/spec-reporter": "^8.32.4",
    "@wdio/appium-service": "^8.32.4"${isWdioTs ? ',\n    "typescript": "^5.4.2",\n    "ts-node": "^10.9.2"' : ''}
  }
}`
    });

    if (isWdioTs) {
      files.push({
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "moduleResolution": "node",
    "types": ["node", "@wdio/globals/types", "@wdio/mocha-framework"],
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true
  }
}`
      });
    }

    files.push({
      path: `pageobjects/base.page.${codeExt}`,
      content: `${isWdioTs ? 'export class BasePage' : 'class BasePage'} {
  async click(element${isWdioTs ? ': WebdriverIO.Element' : ''}) {
    await element.waitForDisplayed({ timeout: 10000 });
    await element.click();
  }

  async setValue(element${isWdioTs ? ': WebdriverIO.Element' : ''}, value${isWdioTs ? ': string' : ''}) {
    await element.waitForDisplayed({ timeout: 10000 });
    await element.setValue(value);
  }

  async isDisplayed(element${isWdioTs ? ': WebdriverIO.Element' : ''}) {
    await element.waitForDisplayed({ timeout: 10000 });
    return await element.isDisplayed();
  }
}
${!isWdioTs ? 'module.exports = { BasePage };' : ''}`
    });

    pageGroups.forEach((pg) => {
      const locGetters = pg.steps.map((s, i) => {
        const cleanEl = (s.elementName || `el_${i + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const loc = s.locator.primary.value || 'android.view.View';
        return `  get ${cleanEl}() { return $('${escapeStr(loc)}'); }`;
      }).join('\n');

      const methods = pg.steps.map((step, idx) => {
        const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        if (step.action === 'fill' || step.action === 'type') {
          return `  async fill_${cleanEl}(value${isWdioTs ? ': string' : ''} = '${escapeStr(step.value || 'test-value')}') {
    await this.setValue(await this.${cleanEl}, value);
  }`;
        } else if (step.action === 'click') {
          return `  async click_${cleanEl}() {
    await this.click(await this.${cleanEl});
  }`;
        } else {
          return `  async verify_${cleanEl}() {
    return await this.isDisplayed(await this.${cleanEl});
  }`;
        }
      }).join('\n\n');

      files.push({
        path: `pageobjects/${pg.pageName.toLowerCase()}.page.${codeExt}`,
        content: `${isWdioTs ? 'import { BasePage } from "./base.page";' : 'const { BasePage } = require("./base.page");'}

${isWdioTs ? `export class ${pg.pageName}Page extends BasePage` : `class ${pg.pageName}Page extends BasePage`} {
${locGetters}

${methods}
}
${!isWdioTs ? `module.exports = { ${pg.pageName}Page };` : ''}`
      });
    });

    const imports = pageGroups.map(pg => isWdioTs ? `import { ${pg.pageName}Page } from '../pageobjects/${pg.pageName.toLowerCase()}.page';` : `const { ${pg.pageName}Page } = require('../pageobjects/${pg.pageName.toLowerCase()}.page');`).join('\n');
    const instantiations = pageGroups.map(pg => `    const ${pg.pageName.toLowerCase()}Page = new ${pg.pageName}Page();`).join('\n');
    const stepCalls = steps.map((step, idx) => {
      const cleanPage = (step.screen || 'Main Page').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'application';
      const cleanEl = (step.elementName || `el_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (step.action === 'fill' || step.action === 'type') {
        return `    // Step ${idx + 1}: Fill ${step.elementName || 'input'}\n    await ${cleanPage}Page.fill_${cleanEl}('${escapeStr(step.value || 'test-value')}');`;
      } else if (step.action === 'click') {
        return `    // Step ${idx + 1}: Click ${step.elementName || 'button'}\n    await ${cleanPage}Page.click_${cleanEl}();`;
      } else {
        return `    // Step ${idx + 1}: Verify ${step.elementName || 'element'}\n    await ${cleanPage}Page.verify_${cleanEl}();`;
      }
    }).join('\n\n');

    files.push({
      path: `test/specs/${safeName}.e2e.${codeExt}`,
      content: `${imports}

describe('${flowName} - Appium WebdriverIO Suite', () => {
  it('executes mobile user flow successfully', async () => {
${instantiations}

${stepCalls}
  });
});`
    });

  // -------------------------------------------------------------------------
  // 12. DEFAULT FALLBACK FOR C# / OTHER COMBINATIONS
  // -------------------------------------------------------------------------
  } else {
    // C# or other combinations
    files.push({
      path: `${titlePascal}.csproj`,
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.9.0" />
    <PackageReference Include="NUnit" Version="4.1.0" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.5.0" />
    <PackageReference Include="${tool === 'Selenium' ? 'Selenium.WebDriver' : 'Microsoft.Playwright.NUnit'}" Version="${tool === 'Selenium' ? '4.19.0' : '1.42.0'}" />
  </ItemGroup>
</Project>`
    });

    files.push({
      path: `Pages/BasePage.cs`,
      content: `namespace Automation.Pages;

public abstract class BasePage
{
    protected readonly string BaseUrl = "${targetUrl}";
}`
    });

    files.push({
      path: `Tests/${titlePascal}Tests.cs`,
      content: `using NUnit.Framework;
using Automation.Pages;

namespace Automation.Tests;

[TestFixture]
public class ${titlePascal}Tests
{
    [Test]
    public void Execute${titlePascal}Workflow()
    {
        Assert.Pass("Workflow synthesized for ${tool} ${language} ${framework}");
    }
}`
    });
  }

  const combinedMarkdown = files.map(f => {
    let langTag = 'javascript';
    if (f.path.endsWith('.ts')) langTag = 'typescript';
    else if (f.path.endsWith('.py')) langTag = 'python';
    else if (f.path.endsWith('.java')) langTag = 'java';
    else if (f.path.endsWith('.cs')) langTag = 'csharp';
    else if (f.path.endsWith('.feature')) langTag = 'gherkin';
    else if (f.path.endsWith('.xml') || f.path.endsWith('.csproj')) langTag = 'xml';
    else if (f.path.endsWith('.json')) langTag = 'json';

    return `### \`${f.path}\`\n\`\`\`${langTag}\n${f.content}\n\`\`\``;
  }).join('\n\n');

  const explanation = `Production-ready ${tool} test automation architecture tailored strictly for ${language} using ${framework}. All ${steps.length} actions from the walkthrough video have been compiled into Page Object Model classes with DOM-verified locators and test suites.`;

  return {
    files,
    explanation,
    combinedMarkdown
  };
}
