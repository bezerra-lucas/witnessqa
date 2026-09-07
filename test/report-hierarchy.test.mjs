import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { PNG } from 'pngjs';
import { buildReportModel, validateReportModel, digest } from '../worker/src/report-model.mjs';
import { packRun } from '../worker/src/packer.mjs';
import { launchBrowser } from '../worker/src/browser.mjs';
import { parseScenario } from '../worker/src/scenario.mjs';

function fixture(root, suffix = '', verdict = 'pass') {
  const run = join(root, 'run' + suffix);
  mkdirSync(run, { recursive: true });
  for (const [name, title, flow, shots] of [
    ['checkout', 'Confirmar pedido', 'checkout', 3],
    ['payment', 'Validar método de pagamento', 'checkout', 2],
    ['login', 'Exibir acesso à conta', 'auth', 0],
  ]) {
    const dir = join(run, name);
    mkdirSync(dir);
    const screenshots = [];
    const steps = [];
    for (let i = 0; i < shots; i++) {
      const file = `step-${i}.png`;
      const image = new PNG({ width: 320, height: 180 });
      for (let pixel = 0; pixel < image.data.length; pixel += 4) {
        image.data[pixel] = name === 'checkout' ? 24 : 120;
        image.data[pixel + 1] = 90;
        image.data[pixel + 2] = 80;
        image.data[pixel + 3] = 255;
      }
      // Deliberately repeated bytes. They must not become extra tests or flows.
      writeFileSync(join(dir, file), PNG.sync.write(image));
      screenshots.push(file);
      steps.push({ index: i, ok: verdict !== 'fail' || i !== 1, step: { expectVisible: '#order' }, screenshot: file });
    }
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ privacyVersion: 1, name, title,
      app: 'https://shop.test', flow: { id: flow, title: flow === 'checkout' ? 'Finalizar um pedido' : 'Acessar conta' },
      verdict, startedAt: `2026-09-07T0${suffix ? 3 : 2}:00:00Z`, screenshots, steps,
      consoleErrors: [], evidenceMetadata: [{ file: 'step-0.png', label: 'Revisão do pedido', highlight: true, capturedAt: '2026-09-07T02:00:01Z' }] }));
  }
  return run;
}

test('explicit flows contain tests and typed evidence without changing originals', () => {
  const root = mkdtempSync(join(tmpdir(), 'wq-hierarchy-'));
  const run = fixture(root);
  const before = digest(readFileSync(join(run, 'checkout', 'result.json')));
  const model = buildReportModel(run);
  assert.equal(model.flows.length, 2);
  assert.equal(model.tests.length, 3);
  assert.equal(model.evidence.filter(item => item.kind === 'screenshot').length, 5);
  assert.equal(model.evidence.filter(item => item.kind === 'json').length, 3);
  const checkout = model.tests.find(item => item.name === 'checkout');
  const evidence = model.evidence.filter(item => item.testId === checkout.id && item.kind === 'screenshot');
  assert.equal(evidence.filter(item => item.featured).length, 1);
  assert.equal(evidence.find(item => item.featured).title, 'Revisão do pedido');
  assert.equal(evidence.filter(item => item.duplicateOf).length, 2);
  assert.equal(evidence.at(-1).capturedAt, null, 'capture time is not inferred from test start');
  const info = packRun(run);
  assert.equal(info.flows, 3, 'legacy alias remains test count');
  assert.equal(info.flowCount, 2);
  assert.equal(info.tests, 3);
  assert.equal(digest(readFileSync(join(run, 'checkout', 'result.json'))), before);
});

test('failure capture takes priority over a declared highlight', () => {
  const run = fixture(mkdtempSync(join(tmpdir(), 'wq-feature-')), '', 'fail');
  const model = buildReportModel(run);
  const featured = model.evidence.filter(item => item.featured);
  assert.equal(featured.length, 2);
  assert.ok(featured.every(item => item.stepIndex === 1));
});

test('same scenario names in separate runs keep distinct identity and selected-run verdict', () => {
  const root = mkdtempSync(join(tmpdir(), 'wq-runs-'));
  const first = fixture(root, '', 'pass');
  const second = fixture(root, '-previous', 'fail');
  const model = buildReportModel([first, second, first]);
  assert.equal(model.runs.length, 2);
  assert.equal(model.tests.length, 6);
  assert.equal(new Set(model.evidence.map(item => item.id)).size, 16);
  assert.equal(packRun([first, second]).stamp, 'PASS');
  assert.equal(packRun([second, first]).stamp, 'FAIL');
  const item = model.evidence[0];
  item.testId = model.tests.find(test => test.runId !== item.runId).id;
  assert.throws(() => validateReportModel(model), /same run/);
});

test('legacy scenarios, empty runs and metadata validation are explicit', () => {
  const doc = { name: 'legacy', steps: [{ goto: '/' }] };
  assert.deepEqual(parseScenario(doc, YAML), doc);
  assert.throws(() => parseScenario({ ...doc, flow: { title: 'missing id' } }, YAML), /Fluxo inválido/);
  assert.throws(() => parseScenario({ ...doc, title: [] }, YAML), /Teste inválido/);
  assert.throws(() => parseScenario({ ...doc, steps: [{ goto: '/', evidence: { highlight: 'yes' } }] }, YAML), /evidência inválidos/);
  const root = mkdtempSync(join(tmpdir(), 'wq-empty-'));
  assert.equal(packRun(root).stamp, 'BLOCKED');
  mkdirSync(join(root, 'legacy'));
  writeFileSync(join(root, 'legacy', 'result.json'), JSON.stringify({ name: 'legacy', verdict: 'pass', steps: [], screenshots: [] }));
  assert.equal(buildReportModel(root).flows[0].legacyGrouping, true);
});

test('shared renderer rejects forged digests, unsafe reference IDs and screenshot markup', () => {
  const run = fixture(mkdtempSync(join(tmpdir(), 'wq-model-boundary-')));
  const model = buildReportModel(run);
  const forged = structuredClone(model);
  forged.evidence[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateReportModel(forged), /digest/);
  const markup = structuredClone(model);
  markup.evidence[0].body = '" onerror="alert(1)';
  assert.throws(() => validateReportModel(markup), /base64/);
  const reference = { ...model.evidence[0], id: 'bad" onclick="x', testId: null,
    relatedFlowId: model.flows[0].id, sourceLabel: 'Older run' };
  model.references.push(reference);
  assert.throws(() => validateReportModel(model), /identities/);
});

test('report HTML is offline and escapes markup in every new metadata field', () => {
  const run = fixture(mkdtempSync(join(tmpdir(), 'wq-metadata-')));
  const source = join(run, 'checkout', 'result.json');
  const result = JSON.parse(readFileSync(source, 'utf8'));
  result.flow.title = '</summary><img src=x onerror="window.pwned=1">';
  result.title = '</script><script>window.pwned=1</script>';
  writeFileSync(source, JSON.stringify(result));
  const html = readFileSync(packRun(run).path, 'utf8');
  assert.doesNotMatch(html, /<script>window\.pwned=1<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /<(?:link|script)[^>]+(?:src|href)="https?:/);
  assert.match(html, /Fluxos → Testes → Evidências/);
  assert.match(html, /Sem captura de tela nesta execução/);
});

test('browser navigation follows flow → test → evidence and cannot cross runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wq-report-ui-'));
  const first = fixture(root);
  const second = fixture(root, '-previous', 'fail');
  const info = packRun([first, second]);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const exceptions = [];
  const requests = [];
  page.on('pageerror', error => exceptions.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  try {
    await page.goto(pathToFileURL(info.path).href);
    await page.waitForFunction(() => window.__reportReady);
    assert.equal(await page.locator('details.flow:visible').count(), 2);
    assert.equal(await page.locator('details.test:visible').count(), 0);
    assert.equal(await page.locator('.image-open:visible').count(), 0);
    const selected = page.locator('[data-run-section]:visible');
    const checkout = selected.locator('details.test[data-name="checkout"]');
    const checkoutId = await checkout.getAttribute('id');
    const flow = selected.locator('details.flow').filter({ has: page.locator('details.test[data-name="checkout"]') });
    await flow.locator('> summary').click();
    assert.equal(await selected.locator('details.test:visible').count(), 2);
    await checkout.locator('> summary').click();
    assert.equal(await checkout.locator('.image-open:visible').count(), 1);
    assert.equal(await checkout.locator('.more-evidence').getAttribute('open'), null);
    await checkout.locator('.image-open:visible').click();
    assert.equal(await page.locator('#lightbox').evaluate(dialog => dialog.open), true);
    assert.match(await page.locator('#lbCap').textContent(), /Finalizar um pedido → Confirmar pedido/);
    const currentOrigin = await page.locator('#lbOrigin').textContent();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#lbOrigin').textContent(), /checkout\//);
    assert.ok((await page.locator('#lbOrigin').textContent()).startsWith('run · '));
    assert.ok(currentOrigin.startsWith('run · '));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#lightbox').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.matches('.image-open')), true);
    await checkout.locator('.more-evidence > summary').click();
    assert.equal(await checkout.locator('.image-open:visible').count(), 3);
    assert.equal(await checkout.locator('.duplicate:visible').count(), 2);

    // A deep link expands the flow and test, and selects the right run.
    const runIds = await page.locator('#run-select option').evaluateAll(options => options.map(option => option.value));
    await page.selectOption('#run-select', runIds[1]);
    assert.equal(await page.locator('#run-status').textContent(), 'FAIL');
    assert.equal(await page.locator('details.test:visible').count(), 0);
    await page.evaluate(id => { location.hash = id; }, checkoutId);
    await page.waitForFunction(id => document.getElementById(id).open, checkoutId);
    assert.equal(await page.locator('#run-select').inputValue(), runIds[0]);
    assert.equal(await page.locator('#run-status').textContent(), 'PASS');
    await page.selectOption('#status-filter', 'images');
    assert.match(await page.locator('#filter-counter').textContent(), /^2 testes/);
    await page.fill('#test-search', 'impossible-result-zzzz');
    assert.equal(await page.locator('.empty-search:visible').count(), 1);
    await page.locator('#clear-filters').click();
    assert.match(await page.locator('#filter-counter').textContent(), /^3 testes/);

    // Test the real mobile touch target path as well as nested geometry.
    for (const width of [360, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      const geometry = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
        evidence: [...document.querySelectorAll('.evidence')].filter(el => el.getClientRects().length).map(el => {
          const box = el.getBoundingClientRect(); const img = el.querySelector('img')?.getBoundingClientRect();
          return !img || (img.left >= box.left - 1 && img.right <= box.right + 1);
        }) }));
      assert.ok(geometry.document <= geometry.width, JSON.stringify(geometry));
      assert.ok(geometry.evidence.every(Boolean), `Evidence clipped at ${width}`);
    }
    if (process.env.WITNESS_REPORT_TEST_ARTIFACTS) {
      const out = process.env.WITNESS_REPORT_TEST_ARTIFACTS;
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { for (const detail of document.querySelectorAll('details')) detail.open = false; scrollTo(0, 0); });
      await page.screenshot({ path: join(out, 'flows-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(out, 'flows-mobile.png') });
      copyFileSync(info.path, join(out, 'REPORT.html'));
    }
    assert.deepEqual(exceptions, []);
    assert.deepEqual(requests, [], 'offline report must not request fonts, scripts, styles or analytics');
  } finally { await browser.close(); }
}, { timeout: 60_000 });
