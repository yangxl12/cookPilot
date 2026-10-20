import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    performanceAudit: { reads: Record<string, number>; renders: Record<string, number> };
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/__local-model', (route) => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    window.performanceAudit = { reads: {}, renders: {} };
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      for (const name of ['getAll', 'get', 'openCursor', 'getAllKeys'] as const) {
        const original = prototype[name];
        Object.defineProperty(prototype, name, {
          configurable: true,
          value: function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
            const table = 'objectStore' in this ? this.objectStore.name : this.name;
            const reads = window.performanceAudit.reads;
            reads[table] = (reads[table] ?? 0) + 1;
            return Reflect.apply(original, this, args);
          },
        });
      }
    }
    // Observe committed work through the same hook used by React DevTools.
    let previousFibers = new WeakSet<object>();
    const hook = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer: unknown) {
        this.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberUnmount() {},
      onCommitFiberRoot(_id: number, root: { current: unknown }) {
        const currentFibers = new WeakSet<object>();
        type Fiber = { type?: { name?: string }; flags: number; child?: Fiber; sibling?: Fiber };
        const visit = (fiber?: Fiber) => {
          if (!fiber) return;
          currentFibers.add(fiber);
          const name = fiber.type?.name;
          // React may retain a bailed-out subtree's flags from an earlier commit.
          if (name && fiber.flags & 1 && !previousFibers.has(fiber)) {
            const renders = window.performanceAudit.renders;
            renders[name] = (renders[name] ?? 0) + 1;
          }
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current as Fiber);
        previousFibers = currentFibers;
      },
    };
    Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook });
  });
});

async function resetAudit(page: Page) {
  // Let the preceding live query and commit settle before measuring the next action.
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.performanceAudit = { reads: {}, renders: {} };
  });
}

async function openCooking(page: Page) {
  await page.goto('/#recipes');
  await page.getByRole('textbox', { name: '搜索菜名' }).fill('西红柿炒鸡蛋');
  await page.getByRole('button', { name: /西红柿炒鸡蛋 中式/ }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
}

test('首页和AI记录按需加载；空闲与租约写入不刷新页面或重读业务数据', async ({ page }) => {
  const catalogRequests: string[] = [];
  page.on('request', (request) => {
    if (/assets\/recipes\/(index|catalog)/.test(request.url())) catalogRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  await resetAudit(page);
  await page.waitForTimeout(2200);
  await page.evaluate(async () => {
    const path = '/src/storage/db.ts';
    const { db } = await import(path);
    await db.settings.put({ id: 'lease:performance-test', value: Date.now() });
  });
  await page.waitForTimeout(150);
  const audit = await page.evaluate(() => window.performanceAudit);
  expect(audit.reads).toEqual({});
  expect(audit.renders.App ?? 0).toBe(0);
  expect(audit.renders.Home ?? 0).toBe(0);
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: 'AI 菜谱', exact: true }).click();
  await expect(page.getByText('还没有 AI 菜谱')).toBeVisible();
  expect(catalogRequests).toEqual([]);
});

test('滑动停稳才保存步骤；翻卡不重读指南、历史或问答', async ({ page }) => {
  await openCooking(page);
  await resetAudit(page);
  await page.locator('.step-carousel').evaluate((track) => {
    const card = track.firstElementChild as HTMLElement;
    track.scrollTo({ left: card.offsetWidth + 12, behavior: 'smooth' });
  });
  await expect(page.getByRole('button', { name: '跳转第 1 步', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  const firstReads = await page.evaluate(() => window.performanceAudit.reads);
  expect(firstReads.versions ?? 0).toBe(0);
  expect(firstReads.conversations ?? 0).toBe(0);
  expect(firstReads.cookingMessages ?? 0).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '跳转第 1 步', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(() =>
      page.locator('.step-carousel').evaluate((track) => {
        const card = track.firstElementChild as HTMLElement;
        return Math.abs(track.scrollLeft - (card.offsetWidth + 12));
      }),
    )
    .toBeLessThan(2);
});

test('长列表随滚动补齐全部200道菜谱，搜索覆盖未渲染的记录', async ({ page }) => {
  await page.goto('/#recipes');
  await expect(page.getByText('200 道家常菜')).toBeVisible();
  await expect(page.locator('.catalog-row')).toHaveCount(24);
  let count = await page.locator('.catalog-row').count();
  while (count < 200) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.locator('.catalog-row').count()).toBeGreaterThan(count);
    count = await page.locator('.catalog-row').count();
  }
  expect(count).toBe(200);
  const lastTitle = await page.locator('.catalog-row').last().locator('strong').textContent();
  await page.reload();
  await expect(page.locator('.catalog-row')).toHaveCount(24);
  await page.getByRole('textbox', { name: '搜索菜名' }).fill(lastTitle!);
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await expect(page.locator('.catalog-row strong')).toHaveText(lastTitle!);
  await page.goto('/#search?q=1');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.locator('.search-result').count()).toBeGreaterThanOrEqual(48);
});

test('倒计时只刷新计时显示，隐藏时停止刷新，恢复时按截止时间完成且只通知一次', async ({ page }) => {
  await openCooking(page);
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await page.getByRole('textbox', { name: '计时名称' }).fill('性能计时');
  await page.getByRole('button', { name: '添加并开始' }).click();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '菜谱大全' })).toBeVisible();
  const floating = page.getByRole('button', { name: '打开所有计时器' });
  const before = await floating.textContent();
  await resetAudit(page);
  await expect.poll(() => floating.textContent()).not.toBe(before);
  const running = await page.evaluate(() => window.performanceAudit);
  expect(running.renders.RecipePages ?? 0).toBe(0);
  expect(running.renders.App ?? 0).toBe(0);
  expect(running.reads).toEqual({});
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await resetAudit(page);
  await page.waitForTimeout(1200);
  // A toast may finish dismissing, but it is isolated: no page component may re-render.
  const { ToastHost = 0, ...pageRenders } = await page.evaluate(
    () => window.performanceAudit.renders,
  );
  expect(ToastHost).toBeLessThanOrEqual(1);
  expect(pageRenders).toEqual({});
  await page.evaluate(async () => {
    const path = '/src/storage/db.ts';
    const { db } = await import(path);
    await db.timers.toCollection().modify({ deadline: Date.now() - 1000 });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status')).toHaveText('性能计时 时间到，请观察食材状态');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/storage/db.ts';
        const { db } = await import(path);
        return (await db.timers.toArray())[0]?.status;
      }),
    )
    .toBe('done');
  await resetAudit(page);
  await page.waitForTimeout(1200);
  expect((await page.evaluate(() => window.performanceAudit)).renders.TimerClock ?? 0).toBe(0);
});

test('反复开关弹层和烹饪页面后，监听器及DOM节点不持续增长', async ({ page, context }) => {
  await openCooking(page);
  const sessionHash = await page.evaluate(() => location.hash);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const cycle = async () => {
    await page.getByRole('button', { name: '心得', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '计时器', exact: true }).click();
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.evaluate(() => {
      location.hash = '#home';
    });
    await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
    await page.evaluate((hash) => {
      location.hash = hash;
    }, sessionHash);
    await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  };
  const sample = async () => {
    await page.waitForTimeout(100);
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
  };
  for (let i = 0; i < 3; i++) await cycle();
  const baseline = await sample();
  for (let i = 0; i < 12; i++) await cycle();
  const final = await sample();
  expect(final.JSEventListeners).toBeLessThanOrEqual(baseline.JSEventListeners + 5);
  expect(final.Nodes).toBeLessThanOrEqual(baseline.Nodes + 10);
  // Allow normal engine/cache variation, but catch retained sheets, cards and subscriptions.
  expect(final.JSHeapUsedSize - baseline.JSHeapUsedSize).toBeLessThan(2 * 1024 * 1024);
});
