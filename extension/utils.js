/**
 * Utility functions for the QA Recorder extension
 */

function generateLocatorBundle(el) {
  if (!el) return { primary: { type: 'css', value: 'body', playwright: "page.locator('body')", clickedIndex: 0, matchCount: 1, isUnique: true, confidence: 1 }, alternatives: [] };

  const esc = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const cssEsc = value => window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const add = (list, type, value, playwright, resolver, confidence) => {
    if (!value) return;
    let matches = [];
    try { matches = Array.from(resolver()); } catch (_) { return; }
    const clickedIndex = matches.indexOf(el);
    if (clickedIndex < 0 || matches.length === 0) return;
    const indexed = matches.length > 1 ? `${playwright}.nth(${clickedIndex})` : playwright;
    list.push({ type, value, playwright: indexed, clickedIndex, matchCount: matches.length, isUnique: matches.length === 1, confidence });
  };

  const candidates = [];
  const testAttrs = ['data-testid', 'data-test', 'test-id'];
  for (const attr of testAttrs) {
    const value = el.getAttribute(attr);
    add(candidates, attr === 'data-testid' ? 'data-testid' : 'data-test', value,
      attr === 'data-testid' ? `page.getByTestId('${esc(value)}')` : `page.locator('[${attr}="${esc(value)}"]')`,
      () => document.querySelectorAll(`[${attr}="${cssEsc(value)}"]`), 1);
  }
  if (el.id && !/^\d+$/.test(el.id)) add(candidates, 'id', `#${el.id}`, `page.locator('#${esc(el.id)}')`, () => document.querySelectorAll(`#${cssEsc(el.id)}`), .99);
  const name = el.getAttribute('name');
  if (name) add(candidates, 'name', name, `page.locator('[name="${esc(name)}"]')`, () => document.querySelectorAll(`[name="${cssEsc(name)}"]`), .96);
  const aria = el.getAttribute('aria-label');
  if (aria) add(candidates, 'aria-label', aria, `page.getByLabel('${esc(aria)}', { exact: true })`, () => Array.from(document.querySelectorAll('[aria-label]')).filter(n => n.getAttribute('aria-label') === aria), .94);

  // Role + accessible name.
  const roleMap = {
    'BUTTON': 'button',
    'A': 'link',
    'INPUT': el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox',
    'TEXTAREA': 'textbox',
    'SELECT': 'combobox',
    'H1': 'heading', 'H2': 'heading', 'H3': 'heading', 'H4': 'heading', 'H5': 'heading', 'H6': 'heading',
  };
  const role = el.getAttribute('role') || roleMap[el.tagName];
  if (role) {
    const name = el.getAttribute('aria-label') || el.title || el.innerText?.trim().substring(0, 30);
    if (name) {
        const sanitizedName = name.replace(/\s+/g, ' ').trim();
        add(candidates, 'role', `${role}[name="${sanitizedName}"]`, `page.getByRole('${role}', { name: '${esc(sanitizedName)}', exact: true })`, () => Array.from(document.querySelectorAll(role === 'button' ? 'button,[role="button"]' : role === 'link' ? 'a,[role="link"]' : `[role="${role}"],${role === 'textbox' ? 'input,textarea' : role === 'combobox' ? 'select' : '.__never__'}`)).filter(n => ((n.getAttribute('aria-label') || n.innerText || n.getAttribute('placeholder') || n.getAttribute('value') || '').replace(/\s+/g, ' ').trim()) === sanitizedName), .92);
    }
  }

  // 3. getByText (if short and unique-ish)
  const text = el.innerText?.trim();
  if (text && text.length > 0 && text.length < 40 && !text.includes('\n')) {
    const sanitizedText = text.replace(/\s+/g, ' ').trim();
    add(candidates, 'text', sanitizedText, `page.getByText('${esc(sanitizedText)}', { exact: true })`, () => Array.from(document.querySelectorAll('*')).filter(n => n.children.length === 0 && (n.textContent || '').replace(/\s+/g, ' ').trim() === sanitizedText), .75);
  }

  // 4. getByLabel (for inputs)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      add(candidates, 'label', ariaLabel, `page.getByLabel('${esc(ariaLabel)}', { exact: true })`, () => Array.from(document.querySelectorAll('[aria-label]')).filter(n => n.getAttribute('aria-label') === ariaLabel), .9);
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const labelText = wrappingLabel.innerText
        ?.replace(el.value || '', '').trim();
      if (labelText && labelText.length > 0 && labelText.length < 50) {
        const forId = wrappingLabel.getAttribute('for');
        add(candidates, 'label', labelText, `page.getByLabel('${esc(labelText)}', { exact: true })`, () => forId ? document.querySelectorAll(`#${cssEsc(forId)}`) : wrappingLabel.querySelectorAll('input,textarea,select'), .9);
      }
    }
  }

  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label && label.innerText.trim()) {
        const labelText = label.innerText.trim();
        add(candidates, 'label', labelText, `page.getByLabel('${esc(labelText)}', { exact: true })`, () => document.querySelectorAll(`#${cssEsc(el.id)}`), .9);
    }
  }

  // 5. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) add(candidates, 'placeholder', placeholder, `page.getByPlaceholder('${esc(placeholder)}', { exact: true })`, () => Array.from(document.querySelectorAll('[placeholder]')).filter(n => n.getAttribute('placeholder') === placeholder), .88);

  for (const attr of Array.from(el.attributes || [])) {
    if (/^(data-(?!react|vue|angular)|title$)/.test(attr.name) && !testAttrs.includes(attr.name) && attr.value && attr.value.length < 80) {
      add(candidates, 'css', `[${attr.name}="${attr.value}"]`, `page.locator('[${attr.name}="${esc(attr.value)}"]')`, () => document.querySelectorAll(`[${attr.name}="${cssEsc(attr.value)}"]`), .82);
    }
  }

  const stableClasses = Array.from(el.classList || []).filter(c => /^[a-zA-Z][\w-]*$/.test(c) && !/^(active|selected|hover|focus|disabled|ng-|css-|sc-)/i.test(c));
  for (const cls of stableClasses) add(candidates, 'css', `.${cls}`, `page.locator('.${esc(cls)}')`, () => document.querySelectorAll(`.${cssEsc(cls)}`), .8);

  // 6. CSS selector fallback
  const getUniqueCss = (element) => {
    let path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.id && !/^\d/.test(element.id)) {
        selector = '#' + element.id;
        path.unshift(selector);
        break;
      } else {
        let sibling = element;
        let nth = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.nodeName.toLowerCase() == selector) nth++;
        }
        if (nth != 1) selector += ":nth-of-type("+nth+")";
      }
      path.unshift(selector);
      
      // Handle Shadow DOM boundaries
      const parent = element.parentNode || (element.getRootNode && element.getRootNode().host);
      element = parent;
    }
    return path.join(" > ");
  };

  const css = getUniqueCss(el);
  add(candidates, 'css', css, `page.locator('${esc(css)}')`, () => document.querySelectorAll(css), .65);
  // A stable unique candidate is safer than a higher-ranked ambiguous one;
  // among candidates with the same uniqueness, retain declared priority.
  candidates.sort((a, b) => Number(b.isUnique && b.confidence >= .8) - Number(a.isUnique && a.confidence >= .8) || b.confidence - a.confidence);
  const primary = candidates[0];
  return { primary, alternatives: candidates.slice(1) };
}

function generateSelector(el) { return generateLocatorBundle(el).primary; }

function getElementInfo(el) {
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const roleMap = {
    'BUTTON': 'button',
    'A': 'link',
    'INPUT': el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox',
    'TEXTAREA': 'textbox',
    'SELECT': 'combobox',
  };
  const role = el.getAttribute('role') || roleMap[el.tagName] || el.tagName.toLowerCase();
  
  const locator = generateLocatorBundle(el);
  const locatorInfo = locator.primary;

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id,
    name: el.name,
    role: role,
    text: el.innerText?.trim().substring(0, 100),
    placeholder: el.getAttribute('placeholder'),
    value: el.value,
    type: el.type,
    selector: locatorInfo.value,
    locator,
    elementSnapshot: {
      tagName: el.tagName.toLowerCase(), id: el.id || '', className: el.className || '', name: el.getAttribute('name') || '',
      role, ariaLabel: el.getAttribute('aria-label') || '', textContent: (el.textContent || '').trim().substring(0, 500),
      placeholder: el.getAttribute('placeholder') || '', title: el.getAttribute('title') || '', href: el.getAttribute('href') || '',
      dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('test-id') || '',
      outerHTML: (el.outerHTML || '').substring(0, 2000), cssSelector: locatorInfo.type === 'css' ? locatorInfo.value : ''
    },
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    }
  };
}

// Export functions to global scope for content.js
window.QA_RECORDER_UTILS = {
  generateSelector,
  getElementInfo
};
