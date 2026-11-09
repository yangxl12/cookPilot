import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Connect to a physical Android Chrome over USB/adb port forwarding. A desktop
// run cannot establish real-phone GPU performance, so no emulation fallback exists.
const [endpoint, base] = process.argv.slice(2);
if (!endpoint || !base)
  throw new Error('用法：node scripts/paint-audit.mjs <真机CDP地址> <真机可访问的应用地址>');
const output = `.local/paint-audit-${Date.now()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
// Never use the user's regular browser context or business database.
const context = await browser.newContext({ viewport: null });
try {
  for (const variant of ['glass', 'plain']) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await page.goto(`${base.replace(/\/$/, '')}/#recipes`);
    await page.locator('.catalog-row').first().waitFor();
    if (variant === 'plain')
      await page.addStyleTag({
        content:
          '*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
      });
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,gpu',
      transferMode: 'ReturnAsStream',
    });
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollBy(0, innerHeight * 0.7));
      await page.waitForTimeout(180);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.catalog-row').first().click();
    await page.getByRole('button', { name: '计时器', exact: true }).click();
    await page.screenshot({ path: `${output}/${variant}.png` });
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await complete;
    const chunks = [];
    for (;;) {
      const part = await cdp.send('IO.read', { handle: stream });
      chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
      if (part.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    await writeFile(`${output}/${variant}.json`, Buffer.concat(chunks));
    await page.close();
  }
  await writeFile(
    `${output}/environment.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        testedAt: new Date().toISOString(),
        note: '需同时记录手机型号、系统版本和温度；在 DevTools Performance 中比较帧时间、绘制与合成。iPhone 使用 Safari Web Inspector/Instruments 录制相同交互。',
      },
      null,
      2,
    ),
  );
  console.log(`真机 A/B 轨迹与截图：${output}`);
} finally {
  await context.close();
  // For connectOverCDP, close disconnects the transport; the device's Chrome stays open.
  await browser.close();
}
