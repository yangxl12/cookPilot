import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, sep } from 'node:path';

test('当前版本来自构建产物；检查绕过缓存，离线不会误报最新', async ({ page, context }) => {
  const build = JSON.parse(await readFile('dist/version.json', 'utf8'));
  await page.goto('./#settings');
  await expect(page.locator('.app-version')).toContainText(`v${build.version} · ${build.revision}`);
  await expect(page.locator('.app-version time')).toHaveAttribute('datetime', build.builtAt);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const checks: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/version.json')) checks.push(request.url());
  });
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('.app-version [role="status"]')).toHaveText('已是最新版本');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('.app-version [role="status"]')).toHaveText('已是最新版本');
  expect(checks).toHaveLength(2);
  expect(checks[0]).not.toBe(checks[1]);
  expect(checks.every((url) => new URL(url).searchParams.has('check'))).toBe(true);
  const cachedVersion = await page.evaluate(async () => {
    return !!(await caches.match(new URL('version.json', location.href).href));
  });
  expect(cachedVersion).toBe(false);

  await context.setOffline(true);
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('.app-version [role="status"]')).toHaveText('检查失败，请联网后重试');
  await expect(page.locator('.app-version time')).toHaveAttribute('datetime', build.builtAt);
});

test('旧离线缓存发现新版后，手动更新切换到新构建且保留模型数据', async ({ page }) => {
  test.setTimeout(120000);
  const oldBuild = JSON.parse(await readFile('dist/version.json', 'utf8'));
  const nextDir = resolve('.local/pwa-update');
  const revision = oldBuild.revision === 'a123456' ? 'b123456' : 'a123456';
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', nextDir], {
    env: { ...process.env, GITHUB_SHA: revision },
    stdio: 'pipe',
  });
  const nextBuild = JSON.parse(await readFile(resolve(nextDir, 'version.json'), 'utf8'));
  let root = resolve('dist');
  const basePath = process.env.VITE_BASE_PATH || '/';
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (!pathname.startsWith(basePath)) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(root, pathname.slice(basePath.length) || 'index.html');
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}${basePath}`;
    await page.goto(`${url}#settings`);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.locator('input[aria-label="API Key"]').fill('test-key-no-real-requests');
    await page.getByRole('button', { name: '保存模型' }).click();
    await expect(page.getByRole('button', { name: '使用DeepSeek Flash' })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect(page.locator('.app-version')).toContainText(oldBuild.revision);

    root = nextDir;
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.locator('.app-version [role="status"]')).toHaveText('有新版本');
    await expect(page.locator('.app-version')).toContainText(oldBuild.revision);
    await page.getByRole('button', { name: '更新并刷新', exact: true }).click();
    await expect(page.locator('.app-version')).toContainText(nextBuild.revision, {
      timeout: 30000,
    });
    await expect(page.locator('.app-version time')).toHaveAttribute('datetime', nextBuild.builtAt);
    await expect(page.getByRole('button', { name: '使用DeepSeek Flash' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#settings');
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.locator('.app-version [role="status"]')).toHaveText('已是最新版本');
  } finally {
    await page.goto('about:blank');
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  }
});
