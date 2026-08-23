(() => {
  const replacements = new Map([
    ['Session log', '会话日志'],
    ['Think', '思考'],
    ['Thinking', '正在思考'],
    ['(no output)', '（无输出）']
  ]);
  const skippedSelector = 'script, style, noscript, textarea, input, code, pre, kbd, samp, [contenteditable="true"]';
  const translatedAttributes = ['aria-label', 'title', 'placeholder'];

  const replacementFor = (value) => {
    const source = String(value || '');
    const match = source.match(/^(\s*)(.*?)(\s*)$/s);
    const translated = replacements.get(match?.[2]);
    return translated ? `${match[1]}${translated}${match[3]}` : undefined;
  };

  const translateTextNode = (node) => {
    const parent = node.parentElement;
    if (!parent || parent.closest(skippedSelector)) return;
    const replacement = replacementFor(node.nodeValue);
    if (replacement) node.nodeValue = replacement;
  };

  const translateAttributes = (element) => {
    if (!(element instanceof Element) || element.matches(skippedSelector)) return;
    for (const name of translatedAttributes) {
      const current = element.getAttribute(name);
      const replacement = replacementFor(current);
      if (replacement) element.setAttribute(name, replacement);
    }
  };

  const translateTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
    }
  };

  if (window.__DSH_LOCALIZATION__) {
    window.__DSH_LOCALIZATION__.refresh();
    return true;
  }

  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    for (const node of pending) translateTree(node);
    pending.clear();
  };
  const enqueue = (node) => {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') enqueue(record.target);
      else if (record.type === 'attributes') enqueue(record.target);
      else for (const node of record.addedNodes) enqueue(node);
    }
  });

  translateTree(document);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: translatedAttributes
  });

  window.__DSH_LOCALIZATION__ = Object.freeze({
    refresh: () => translateTree(document),
    disconnect: () => observer.disconnect()
  });
  return true;
})();
