const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { findBrowser } = require('../frame_tuner');

async function main() {
  const args = process.argv.slice(2);
  const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5189';
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => globalThis.__frameTunerDemo?.snapshot().ready);
    const snapshot = () => page.evaluate(() => globalThis.__frameTunerDemo.snapshot());
    await page.mouse.click(640, 400);
    const baseline = await snapshot();
    await page.keyboard.press('n');
    await page.waitForFunction(() => globalThis.__frameTunerDemo.snapshot().finished);
    const once = await snapshot();
    assert.equal(once.finishEvents, baseline.finishEvents + 1);
    assert.equal(once.sourceFrame, 3);
    assert.equal(once.playing, false);
    assert.ok(once.timeline.every((frame) => frame.sourceFrame !== 1), 'Disabled frame must never play.');
    const sequence = once.timeline.slice(-3);
    assert.deepEqual(sequence.map((frame) => frame.sourceFrame), [0, 2, 3]);
    const intervals = [sequence[1].timestampMs - sequence[0].timestampMs, sequence[2].timestampMs - sequence[1].timestampMs];
    assert.ok(Math.abs(intervals[0] - 120) <= 85, JSON.stringify(intervals));
    assert.ok(Math.abs(intervals[1] - 310) <= 85, JSON.stringify(intervals));
    assert.ok(once.audioEvents > baseline.audioEvents);
    assert.ok(once.boxes.some((box) => box.kind === 'hurtbox'));
    assert.ok(once.boxes.some((box) => box.kind === 'hitbox'));

    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => globalThis.__frameTunerDemo.snapshot().faceLeft);
    const mirrored = await snapshot();
    once.boxes.forEach((box, index) => box.corners.forEach((corner, point) => {
      assert.ok(Math.abs(corner.x + mirrored.boxes[index].corners[point].x) < 0.001);
      assert.ok(Math.abs(corner.y - mirrored.boxes[index].corners[point].y) < 0.001);
    }));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('l');
    await page.waitForFunction(() => globalThis.__frameTunerDemo.snapshot().cycles >= 2);
    await page.keyboard.press('Space');
    const paused = await snapshot();
    await page.waitForTimeout(250);
    const held = await snapshot();
    assert.equal(held.playing, false);
    assert.equal(held.sourceFrame, paused.sourceFrame);
    assert.equal(held.finishEvents, once.finishEvents);
    assert.equal(held.timeline.length, paused.timeline.length);
    assert.equal(held.error, '');
    assert.deepEqual(errors, []);
    const directory = path.join(__dirname, '..', '..', '.tmp', 'verification');
    fs.mkdirSync(directory, { recursive: true });
    const screenshot = path.join(directory, `cocos-runtime-${Date.now()}.png`);
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify({ ok: true, engine: 'Cocos Creator 3.8.8 web-desktop build', checks: ['asset loading', 'unequal timing', 'disabled frame skip', 'one finish event', 'loop and pause', 'facing and box coordinates', 'audio events'], measuredFrameIntervalsMs: intervals, audioEvents: held.audioEvents, screenshot }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
