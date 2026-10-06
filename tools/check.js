const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function scripts(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : scripts(target);
    return entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name) ? [target] : [];
  });
}
const files = [...scripts(path.join(root, 'tools')), ...scripts(path.join(root, 'tests'))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.error?.message || `Syntax check failed: ${file}\n`);
    process.exit(1);
  }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
