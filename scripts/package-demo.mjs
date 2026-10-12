import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = resolve(root, 'dist/assets');
const files = await readdir(assets);
const scriptFile = files.find((name) => /^index-.*\.js$/.test(name));
const styleFile = files.find((name) => /^index-.*\.css$/.test(name));
if (!scriptFile || !styleFile) throw new Error('Run the Vite build before packaging the demo.');

let script = await readFile(resolve(assets, scriptFile), 'utf8');
let styles = await readFile(resolve(assets, styleFile), 'utf8');
for (const file of ['kung-pao.jpg', 'tomato-eggs.jpg', 'beef-potato.jpg']) {
  const data = await readFile(resolve(root, 'public/images', file));
  script = script.replaceAll(
    `/images/${file}`,
    `data:image/jpeg;base64,${data.toString('base64')}`,
  );
}
const font = await readFile(resolve(root, 'public/fonts/dm-sans-latin.woff2'));
styles = styles.replaceAll(
  '/fonts/dm-sans-latin.woff2',
  `data:font/woff2;base64,${font.toString('base64')}`,
);
const icon = await readFile(resolve(root, 'public/favicon.svg'));
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <meta name="description" content="CookPilot 烹饪助手 · 完整交互演示">
  <link rel="icon" href="data:image/svg+xml;base64,${icon.toString('base64')}">
  <title>CookPilot</title>
  <style>${styles}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">${script.replaceAll('</script', '<\\/script')}</script>
</body>
</html>`;
await writeFile(resolve(root, 'demo.html'), html, 'utf8');
console.log(`Standalone demo: demo.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
