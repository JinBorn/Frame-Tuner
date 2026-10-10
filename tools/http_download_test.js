"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createLiteApp } = require("./frame_tuner_lite/server");
const { startExportServer } = require("./frame_tuner");
const { createSamplePackage } = require("./cocos/sample_package");
const { unzip } = require("./export_package_test");

async function test() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-http-download-"));
  let main, lite;
  try {
    const sample = createSamplePackage();
    const projectIds = ["english-export", "中文导出-𠮷-café"];
    const cases = [...projectIds].reverse().map(projectId => ({ projectId, exportedId: projectId, filename: projectId }));
    cases.push({ projectId: projectIds[1], exportedId: "中文/\\\"\r\n😀名称", filename: "中文______名称" });
    const files = [...sample.files].map(([name, data]) => ({ path: name, encoding: "base64", data: data.toString("base64") }));
    main = await startExportServer(path.join(root, "main"));
    lite = createLiteApp({ root: path.join(root, "lite") }).server;
    await new Promise(resolve => lite.listen(0, "127.0.0.1", resolve));
    for (const [serverName, url] of [["main", main.url], ["lite", `http://127.0.0.1:${lite.address().port}`]]) {
      const post = (route, payload) => fetch(`${url}${route}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10000), body: JSON.stringify(payload),
      });
      for (const projectId of projectIds) {
        const created = await post("/api/workbench/projects", { id: projectId, label: projectId });
        assert.equal(created.status, 201);
        assert.equal((await created.json()).projectId, projectId);
        const imported = await post("/api/workbench/import", { projectId, profileId: "hero", animationId: "idle", files: [
          { name: "frame.png", data: `data:image/png;base64,${sample.files.get("frames/demo_0.png").toString("base64")}` },
        ] });
        assert.equal(imported.status, 200, await imported.text());
      }
      for (const entry of cases) for (const format of ["sequence", "sheet", "cocos"]) {
        const response = await post("/api/workbench/export", {
          projectId: entry.projectId, format, files, manifest: { ...sample.pkg, projectId: entry.exportedId },
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200, `${serverName}/${format}/${entry.exportedId}: ${response.ok ? "" : buffer.toString("utf8")}`);
        assert.equal(response.headers.get("content-type"), "application/zip");
        const disposition = response.headers.get("content-disposition");
        assert.match(disposition, /^attachment;/);
        assert.match(disposition, /^[\x20-\x7e]+$/, "HTTP headers must contain only printable ASCII");
        assert.doesNotThrow(() => http.validateHeaderValue("content-disposition", disposition));
        const fallback = /\bfilename="([^"]+)"/.exec(disposition)?.[1];
        assert.match(fallback, /^[a-zA-Z0-9_.-]+\.zip$/);
        const encoded = /\bfilename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
        assert.ok(encoded, "Unicode download names use the standard UTF-8 filename parameter");
        assert.equal(decodeURIComponent(encoded), `${entry.filename}_${format}.zip`);
        if (entry.projectId === projectIds[0]) assert.equal(fallback, `${entry.filename}_${format}.zip`);
        const archive = unzip(buffer);
        const prefix = format === "cocos" ? "frame-tuner-source/" : "";
        const manifest = JSON.parse(archive.get(`${prefix}manifest.json`));
        assert.equal(manifest.projectId, entry.exportedId);
        assert.deepEqual(manifest.animations, sample.pkg.animations);
        const runtimePrefix = format === "cocos" ? `assets/resources/${path.posix.dirname(JSON.parse(archive.get("FRAME-TUNER-IMPORT.json")).resourcePath)}/` : "";
        const image = archive.get(`${runtimePrefix}frames/demo_0.png`);
        const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const original = await sharp(sample.files.get("frames/demo_0.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual(decoded, original, "default runtime PNG compression preserves every pixel");
        assert.ok(image.length <= sample.files.get("frames/demo_0.png").length);
        if (format === "cocos") assert.deepEqual(archive.get(`${prefix}frames/demo_0.png`), sample.files.get("frames/demo_0.png"), "Cocos reference images remain untouched");
        const compression = JSON.parse(response.headers.get("x-frame-tuner-png-compression"));
        assert.equal(compression.quality, 100);
        assert.equal(compression.files, 4);
        assert.ok(compression.outputBytes <= compression.inputBytes);
        assert.deepEqual(archive.get(`${prefix}audio/tick.wav`), sample.files.get("audio/tick.wav"));
        const source = JSON.parse(archive.get(`${prefix}source/project.json`));
        assert.equal(source.project.id, entry.projectId);
        const sourceFrame = source.manifest.profiles[0].animations[0].frames[0].path;
        assert.deepEqual(archive.get(`${prefix}${sourceFrame}`), sample.files.get("frames/demo_0.png"));
      }
    }
    console.log("HTTP downloads passed: main/Lite, ASCII/Chinese/non-BMP names, safe headers, all three formats, ZIP CRC/content and editable source.");
  } finally {
    if (lite?.listening) { lite.closeAllConnections(); await new Promise(resolve => lite.close(resolve)); }
    if (main?.child && main.child.exitCode === null) await new Promise(resolve => { main.child.once("exit", resolve); main.child.kill(); });
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("frame-tuner-http-download-")) throw new Error("Unsafe test cleanup path.");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

if (require.main === module) test().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { test };
