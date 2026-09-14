// Assertions observe rendered content, retrying until their deadline. Negative
// assertions must follow an application readiness condition: absence alone
// cannot prove that a future asynchronous error will never appear.
export async function waitForText(page, spec, { absent = false, timeout = 8000 } = {}) {
  const locator = page.locator(spec.selector);
  const deadline = performance.now() + timeout;
  do {
    const count = await locator.count();
    if (count > 1) throw new Error('Text assertion selector is ambiguous');
    if (count === 1) {
      const observation = await locator.evaluate((root, text) => {
        const style = getComputedStyle(root);
        const visible = root.checkVisibility
          ? root.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : root.getClientRects().length > 0 && style.visibility !== 'hidden';
        let rendered = '';
        if (visible) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || parent.closest('script, style, template')) continue;
            if (parent.checkVisibility && !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
            rendered += node.textContent;
          }
        }
        return { visible, matches: visible && rendered.includes(text) };
      }, spec.text).catch(() => null); // A rerender/navigation can detach the node.
      if (observation && (absent ? !observation.matches : observation.matches)) return;
    }
    await page.waitForTimeout(Math.min(100, Math.max(0, deadline - performance.now())));
  } while (performance.now() < deadline);
  throw new Error(absent ? 'Forbidden text is still visible or its scope is absent' : 'Expected visible text was not found');
}

export async function waitUntilReady(page, ready) {
  if (!ready) return;
  const spec = typeof ready === 'string' ? { selector: ready } : ready;
  const timeout = spec.timeout ?? 8000;
  await page.locator(spec.selector).waitFor({ state: 'visible', timeout });
  if (spec.text !== undefined) await waitForText(page, spec, { timeout });
}
