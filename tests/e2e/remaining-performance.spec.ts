import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/__local-model', (route) => route.fulfill({ status: 404 }));
  await page.route('**/chat/completions', () => {
    throw new Error('禁止真实模型请求');
  });
});

test('搜索Worker跨上下文接收心得更新，只重读受影响小块，删除后无缓存结果', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '想做什么菜？' }).waitFor();
  await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    const { addVersion } = await import('/src/storage/recipeList.ts');
    const { contentExample } = await import('/src/services/ai/cooking.ts');
    const { newSession } = await import('/src/storage/repository.ts');
    await db.recipes.put({
      id: 'r',
      identity: '西红柿炒鸡蛋',
      name: contentExample.title,
      aliases: [],
      source: 'ai',
      createdAt: 1,
    });
    await addVersion({
      id: 'v',
      recipeId: 'r',
      number: 1,
      parentId: null,
      content: contentExample,
      change: '',
      createdAt: 1,
    });
    await db.sessions.bulkPut(
      Array.from({ length: 100 }, (_, i) => ({
        ...newSession('r', 'v'),
        id: `s${i}`,
        note: i ? '' : '独有心得词',
      })),
    );
    await db.settings.put({ id: 'recipeListReady-v3', value: true });
    location.hash = '#search?q=独有心得词';
  });
  await expect(page.locator('.search-result')).toHaveCount(1);
  const reads = await page.evaluate(
    () =>
      (performance.getEntriesByName('cookpilot:search').at(-1) as PerformanceMeasure).detail.reads,
  );
  await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    await db.sessions.update('s0', { note: '替换后的关键词' });
  });
  await expect(page.getByText('没有匹配结果')).toBeVisible();
  await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('替换后的关键词');
  await expect(page.locator('.search-result')).toHaveCount(1);
  const after = await page.evaluate(
    () =>
      (performance.getEntriesByName('cookpilot:search').at(-1) as PerformanceMeasure).detail.reads,
  );
  expect(after.sessions - reads.sessions).toBeLessThanOrEqual(32);
  expect(after.versionSearch).toBe(reads.versionSearch);
  expect(after.versions ?? 0).toBe(0);
  await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    await db.sessions.delete('s0');
  });
  await expect(page.getByText('没有匹配结果')).toBeVisible();
});

test('千条已完成计时不进入全局订阅，弹层每页最多读取25条且保留完成入口', async ({ page }) => {
  await page.goto('/#recipes');
  await page.getByRole('textbox', { name: '搜索菜名' }).fill('西红柿炒鸡蛋');
  await page.getByRole('button', { name: /西红柿炒鸡蛋 中式/ }).click();
  await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    const session = await db.sessions.toCollection().first();
    await db.timers.bulkPut(
      Array.from({ length: 1000 }, (_, i) => ({
        id: `done${i}`,
        sessionId: session!.id,
        targetType: 'custom',
        targetId: `target${i}`,
        name: `已完成${i}`,
        total: 10,
        remaining: 0,
        deadline: null,
        status: 'done',
        notified: true,
        createdAt: i,
      })),
    );
  });
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await expect(page.locator('.timer-row')).toHaveCount(24);
  await expect(page.locator('.timer-row').first()).toContainText('已完成999');
  await page.getByRole('button', { name: '更早计时' }).click();
  await expect(page.locator('.timer-row').first()).toContainText('已完成975');
  await expect(page.locator('.timer-row')).toHaveCount(24);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  // The global active-timer query returns no completed business objects.
  expect(
    await page.evaluate(async () => {
      const { db } = await import('/src/storage/db.ts');
      return db.timers.where('status').anyOf('running', 'paused').count();
    }),
  ).toBe(0);
});
