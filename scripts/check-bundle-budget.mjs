import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
assert(entry, 'Missing application entry');
const closure = new Set();
function visit(key) {
  if (closure.has(key)) return;
  closure.add(key);
  for (const imported of manifest[key].imports ?? []) visit(imported);
}
visit(entry);
let raw = 0,
  gzip = 0;
for (const key of closure) {
  assert(
    !/Settings|PreferenceSheets|Navigation|migration|features\/cooking\/Cooking/.test(key),
    `Eager page dependency: ${key}`,
  );
  const bytes = await readFile(`dist/${manifest[key].file}`);
  raw += bytes.length;
  gzip += gzipSync(bytes).length;
}
assert(gzip <= 160000, `Home JS gzip ${gzip} exceeds 160000 bytes`);
const build = JSON.parse(await readFile('dist/version.json', 'utf8'));
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/bundle.json',
  JSON.stringify(
    {
      build,
      raw,
      gzip,
      limit: 160000,
      dependencies: [...closure].map((key) => manifest[key].file),
      node: process.version,
    },
    null,
    2,
  ),
);
console.log(`Home JS: ${raw} bytes raw / ${gzip} bytes gzip (limit 160000)`);
