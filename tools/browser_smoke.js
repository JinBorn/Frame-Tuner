const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createSamplePackage } = require('./cocos/sample_package');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-tuner-browser-'));
  process.env.FRAME_TUNER_ROOT = tempRoot;
  const { server } = require('./animation_tuner/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const executablePath = [process.env.FRAME_TUNER_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
  if (!executablePath) throw new Error('Set FRAME_TUNER_BROWSER to an installed Chrome or Edge executable.');
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    assert.equal(await page.locator('#workbenchEmptyTitle').isVisible(), true);
    await page.locator('#workbenchNewProject').click();
    await page.locator('#workbenchProjectName').fill('Forest Motion');
    await page.locator('#workbenchProjectSubmit').click();
    await page.locator('#workbenchImportDialog[open]').waitFor();
    const sample = createSamplePackage();
    const files = [...sample.files].filter(([name]) => name.endsWith('.png')).map(([name, buffer]) => ({ name: path.basename(name), mimeType: 'image/png', buffer }));
    await page.locator('#workbenchImageFiles').setInputFiles(files);
    await page.locator('#workbenchProfileId').fill('hero');
    await page.locator('#workbenchAnimationId').fill('idle');
    await page.locator('#workbenchImportSubmit').click();
    await page.waitForFunction(() => window.FrameTunerWorkbench.current().frameCount === 4 && !document.querySelector('#workbenchImportDialog').open);
    assert.equal(await page.locator('#filmstrip button button').count(), 0);
    assert.equal(await page.locator('#workbenchEmptyTitle').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('#projectBinding').textContent.includes('独立项目'));
    assert.equal(await page.locator('[data-panel="scene-scale"]').isVisible(), false);
    assert.equal(await page.locator('#workbenchOptionalFeatures').isVisible(), true);
    assert.equal(await page.locator('#workbenchPetsToggle').getAttribute('aria-checked'), 'false');

    // A refresh must not silently replace an edited frame. Cancel preserves it.
    await page.locator('label:has(> #frameDisabled)').click();
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().dirty), true);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#refreshProject').click();
    assert.equal(await page.locator('#frameDisabled').isChecked(), true);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().dirty), true);
    await page.locator('#save').click();
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving && !window.FrameTunerWorkbench.current().dirty);
    await page.locator('#refreshProject').click();
    await page.waitForFunction(() => window.FrameTunerWorkbench.current().ready && !window.FrameTunerWorkbench.current().loading);
    await page.locator('#filmstrip .thumb[data-frame-index="0"] .frameSelect').click();
    assert.equal(await page.locator('#frameDisabled').isChecked(), true);
    await page.locator('label:has(> #frameDisabled)').click();
    await page.locator('#save').click();
    await page.waitForFunction(() => !window.FrameTunerWorkbench.current().saving && !window.FrameTunerWorkbench.current().dirty);

    const result = await page.evaluate(async () => {
      const payload = await window.FrameTunerPortable.collectPayload({ format: 'sequence', padding: 24 });
      const response = await window.FrameTunerPortable.requestPackage(payload);
      const signature = [...new Uint8Array(await response.blob.slice(0, 4).arrayBuffer())];
      return { animations: payload.manifest.animations.length, frames: payload.manifest.animations[0].frames.length, duration: payload.manifest.animations[0].frames.reduce((sum, frame) => sum + frame.durationMs, 0), signature, size: response.blob.size };
    });
    assert.equal(result.animations, 1);
    assert.equal(result.frames, 4);
    assert.deepEqual(result.signature, [80, 75, 3, 4]);
    assert.ok(result.size > 1000);
    assert.ok(Math.abs(result.duration - 1000 / 12 * 4) < 2);

    // Exercise the user-facing download path, including the ZIP response and filename.
    const exportPanel = page.locator('details').filter({ has: page.locator('[data-export-format="sequence"]') });
    if ((await exportPanel.getAttribute('open')) === null) {
      await exportPanel.locator('summary').click();
    }
    await page.locator('#portableDestination').selectOption('download');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-export-format="sequence"]').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /_sequence\.zip$/);
    assert.equal(await download.failure(), null);
    const downloaded = fs.readFileSync(await download.path());
    assert.deepEqual([...downloaded.subarray(0, 4)], [80, 75, 3, 4]);
    await page.waitForFunction(() => !window.FrameTunerPortable.busy());

    const screenshotDir = path.join(__dirname, '..', '.tmp', 'verification');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshot = path.join(screenshotDir, `workbench-${Date.now()}.png`);
    await page.screenshot({ path: screenshot });
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const bounds = await page.evaluate(() => {
        const stage = document.querySelector('#stage');
        const rect = stage.getBoundingClientRect();
        const save = document.querySelector('#save').getBoundingClientRect();
        return { canvas: { width: rect.width, height: rect.height }, backing: { width: stage.width, height: stage.height }, save: { x: save.x, y: save.y, right: save.right, bottom: save.bottom }, width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth };
      });
      assert.ok(bounds.canvas.width > 200 && bounds.canvas.height > 100, JSON.stringify(bounds));
      assert.ok(bounds.save.x >= 0 && bounds.save.right <= bounds.width && bounds.save.y >= 0 && bounds.save.bottom <= bounds.height, JSON.stringify(bounds));
      assert.ok(bounds.scroll <= viewport.width + 1, `Horizontal overflow at ${viewport.width}`);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, browser: await browser.version(), executablePath, checks: ['create/import UI', 'neutral capabilities and optional Pets switch', 'unsaved refresh cancellation', 'save/reload', 'portable ZIP download UI', 'frame card semantics', 'three viewport sizes'], export: result, screenshot }, null, 2));
  } catch (error) {
    console.error(`Browser test workspace retained for diagnosis: ${tempRoot}`);
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
