import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { encodeScreenshot, decodeScreenshot, imageDimensions, writeImage } from '../worker/src/evidence-image.mjs';
import { createEvidenceGuard } from '../worker/src/privacy.mjs';
import { exportArtifact } from '../worker/src/export-artifact.mjs';
import { buildReportModel } from '../worker/src/report-model.mjs';
import { visualDiff } from '../worker/src/vdiff.mjs';
import { launchBrowser } from '../worker/src/browser.mjs';

function bitmap(changed = false) {
  const png = new PNG({ width: 120, height: 60 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    png.data.set([x * 2, y * 4, changed && x > 60 ? 255 : 32, 255], i);
  }
  return PNG.sync.write(png);
}

function result(directory, files) {
  mkdirSync(directory, { recursive: true });
  createEvidenceGuard().writeJson(join(directory, 'result.json'), {
    name: 'image test', verdict: 'pass', privacyVersion: 1, screenshots: files,
    steps: files.map((name, index) => ({ index, screenshot: name, ok: true, step: { expectText: 'ready' } })),
  });
}

test('lossless WebP preserves screenshot pixels and dimensions', async () => {
  const png = bitmap();
  const webp = await encodeScreenshot(png);
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
  assert.deepEqual(await decodeScreenshot(webp), await decodeScreenshot(png));
  assert.deepEqual(imageDimensions(webp), { width: 120, height: 60 });
  assert.deepEqual(await encodeScreenshot(png, 'png'), png, 'Explicit PNG compatibility stores only PNG');
});

test('capture stores only WebP, reuses identical bytes and keeps step files independent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wq-images-'));
  const guard = createEvidenceGuard();
  let frame = bitmap();
  const page = {
    locator(selector) { return { selector }; },
    getByText(text) { return { text }; },
    async screenshot(options) {
      assert.equal(options.path, undefined, 'No intermediate PNG on disk');
      assert.equal(options.type, 'png');
      assert.ok(options.mask.some(mask => mask.selector === 'input'));
      return frame;
    },
  };
  const a = join(dir, 'step-00.webp');
  const b = join(dir, 'step-01.webp');
  assert.equal(await guard.captureScreenshot(page, a), true);
  assert.equal(await guard.captureScreenshot(page, b), true);
  assert.deepEqual(readdirSync(dir).sort(), ['step-00.webp', 'step-01.webp']);
  assert.equal(statSync(a).nlink, 1);
  assert.equal(statSync(b).nlink, 1);
  const original = readFileSync(b);
  frame = bitmap(true);
  assert.equal(await guard.captureScreenshot(page, a), true);
  assert.deepEqual(readFileSync(b), original, 'Rerun cannot rewrite an earlier capture');
  assert.notDeepEqual(readFileSync(a), original);
  if (process.platform !== 'win32') assert.equal(statSync(a).mode & 0o777, 0o600);
  frame = Buffer.from('not an image');
  assert.equal(await guard.captureScreenshot(page, a), false);
  assert.deepEqual(readdirSync(dir), ['step-01.webp'], 'Failed encoding leaves no stale or partial screenshot');
});

test('image reuse never creates evidence symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wq-image-link-'));
  const bytes = bitmap();
  const original = join(dir, 'outside.png');
  const linked = join(dir, 'linked.png');
  const target = join(dir, 'target.png');
  writeFileSync(original, bytes);
  symlinkSync(original, linked);
  writeImage(target, bytes, linked);
  writeFileSync(target, 'replacement');
  assert.deepEqual(readFileSync(original), bytes);
});

test('PNG and WebP visual diff compares pixels and still detects real changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wq-codec-diff-'));
  const before = join(root, 'before'); const after = join(root, 'after');
  result(join(before, 'flow'), ['step-00.png']);
  result(join(after, 'flow'), ['step-00.webp']);
  writeFileSync(join(before, 'flow/step-00.png'), bitmap());
  writeFileSync(join(after, 'flow/step-00.webp'), await encodeScreenshot(bitmap()));
  const same = await visualDiff(before, after);
  assert.equal(same.compared, 1);
  assert.equal(same.changed + same.added + same.removed, 0);
  writeFileSync(join(after, 'flow/step-00.webp'), await encodeScreenshot(bitmap(true)));
  const different = await visualDiff(before, after, join(root, 'diff'));
  assert.equal(different.changed, 1);
  assert.ok(different.rows[0].pct > 0);
  result(join(after, 'flow'), ['step-00.webp', 'step-00.png']);
  writeFileSync(join(after, 'flow/step-00.png'), bitmap());
  const mixed = await visualDiff(before, after);
  assert.equal(mixed.compared, 2, 'Distinct files in a mixed-format run cannot collapse into one');
  assert.equal(mixed.added, 1);
});

test('export and offline report share images without merging evidence identities', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wq-webp-report-'));
  const run = join(root, 'run'); const out = join(root, 'out');
  const bytes = await encodeScreenshot(bitmap());
  for (const name of ['a', 'b']) {
    result(join(run, name), ['step-00.webp', 'step-01.webp']);
    for (const step of ['step-00.webp', 'step-01.webp']) writeFileSync(join(run, name, step), bytes);
  }
  const exported = exportArtifact(run, out);
  const model = buildReportModel(out);
  const shots = model.evidence.filter(item => item.kind === 'screenshot');
  assert.equal(shots.length, 4);
  assert.equal(new Set(shots.map(item => item.testId)).size, 2);
  assert.equal(new Set(shots.map(item => item.id)).size, 4);
  assert.ok(shots.every(item => item.contentType === 'image/webp' && item.width === 120));
  assert.equal(readdirSync(join(out, 'REPORT.assets')).length, 1);
  assert.equal(statSync(join(out, 'a/step-00.webp')).nlink, 1);
  assert.equal(statSync(join(out, 'b/step-01.webp')).nlink, 1);
  const html = readFileSync(exported.report, 'utf8');
  assert.doesNotMatch(html, /src="data:image|PNG original/);
  assert.match(html, /REPORT\.assets\/[a-f0-9]{64}\.webp/);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(exported.report).href);
    await page.evaluate(() => document.querySelectorAll('details').forEach(item => item.open = true));
    const image = page.locator('.image-open img').first();
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(img => img.decode());
    assert.equal(await image.evaluate(img => img.naturalWidth), 120);
    await page.locator('.image-open').first().click();
    await page.locator('#lbImg').evaluate(img => img.decode());
    const popupPromise = context.waitForEvent('page');
    await page.locator('#lbDownload').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.match(popup.url(), /REPORT\.assets\/[a-f0-9]{64}\.webp$/);
    await popup.close();
    const server = createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      response.setHeader('Content-Type', pathname.endsWith('.webp') ? 'image/webp' : 'text/html');
      try { response.end(readFileSync(join(out, pathname))); }
      catch { response.statusCode = 404; response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
    await page.goto(`http://127.0.0.1:${server.address().port}/REPORT.html`);
    await page.evaluate(() => document.querySelectorAll('details').forEach(item => item.open = true));
    await page.locator('.image-open').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#lbDownload').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'step-01.webp');
    assert.deepEqual(readFileSync(await download.path()), bytes);
    } finally { await new Promise(resolve => server.close(resolve)); }
    await context.close();
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await noJs.newPage();
    await staticPage.goto(pathToFileURL(exported.report).href);
    await staticPage.locator('details.flow > summary').first().click();
    await staticPage.locator('details.test > summary').first().click();
    const staticImage = staticPage.locator('.image-open img:visible').first();
    await staticImage.scrollIntoViewIfNeeded();
    await staticImage.evaluate(img => img.decode());
    assert.equal(await staticImage.evaluate(img => img.naturalWidth), 120);
    await noJs.close();
  } finally { await browser.close(); }
});
