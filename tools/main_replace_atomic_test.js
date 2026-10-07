"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectStore } = require("./project_store");
const { createSamplePackage } = require("./cocos/sample_package");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "main-replace-atomic-"));
process.env.FRAME_TUNER_ROOT = root;
process.env.FRAME_TUNER_CODEX_PETS = "0";
const { server, replaceAnimationImages } = require("./animation_tuner/server");
async function test() {
  try {
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "bound", label: "Bound fixture", kind: "godot" });
    const project = registry.projects.find((entry) => entry.id === "bound");
    const sample = createSamplePackage();
    const oldBytes = sample.files.get("frames/demo_0.png"), newBytes = sample.files.get("frames/demo_1.png");
    const files = [0, 1].map((index) => ({ path: `workspace/projects/bound/assets/${index}.png` }));
    files.forEach((frame) => fs.writeFileSync(path.join(root, frame.path), oldBytes));
    const newImage = { data: `data:image/png;base64,${newBytes.toString("base64")}` };
    const oldImage = { data: `data:image/png;base64,${oldBytes.toString("base64")}` };
    const unchanged = () => files.forEach((frame) => assert.deepEqual(fs.readFileSync(path.join(root, frame.path)), oldBytes));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const post = async (frames, uploads) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/replace-animation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, frames, files: uploads }) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await post(files, [newImage, { data: "invalid PNG" }])).status, 400);
    unchanged();
    const shared = await post([files[0], files[0]], [newImage, oldImage]);
    assert.equal(shared.status, 400); assert.equal(shared.body.code, "shared_frame_path");
    unchanged();
    const rename = fs.renameSync; let injected = false;
    fs.renameSync = function (source, destination) {
      if (!injected && destination === path.join(root, files[1].path)) { injected = true; throw new Error("Injected main replacement failure"); }
      return rename.call(this, source, destination);
    };
    try { assert.throws(() => replaceAnimationImages(files, [newImage, newImage], project), /Injected main replacement failure/); }
    finally { fs.renameSync = rename; }
    assert.equal(injected, true); unchanged();
    assert.deepEqual(fs.readdirSync(path.dirname(path.join(root, files[0].path))).sort(), ["0.png", "1.png"], "Rollback removes temporary files");
    const done = await post(files, [newImage, newImage]);
    assert.equal(done.status, 200); assert.equal(done.body.frames.length, 2);
    files.forEach((frame) => assert.deepEqual(fs.readFileSync(path.join(root, frame.path)), newBytes));
    assert.equal((await post([files[0], files[0]], [oldImage, oldImage])).status, 200, "Identical replacements of a shared image are safe");
    console.log("Main bound-project replacement checks passed: preflight, shared paths, commit rollback and HTTP success.");
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test().catch((error) => { console.error(error); process.exitCode = 1; });
