import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const config = JSON.parse(
  (await readFile('.local/model.json', 'utf8').catch(() => '{}')).replace(/^\uFEFF/, ''),
);
if (!config.key) {
  console.log('No local credential fixture; skipped credential-specific scan.');
  process.exit(0);
}
const candidates = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await collect(path);
    else candidates.push(path);
  }
}
await collect('dist');
const hits = [];
for (const path of candidates) {
  const content = await readFile(path).catch(() => null);
  if (content?.includes(Buffer.from(config.key))) hits.push(path);
}
if (hits.length) throw new Error(`Credential detected in publishable files: ${hits.join(', ')}`);
console.log(
  `Credential scan passed for ${candidates.length} repository/build files. No Key printed.`,
);
