import { RecordedStep } from '../types';

export interface MobileStepMetrics {
  targetBox?: { x: number; y: number; width: number; height: number };
  coordinates?: { x: number; y: number };
  screenWidth?: number;
  screenHeight?: number;
  normalizedX?: number;
  normalizedY?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  duration?: number;
  normalizedX1?: number;
  normalizedY1?: number;
  normalizedX2?: number;
  normalizedY2?: number;
  recordOnly?: boolean;
}

export function buildMobileRecordedStep(
  elem: any,
  action: string,
  value: string | undefined,
  screen: string,
  metrics?: MobileStepMetrics,
  screenshot?: string | null
): any {
  const primaryType = elem.resourceId
    ? 'resource-id'
    : elem.accessibilityId
      ? 'accessibility-id'
      : elem.contentDescription
        ? 'content-desc'
        : elem.text
          ? 'text'
          : 'xpath';
  const primaryValue = elem.resourceId || elem.accessibilityId || elem.contentDescription || elem.text || elem.xpath ||
    `//*[contains(@text, '${elem.name || 'element'}')]`;
  const targetName = elem.name || elem.text || primaryValue || 'Mobile Element';
  const xpath = elem.xpath || `//*[@text='${primaryValue}']`;

  let appium = '';
  if (action === 'click') {
    appium = primaryType === 'resource-id'
      ? `// Tap ${targetName}\nawait driver.elementById(${JSON.stringify(primaryValue)}).click();`
      : primaryType === 'accessibility-id'
        ? `// Tap ${targetName}\nawait driver.elementByAccessibilityId(${JSON.stringify(primaryValue)}).click();`
        : `// Tap ${targetName}\nconst el = await driver.elementByXPath(${JSON.stringify(xpath)});\nawait el.click();`;
  } else if (action === 'fill') {
    appium = primaryType === 'resource-id'
      ? `// Type into ${targetName}\nawait driver.elementById(${JSON.stringify(primaryValue)}).type(${JSON.stringify(value || '')});`
      : `// Type into ${targetName}\nconst el = await driver.elementByXPath(${JSON.stringify(xpath)});\nawait el.sendKeys(${JSON.stringify(value || '')});`;
  } else if (action === 'assertion') {
    appium = `// Assert ${targetName} is visible\nconst el = await driver.elementByXPath(${JSON.stringify(xpath)});\nexpect(await el.isDisplayed()).toBe(true);`;
  } else if (action === 'long_press') {
    appium = `// Long press ${targetName}\nconst el = await driver.elementByXPath(${JSON.stringify(xpath)});\nawait new TouchAction(driver).longPress({ element: el, duration: 1500 }).release().perform();`;
  } else if (action === 'swipe') {
    appium = `await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: ${metrics?.x1 ?? 0}, y: ${metrics?.y1 ?? 0} }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: ${metrics?.duration ?? 300} }, { type: 'pointerMove', duration: ${metrics?.duration ?? 300}, x: ${metrics?.x2 ?? 0}, y: ${metrics?.y2 ?? 0} }, { type: 'pointerUp', button: 0 }] }]);`;
  } else if (action === 'press') {
    appium = `await driver.pressKeyCode(${value === 'Back' ? 4 : value === 'Home' ? 3 : 187});`;
  }

  return {
    id: `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    action,
    value,
    elementName: targetName,
    locator: {
      primary: { type: primaryType, value: primaryValue, playwright: appium, bounds: elem.bounds },
      alternatives: [
        elem.resourceId ? { type: 'resource-id', value: elem.resourceId } : null,
        elem.accessibilityId ? { type: 'accessibility-id', value: elem.accessibilityId } : null,
        elem.contentDescription ? { type: 'content-desc', value: elem.contentDescription } : null,
        elem.text ? { type: 'text', value: elem.text } : null,
        elem.xpath ? { type: 'xpath', value: elem.xpath } : null
      ].filter(Boolean)
    },
    screen: (elem.screen || screen || 'MAIN').toUpperCase(),
    platform: 'mobile',
    bounds: elem.bounds,
    node: {
      resourceId: elem.resourceId,
      accessibilityId: elem.accessibilityId,
      contentDescription: elem.contentDescription,
      text: elem.text,
      className: elem.type,
      clickable: elem.clickable,
      enabled: elem.enabled,
      editable: elem.editable,
      focusable: elem.focusable,
      focused: elem.focused,
      hint: elem.hint,
      bounds: elem.bounds
    },
    target: {
      resourceId: elem.resourceId,
      accessibilityId: elem.accessibilityId,
      contentDescription: elem.contentDescription,
      text: elem.text,
      className: elem.type,
      clickable: elem.clickable,
      enabled: elem.enabled,
      editable: elem.editable,
      focusable: elem.focusable,
      focused: elem.focused,
      hint: elem.hint,
      bounds: elem.bounds
    },
    targetBox: metrics?.targetBox,
    coordinates: metrics?.coordinates,
    x: metrics?.coordinates?.x,
    y: metrics?.coordinates?.y,
    screenWidth: metrics?.screenWidth,
    screenHeight: metrics?.screenHeight,
    normalizedX: metrics?.normalizedX,
    normalizedY: metrics?.normalizedY,
    x1: metrics?.x1,
    y1: metrics?.y1,
    x2: metrics?.x2,
    y2: metrics?.y2,
    duration: metrics?.duration,
    normalizedX1: metrics?.normalizedX1,
    normalizedY1: metrics?.normalizedY1,
    normalizedX2: metrics?.normalizedX2,
    normalizedY2: metrics?.normalizedY2,
    screenshot: screenshot || undefined,
    timestamp: Date.now()
  };
}

export function mergeMobileRecordedSteps(current: RecordedStep[], incoming: any[], email: string): RecordedStep[] {
  const ids = new Set(current.map(step => step.id));
  const normalizedEmail = email.toLowerCase();
  const additions: RecordedStep[] = [];

  for (const raw of incoming) {
    if (raw.__userEmail && String(raw.__userEmail).toLowerCase() !== normalizedEmail) continue;
    if (raw.id && ids.has(raw.id)) continue;
    const id = raw.id || `mobile-${raw.timestamp || Date.now()}-${additions.length}`;
    ids.add(id);
    additions.push({ ...raw, id, platform: 'mobile', screenshot: raw.screenshot || raw.image } as RecordedStep);
  }

  return additions.length ? [...current, ...additions] : current;
}

export function collectMobileStepScreenshots(steps: RecordedStep[]) {
  const stepScreenshots: Record<string, string> = {};
  const screenshots: string[] = [];
  for (const step of steps) {
    if (!step.screenshot) continue;
    stepScreenshots[step.id] = step.screenshot;
    screenshots.push(step.screenshot);
  }
  return { stepScreenshots, screenshots };
}

export function serializeStepsForLocalRecovery(steps: RecordedStep[]) {
  // PNG evidence is persisted with the saved flow. Keeping base64 frames in
  // localStorage quickly exceeds its small quota and can stop later updates.
  return JSON.stringify(steps.map(({ screenshot, ...step }) => step));
}
