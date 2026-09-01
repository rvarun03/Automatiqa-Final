/**
 * Utility functions for the QA Recorder extension
 */

function generateSelector(el) {
  if (!el) return { type: 'css', value: 'body', playwright: "page.locator('body')" };

  // 1. data-testid
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
  if (testId) return { type: 'data-testid', value: testId, playwright: `page.getByTestId('${testId}')` };

  // 2. getByRole
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
        return { type: 'role', value: `${role}[name="${sanitizedName}"]`, playwright: `page.getByRole('${role}', { name: '${sanitizedName}' })` };
    }
  }

  // 3. getByText (if short and unique-ish)
  const text = el.innerText?.trim();
  if (text && text.length > 0 && text.length < 40 && !text.includes('\n')) {
    const sanitizedText = text.replace(/\s+/g, ' ').trim();
    return { type: 'text', value: sanitizedText, playwright: `page.getByText('${sanitizedText}')` };
  }

  // 4. getByLabel (for inputs)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return {
        type: 'label',
        value: ariaLabel,
        playwright: `page.getByLabel('${ariaLabel}')`
      };
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const labelText = wrappingLabel.innerText
        ?.replace(el.value || '', '').trim();
      if (labelText && labelText.length > 0 && labelText.length < 50) {
        return {
          type: 'label',
          value: labelText,
          playwright: `page.getByLabel('${labelText}')`
        };
      }
    }
  }

  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label && label.innerText.trim()) {
        const labelText = label.innerText.trim();
        return { type: 'label', value: labelText, playwright: `page.getByLabel('${labelText}')` };
    }
  }

  // 5. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return { type: 'placeholder', value: placeholder, playwright: `page.getByPlaceholder('${placeholder}')` };

  // 6. CSS selector fallback
  if (el.id && !/^\d/.test(el.id)) return { type: 'css', value: `#${el.id}`, playwright: `page.locator('#${el.id}')` };
  
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
  return { type: 'css', value: css, playwright: `page.locator('${css}')` };
}

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
  
  const locatorInfo = generateSelector(el);

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
    locator: { primary: locatorInfo, alternatives: [] },
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
