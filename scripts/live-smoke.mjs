import { chromium } from '@playwright/test';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';

// Explicit opt-in command. At most one connection, recommendation, generation
// (plus its one schema repair), question and adjustment. Never part of npm test.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const usage = [];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', async (response) => {
  if (
    response.url().startsWith('https://api.deepseek.com/') &&
    response.request().method() === 'POST'
  ) {
    const body = await response.json().catch(() => ({}));
    usage.push({ status: response.status(), model: body.model, usage: body.usage });
  }
});
const summary = { origin: 'http://localhost:5173', browser: 'Chrome', checks: [], usage, errors };
try {
  await page.goto('http://localhost:5173/');
  await page
    .getByRole('button', { name: 'DeepSeek Flash', exact: true })
    .waitFor({ timeout: 20000 });
  const connection = await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    const { testConnection } = await import('/src/services/ai/client.ts');
    const models = await db.models.toArray();
    const config = models[0];
    const credential = await db.credentials.get(config.id);
    return testConnection({ ...config, key: credential?.key ?? '' });
  });
  summary.checks.push({ check: 'real browser direct connection', result: connection });
  await page
    .getByRole('textbox', { name: '描述做菜需求' })
    .fill('想做西红柿炒鸡蛋，番茄400g、鸡蛋3个，清淡，不放辣椒。');
  await page.getByRole('button', { name: '发送消息' }).click();
  const candidate = page
    .locator('.recommendation')
    .filter({ has: page.getByRole('heading', { name: /西红柿炒鸡蛋|番茄炒蛋|番茄炒鸡蛋/ }) })
    .first();
  await candidate
    .getByRole('button', { name: '生成菜谱', exact: true })
    .waitFor({ timeout: 90000 });
  summary.checks.push({
    check: 'real recommendation',
    result: await candidate.locator('h2').innerText(),
  });
  await candidate.getByRole('button', { name: '生成菜谱', exact: true }).click();
  await page.getByRole('heading', { name: '准备好，再开火' }).waitFor({ timeout: 180000 });
  const saved = await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    const versions = await db.versions.toArray();
    const sessions = await db.sessions.toArray();
    return {
      version: versions[0],
      sessionId: sessions[0].id,
      counts: {
        recipes: await db.recipes.count(),
        versions: versions.length,
        sessions: sessions.length,
      },
    };
  });
  summary.checks.push({
    check: 'real generation, strict validation and atomic save',
    result: saved.counts,
  });
  await mkdir('.local/screenshots', { recursive: true });
  await writeFile('.local/live-content.json', JSON.stringify(saved.version.content, null, 2));
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).waitFor();
  summary.checks.push({
    check: 'refresh preserves card',
    result: await page
      .getByRole('button', { name: '跳转第 1 步', exact: true })
      .getAttribute('aria-current'),
  });
  await page.getByRole('button', { name: '问问 AI', exact: true }).click();
  await page
    .getByRole('textbox', { name: '烹饪问题' })
    .fill('我还没有开始做。鸡蛋怎么判断已经炒熟？');
  await page.getByRole('button', { name: '发送烹饪问题' }).click();
  await page.waitForFunction(
    async () => {
      const { db } = await import('/src/storage/db.ts');
      return (await db.cookingMessages.toArray()).some((m) => m.role === 'assistant');
    },
    null,
    { timeout: 90000 },
  );
  summary.checks.push({
    check: 'real cooking question',
    result: 'saved in session-specific conversation',
  });
  await page.getByRole('button', { name: '确认实际执行进度' }).click();
  await page.getByRole('button', { name: '确认这些进度' }).click();
  await page
    .getByRole('textbox', { name: '烹饪问题' })
    .fill(
      '确认还没开始做，所有材料都还没使用。请把盐的总量减半，保持其他食材、用量和步骤不变，提出调整让我确认。',
    );
  await page.getByRole('button', { name: '发送烹饪问题' }).click();
  await page.getByRole('button', { name: '确认更新本次做法' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '确认更新本次做法' }).click();
  await page.getByText('已应用', { exact: true }).waitFor();
  summary.checks.push({ check: 'real adjustment confirmed, new version', result: 'applied' });
  const final = await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    const { exportData } = await import('/src/storage/repository.ts');
    const output = await exportData();
    const credentials = await db.credentials.toArray();
    return {
      versions: await db.versions.count(),
      secretExcluded: credentials.every((c) => !c.key || !output.includes(c.key)),
    };
  });
  if (final.versions !== 2 || !final.secretExcluded || errors.length)
    throw new Error('Final invariant check failed');
  summary.checks.push({ check: 'version history and export excludes Key', result: final });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '跳转准备卡片' }).click();
  await page.getByRole('button', { name: '跳转准备卡片' }).getAttribute('aria-current');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="跳转准备卡片"]')?.getAttribute('aria-current') ===
      'step',
  );
  await page.screenshot({ path: '.local/screenshots/live-guide.png', fullPage: true });
  await mkdir('.local', { recursive: true });
  summary.success = true;
} catch (error) {
  summary.success = false;
  summary.error = error.message;
  await mkdir('.local/screenshots', { recursive: true });
  await page
    .screenshot({ path: '.local/screenshots/live-failure.png', fullPage: true })
    .catch(() => undefined);
  process.exitCode = 1;
} finally {
  await writeFile('.local/live-summary.json', JSON.stringify(summary, null, 2));
  await appendFile(
    '.local/live-runs.jsonl',
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...summary })}\n`,
  );
  await context.storageState({ path: '.local/live-state.json', indexedDB: true });
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
}
