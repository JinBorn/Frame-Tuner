// Browser regressions for selection publication and reloading an empty registry.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright-core");
const { createWorkbenchService } = require("./workbench_service");
const { createSamplePackage } = require("./cocos/sample_package");
const { findBrowser, startExportServer } = require("./frame_tuner");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-selection-"));
  let server;
  let browser;
  let releaseSlow;
  try {
    const service = createWorkbenchService({ root });
    service.createProject({ label: "Only project", id: "only-project" });
    const sample = createSamplePackage();
    for (const [index, animationId] of ["initial", "slow", "fast"].entries()) {
      service.importAnimation({ projectId: "only-project", profileId: "hero", animationId,
        files: [{ name: `${animationId}.png`, data: `data:image/png;base64,${sample.files.get(`frames/demo_${index}.png`).toString("base64")}` }] });
    }
    server = await startExportServer(root);
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
    let slowRequests = 0;
    await page.route("**/asset?**", async (route) => {
      if (decodeURIComponent(route.request().url()).includes("/slow/")) {
        slowRequests += 1;
        await slowGate;
      }
      await route.continue();
    });
    await page.goto(`${server.url}/?project=only-project&group=initial`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.FrameTunerWorkbench.ready);
    await page.evaluate(() => {
      const api = window.FrameTunerWorkbench;
      window.pendingSlowSelection = api.selectGroup(api.groups().find((group) => group.animationId === "slow").groupId)
        .then(() => true, () => false);
    });
    const fast = await page.evaluate(async () => {
      const api = window.FrameTunerWorkbench;
      return api.selectGroup(api.groups().find((group) => group.animationId === "fast").groupId);
    });
    assert.ok(slowRequests > 0, "the slow image must actually be held in flight during the fast selection");
    releaseSlow();
    assert.equal(await page.evaluate(() => window.pendingSlowSelection), false);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().animationId), "fast");
    assert.equal(await page.locator("#groupSelect").inputValue(), fast.groupId);
    assert.match(await page.locator("#canvasTitle").textContent(), /fast/);

    // Hiding the sole optional integration leaves an empty visible registry.
    // The explicit empty project ID must not fall back to the old project.
    service.store.writeRegistry({ version: 1, activeProjectId: "", projects: [] });
    const requests = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/config") requests.push(request.url()); });
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.reload("")), true);
    assert.equal(new URL(requests.at(-1)).searchParams.has("project"), false);
    assert.equal(await page.evaluate(() => window.FrameTunerWorkbench.current().projectId), "");
    assert.equal(await page.evaluate(() => localStorage.getItem("xsxbFrameTuner.project")), null);
    assert.equal(await page.locator("#projectSelect option").count(), 1);
    assert.equal(await page.locator("#projectSelect").inputValue(), "");
    assert.equal(await page.locator("#filmstrip .thumb").count(), 0);
    assert.equal(await page.locator("#workbenchEmptyTitle").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("Workbench browser regressions passed: slow/fast selection stays consistent; explicit empty reload clears the removed sole project and stored selection.");
  } finally {
    releaseSlow?.();
    await browser?.close();
    server?.child.kill();
    // The only removed directory is this test's mkdtemp-owned temporary root.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^frame-tuner-selection-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
