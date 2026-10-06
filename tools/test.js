const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function suites(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : suites(target);
    return entry.isFile() && /(?:_test|\.test)\.js$/.test(entry.name) ? [target] : [];
  });
}
const files = suites(__dirname).sort();
for (const file of files) {
  console.log(`\nRunning ${path.relative(path.join(__dirname, '..'), file)}`);
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`\nAll ${files.length} test suites passed.`);
