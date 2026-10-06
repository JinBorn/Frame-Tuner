"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const args = process.argv.slice(2);
const engine = args.includes("--engine") ? args[args.indexOf("--engine") + 1]
  : process.env.COCOS_ENGINE_DIR || "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine";
const declaration = path.resolve(engine, "bin/.declarations/cc.d.ts");
if (!fs.existsSync(declaration)) {
  console.error("Cocos API declarations are missing. Supply --engine <Creator 3.8.8 resources/resources/3d/engine>.");
  process.exitCode = 1;
} else {
  const files = fs.readdirSync(__dirname).filter(file => file.endsWith(".ts")).map(file => path.join(__dirname, file));
  const program = ts.createProgram([...files, declaration], {
    target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10,
    experimentalDecorators: true, strict: true, noEmit: true, skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => process.cwd(), getCanonicalFileName: file => file, getNewLine: () => "\n",
    }));
    process.exitCode = 1;
  } else console.log(`Cocos runtime TypeScript passed against ${declaration}`);
}
