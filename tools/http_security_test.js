"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { readRequestBody } = require("./http_security");

function request(server, route, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: route, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));

async function checkApp(server, appRoot, outside) {
  await listen(server);
  try {
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, "local.png"), "local asset");
    fs.symlinkSync(outside, path.join(appRoot, "linked"), "junction");
    assert.equal((await request(server, "/asset?path=local.png")).text, "local asset");
    assert.equal((await request(server, "/asset?path=linked/secret.png")).status, 404);
    assert.equal((await request(server, "/asset?path=../outside/secret.png")).status, 404);
    const host = `127.0.0.1:${server.address().port}`;
    assert.equal((await request(server, "/api/projects")).status, 200);
    assert.equal((await request(server, "/api/projects", { headers: { origin: `http://${host}` } })).status, 200);
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "http://127.0.0.1:1" },
      { host: `rebound.example:${server.address().port}` },
      { host: "127.0.0.1:1" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      assert.equal((await request(server, "/api/config", { headers })).status, 403);
      assert.equal((await request(server, "/api/workbench/projects", {
        method: "POST", headers: { "content-type": "text/plain", ...headers },
        body: JSON.stringify({ id: "hostile", label: "Should never be created" }),
      })).status, 403);
    }
    const projects = JSON.parse((await request(server, "/api/projects")).text).projects;
    assert.equal(projects.some((project) => project.id === "hostile"), false);
    const create = await request(server, "/api/workbench/projects", {
      method: "POST", headers: { "content-type": "application/json", origin: `http://${host}` },
      body: JSON.stringify({ id: "valid", label: "Same origin" }),
    });
    assert.equal(create.status, 201, create.text);
    const created = JSON.parse(create.text);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const post = (route, payload) => request(server, route, {
      method: "POST", headers: { "content-type": "application/json", origin: `http://${host}` }, body: JSON.stringify(payload),
    });
    const imported = await post("/api/workbench/import", { projectId: created.projectId, profileId: "hero", animationId: "idle", files: [{ name: "frame.png", data: png }] });
    assert.equal(imported.status, 200, imported.text);
    const config = JSON.parse((await request(server, `/api/config?project=${created.projectId}`)).text);
    const frame = config.groups.find((group) => group.profileId === "hero").frames[0];
    const source = fs.readFileSync(path.resolve(appRoot, frame.path));
    const replaced = await post("/api/replace-frame", { projectId: created.projectId, path: frame.path, data: png });
    assert.equal(replaced.status, 200, replaced.text);
    const invalid = await post("/api/replace-frame", { projectId: created.projectId, path: frame.path, data: "data:image/png;base64,aW52YWxpZA==" });
    assert.equal(invalid.status, 400, invalid.text);
    assert.deepEqual(fs.readFileSync(path.resolve(appRoot, frame.path)), source);
    const workspace = created.project.workspacePath;
    fs.symlinkSync(outside, path.join(workspace, "linked"), "junction");
    const escaped = await post("/api/replace-frame", { projectId: created.projectId, path: path.relative(appRoot, path.join(workspace, "linked", "secret.png")), data: png });
    assert.notEqual(escaped.status, 200);
    assert.equal(fs.readFileSync(path.join(outside, "secret.png"), "utf8"), "outside asset");
    const audioDirectory = path.join(workspace, "audio");
    fs.mkdirSync(audioDirectory, { recursive: true });
    const sound = path.join(audioDirectory, "valid.wav");
    fs.writeFileSync(sound, "valid local sound");
    fs.writeFileSync(path.join(outside, "secret.wav"), "outside sound");
    const soundBinding = { key: "existing-sound", name: "valid.wav", path: path.relative(appRoot, sound) };
    const audioPayload = (frameAudioBindings) => ({ projectId: created.projectId, force: true, frameAudioBindings });
    const audioSaved = await post("/api/frame-audio", audioPayload([soundBinding]));
    assert.equal(audioSaved.status, 200, audioSaved.text);
    fs.mkdirSync(path.join(audioDirectory, "directory.wav"));
    const audioFilesBefore = fs.readdirSync(audioDirectory).sort();
    const configBeforeBadAudio = JSON.parse((await request(server, `/api/config?project=${created.projectId}`)).text);
    for (const invalidPath of [path.join(audioDirectory, "directory.wav"), path.join(workspace, "linked", "secret.wav")]) {
      const invalidAudio = await post("/api/frame-audio", audioPayload([
        { key: "pending-upload", name: "pending.wav", data: "data:audio/wav;base64,cGVuZGluZw==" },
        { key: "invalid-reference", name: "bad.wav", path: path.relative(appRoot, invalidPath) },
      ]));
      assert.equal(invalidAudio.status, 400, invalidAudio.text);
      assert.equal(JSON.parse(invalidAudio.text).code, "invalid_audio_path");
      assert.deepEqual(fs.readdirSync(audioDirectory).sort(), audioFilesBefore, "Failed audio preflight must not write even earlier valid uploads");
      const currentConfig = JSON.parse((await request(server, `/api/config?project=${created.projectId}`)).text);
      assert.equal(currentConfig.configRevision, configBeforeBadAudio.configRevision);
      assert.deepEqual(currentConfig.frameAudioBindings, configBeforeBadAudio.frameAudioBindings);
    }
    assert.equal(fs.readFileSync(path.join(outside, "secret.wav"), "utf8"), "outside sound");
    const oversized = await request(server, "/api/workbench/projects", {
      method: "POST", headers: { "content-length": 256 * 1024 * 1024 + 1 },
    });
    assert.equal(oversized.status, 413, oversized.text);
    assert.equal((await request(server, "/api/projects")).status, 200);
  } finally {
    server.closeAllConnections();
    await close(server);
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-http-security-"));
  const mainRoot = path.join(root, "main"), liteRoot = path.join(root, "lite"), outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.png"), "outside asset");
  process.env.FRAME_TUNER_ROOT = mainRoot;
  try {
    await checkApp(require("./animation_tuner/server").server, mainRoot, outside);
    await checkApp(require("./frame_tuner_lite/server").createLiteApp({ root: liteRoot }).server, liteRoot, outside);
    // Exercise the streaming limit without allocating a 256 MiB test upload.
    const server = http.createServer(async (req, res) => {
      try { res.end(await readRequestBody(req, 8)); }
      catch (error) { res.writeHead(error.status); res.end(error.code); }
    });
    await listen(server);
    try {
      assert.equal((await request(server, "/", { method: "POST", headers: { "transfer-encoding": "chunked" }, body: "123456789" })).status, 413);
      assert.equal((await request(server, "/", { method: "POST", body: "12345678" })).text, "12345678");
    } finally { await close(server); }
    console.log("HTTP security: same-origin, rebinding, cross-site writes and upload limits passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
