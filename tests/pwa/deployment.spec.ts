import { test, expect } from '@playwright/test';

test('正式部署入口、静态资源和 PWA 使用相同的部署目录', async ({ page, baseURL }) => {
  const base = new URL(baseURL!);
  const errors: string[] = [];
  const resourcePaths: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== base.origin) return;
    resourcePaths.push(url.pathname);
    if (response.status() >= 400) errors.push(`${response.status()} ${url.pathname}`);
  });

  const response = await page.goto('./');
  expect(response?.ok()).toBe(true);
  expect(await response!.text()).not.toContain('/src/main.tsx');
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  const scope = await page.evaluate(async () => {
    await document.fonts.ready;
    return (await navigator.serviceWorker.ready).scope;
  });
  expect(scope).toBe(base.href);
  expect(resourcePaths.some((path) => path.endsWith('.js'))).toBe(true);
  expect(resourcePaths.some((path) => path.endsWith('.css'))).toBe(true);
  expect(resourcePaths.some((path) => path.endsWith('.woff2'))).toBe(true);
  expect(resourcePaths.every((path) => path.startsWith(base.pathname))).toBe(true);

  const manifestURL = await page.locator('link[rel="manifest"]').evaluate((link) => {
    return (link as HTMLLinkElement).href;
  });
  const manifestResponse = await page.request.get(manifestURL);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(new URL(manifest.start_url, manifestURL).href).toBe(base.href);
  expect(new URL(manifest.scope, manifestURL).href).toBe(base.href);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestURL);
    expect(url.pathname.startsWith(base.pathname)).toBe(true);
    const response = await page.request.get(url.href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  expect(errors).toEqual([]);
});
