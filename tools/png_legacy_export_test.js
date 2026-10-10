"use strict";

// Exercise the actual Lite buttons, compositor and HTTP encoder. Only native
// directory handles are replaced, so this test never writes to a user's folder.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright-core");
const { createLiteApp } = require("./frame_tuner_lite/server");
const { findBrowser, startExportServer } = require("./frame_tuner");

function request(url, route, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(route, url), {
      method: "POST", headers: { "content-type": "application/json", ...extraHeaders },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("PNG compression request timed out")));
    req.end(JSON.stringify(payload));
  });
}

async function rgba(png) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-legacy-png-"));
  let main, lite, browser;
  try {
    const width = 64, height = 48, raw = Buffer.alloc(width * height * 4);
    let seed = 20303;
    for (let index = 0; index < width * height; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[index * 4] = seed & 255; raw[index * 4 + 1] = (seed >>> 8) & 255; raw[index * 4 + 2] = (seed >>> 16) & 255;
      raw[index * 4 + 3] = [0, 64, 160, 255][Math.floor((index % width) / 16)];
    }
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0, palette: false }).toBuffer();
    const data = `data:image/png;base64,${png.toString("base64")}`;
    const mainRoot = path.join(root, "main"), liteRoot = path.join(root, "lite");
    main = await startExportServer(mainRoot);
    lite = createLiteApp({ root: liteRoot }).server;
    await new Promise(resolve => lite.listen(0, "127.0.0.1", resolve));
    const liteUrl = `http://127.0.0.1:${lite.address().port}`;
    const sourceFiles = new Map();
    for (const [name, url, directory] of [["main", main.url, mainRoot], ["lite", liteUrl, liteRoot]]) {
      let response = await request(url, "/api/workbench/projects", { id: "png-test", label: "PNG legacy export" });
      assert.equal(response.status, 201, response.bytes.toString());
      response = await request(url, "/api/workbench/import", {
        projectId: "png-test", profileId: "hero", animationId: "idle", fps: 12,
        files: [0, 1].map(index => ({ name: `idle_${index}.png`, data })),
      });
      assert.equal(response.status, 200, response.bytes.toString());
      const config = await (await fetch(`${url}/api/config?project=png-test`)).json();
      for (const frame of config.groups.find(group => group.profileId === "hero").frames) {
        const file = path.resolve(directory, frame.path);
        sourceFiles.set(file, fs.readFileSync(file));
      }
      const lossless = await request(url, "/api/workbench/compress-png", { projectId: "png-test", data });
      assert.equal(lossless.status, 200, `${name}: ${lossless.bytes.toString()}`);
      assert.equal(lossless.headers["content-type"], "image/png");
      assert.deepEqual(await rgba(lossless.bytes), await rgba(png), `${name}: default compression preserves every RGBA byte`);
      const report = JSON.parse(lossless.headers["x-frame-tuner-png-compression"]);
      assert.deepEqual(report, { quality: 100, files: 1, optimizedFiles: Number(lossless.bytes.length < png.length), inputBytes: png.length, outputBytes: lossless.bytes.length });
      const reduced = await request(url, "/api/workbench/compress-png", { projectId: "png-test", data, pngQuality: 45 });
      assert.equal(reduced.status, 200, reduced.bytes.toString());
      assert.equal(JSON.parse(reduced.headers["x-frame-tuner-png-compression"]).quality, 45);
      assert.ok(reduced.bytes.length < lossless.bytes.length, `${name}: lower quality reaches encoder and reduces size`);
      const info = (await rgba(reduced.bytes)).info;
      assert.equal(info.width, width); assert.equal(info.height, height); assert.equal(info.channels, 4);
      for (const payload of [
        { projectId: "missing-project", data },
        { projectId: "png-test", data, pngQuality: 0 },
        { projectId: "png-test", data, pngQuality: 101 },
        { projectId: "png-test", data, pngQuality: 2.5 },
        { projectId: "png-test", data, pngQuality: "invalid" },
        { projectId: "png-test", data: "data:image/png;base64,YmFk" },
        { projectId: "png-test", data: "data:image/png;base64," },
      ]) {
        const rejected = await request(url, "/api/workbench/compress-png", payload);
        assert.ok(rejected.status >= 400, `${name}: invalid input is rejected`);
        assert.ok(JSON.parse(rejected.bytes).error, `${name}: rejection contains an actionable message`);
      }
      for (const headers of [{ origin: "https://outside.example" }, { origin: "null" }, { host: "outside.example" }, { "sec-fetch-site": "cross-site" }]) {
        const rejected = await request(url, "/api/workbench/compress-png", { projectId: "png-test", data }, headers);
        assert.equal(rejected.status, 403, `${name}: existing local-origin protection covers compressor`);
      }
    }

    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const errors = [], posts = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", req => { if (req.url().endsWith("/api/workbench/compress-png")) posts.push(req.postDataJSON()); });
    await page.addInitScript(() => {
      window.memoryFiles = [];
      const directory = (prefix = "") => ({
        name: "test-output",
        getDirectoryHandle: async name => directory(`${prefix}${name}/`),
        getFileHandle: async name => ({ createWritable: async () => ({
          write: async blob => window.memoryFiles.push({ name: `${prefix}${name}`, bytes: [...new Uint8Array(await blob.arrayBuffer())] }),
          close: async () => {},
        }) }),
      });
      window.showDirectoryPicker = async () => directory();
    });
    await page.goto(`${liteUrl}/?project=png-test&export=1`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.XsxbFrameTunerLite.ready);
    await page.waitForFunction(() => document.querySelector("#liteExportSequence") && !document.querySelector("#liteExportSequence").disabled && document.querySelector("#portablePngQuality"));
    assert.equal(await page.locator("#portablePngQuality").inputValue(), "100");
    await page.locator("#liteCanvasPadding").fill("2");
    await page.locator("#liteSheetColumns").fill("2");
    for (const [kind, quality] of [["sequence", 100], ["sequence", 45], ["sheet", 100], ["sheet", 45]]) {
      posts.length = 0;
      await page.evaluate(() => { window.memoryFiles = []; });
      await page.locator("#portablePngQuality").fill(String(quality));
      await page.locator(kind === "sheet" ? "#liteExportSheet" : "#liteExportSequence").click();
      await page.waitForFunction(() => !document.querySelector("#liteExportSequence").disabled, null, { timeout: 30000 });
      const status = await page.locator("#liteExportStatus").textContent();
      assert.match(status, /^已导出/, `${kind}/${quality}: ${status}`);
      assert.match(status, /PNG .* KiB → .* KiB/, "legacy export displays actual compression sizes");
      const output = await page.evaluate(() => window.memoryFiles);
      const images = output.filter(file => file.name.endsWith(".png"));
      assert.equal(images.length, kind === "sheet" ? 1 : 2, `${kind}: actual button writes expected PNG files`);
      assert.equal(posts.length, images.length, "each final runtime PNG passes through the compressor once");
      for (let index = 0; index < images.length; index += 1) {
        assert.equal(posts[index].projectId, "png-test");
        assert.equal(posts[index].pngQuality, quality, "legacy controls use the shared quality value");
        const baked = Buffer.from(posts[index].data.split(",")[1], "base64");
        const bytes = Buffer.from(images[index].bytes);
        const decoded = await rgba(bytes), original = await rgba(baked);
        assert.equal(decoded.info.width, original.info.width); assert.equal(decoded.info.height, original.info.height);
        assert.equal(decoded.info.channels, 4); assert.ok(bytes.length <= baked.length);
        if (quality === 100) assert.deepEqual(decoded, original, "legacy default preserves rendered RGBA exactly");
      }
      const metadataFile = output.find(file => file.name.endsWith(kind === "sheet" ? "/spritesheet.json" : "/export.json"));
      assert.ok(metadataFile, `${kind}: accompanying JSON is written`);
      const metadata = JSON.parse(Buffer.from(metadataFile.bytes));
      assert.equal(Object.keys(metadata.frames).length, 2);
      if (kind === "sheet") {
        const info = (await rgba(Buffer.from(images[0].bytes))).info;
        assert.equal(metadata.meta.image, "spritesheet.png");
        assert.deepEqual(metadata.meta.size, { w: info.width, h: info.height });
      }
    }
    assert.deepEqual(errors, [], "legacy exports have no uncaught browser errors");
    for (const [file, bytes] of sourceFiles) assert.deepEqual(fs.readFileSync(file), bytes, "compressing exported PNGs does not modify imported disk assets");
    return { ok: true, assertions: "Main/Lite PNG endpoint lossless and quality, input/project/origin rejection, real Lite sequence/sheet buttons, shared quality, decodable directory output and JSON, untouched disk sources" };
  } finally {
    if (browser) await browser.close();
    if (lite?.listening) { lite.closeAllConnections(); await new Promise(resolve => lite.close(resolve)); }
    if (main?.child && main.child.exitCode === null) await new Promise(resolve => { main.child.once("exit", resolve); main.child.kill(); });
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-legacy-png-")) throw new Error("Unsafe temporary test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

if (require.main === module) test().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { test };
