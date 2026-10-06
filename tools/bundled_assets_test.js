"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-tuner-bundled-assets-"));
process.env.FRAME_TUNER_ROOT = root;
delete process.env.FRAME_TUNER_CODEX_PETS;
const { server, workbench } = require("./animation_tuner/server");
const { createLiteApp } = require("./frame_tuner_lite/server");
const lite = createLiteApp({ root });
const servers = [server, lite.server];

async function run() {
  const projectId = workbench.createProject({ label: "Bundled texture probe" }).projectId;
  const liteProject = lite.store.ensureProject("legacy-texture-probe");
  for (let index = 0; index < servers.length; index += 1) {
    const target = servers[index];
    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${target.address().port}`;
    const config = await (await fetch(`${base}/api/config?project=${index ? liteProject.id : projectId}`)).json();
    const preset = config.attackTrails.presetTexture;
    assert.equal(preset.path, "tools/animation_tuner/public/presets/attack_trails/coherent_trail_body_luma.png");
    assert.equal(fs.existsSync(path.join(root, preset.path)), false, "Isolated user data contains no copied checkout textures");
    const response = await fetch(`${base}/asset?path=${encodeURIComponent(preset.path)}`);
    assert.equal(response.status, 200, `${index ? "Lite" : "Main"} must resolve the actual bundled preset URL under an isolated data root`);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(__dirname, "..", preset.path)));
    const customPath = "workspace/custom.png";
    const custom = Buffer.from("user-owned-asset");
    fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
    fs.writeFileSync(path.join(root, customPath), custom);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/asset?path=${encodeURIComponent(customPath)}`)).arrayBuffer()), custom, "User assets still resolve under the selected data root");
    for (const denied of ["README.md", "tools/animation_tuner/assets/xsxb-frame-tuner.png", "tools/animation_tuner/public/presets/attack_trails/../../../../assets/xsxb-frame-tuner.png", "tools/animation_tuner/public/presets/attack_trails/missing.png"]) {
      assert.equal((await fetch(`${base}/asset?path=${encodeURIComponent(denied)}`)).status, 404, denied);
    }
  }
  console.log("Bundled asset HTTP checks passed for Main and Lite: preset PNG, isolated user assets and restricted fallback.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const target of servers) if (target.listening) await new Promise((resolve) => target.close(resolve));
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
});
