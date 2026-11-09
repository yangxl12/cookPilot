import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { contentExample } from '../../src/services/ai/cooking';

test('正式构建：数十MiB导出不在页面读取正文，界面继续刷新且文件完整脱敏', async ({
  page,
  context,
}, testInfo) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/#settings');
  await page.getByRole('heading', { name: '我的厨房' }).waitFor();
  await page.evaluate(async (content) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('cookpilot-v1');
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(['versions', 'models', 'credentials'], 'readwrite');
    for (let i = 0; i < 80; i++)
      transaction.objectStore('versions').put({
        id: `export${i}`,
        recipeId: 'r',
        number: i,
        parentId: null,
        content: { ...content, conditions: '合成数据'.repeat(30000) },
        change: '',
        createdAt: i,
      });
    transaction
      .objectStore('models')
      .put({ id: 'm', name: '测试', url: 'https://example.com', model: 'm' });
    transaction.objectStore('credentials').put({ modelId: 'm', key: 'private-export-test-key' });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, contentExample);
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Runtime.getHeapUsage');
  await page.evaluate(() => {
    Object.assign(window, { exportFrames: 0, exportVersionReads: 0, exportLongTasks: [] });
    const state = window as typeof window & {
      exportFrames: number;
      exportVersionReads: number;
      exportLongTasks: number[];
    };
    const frame = () => {
      state.exportFrames++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) =>
      state.exportLongTasks.push(...list.getEntries().map((entry) => entry.duration)),
    ).observe({ type: 'longtask' });
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      for (const method of ['get', 'getAll', 'openCursor'] as const) {
        const original = prototype[method];
        Object.defineProperty(prototype, method, {
          configurable: true,
          value: function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
            if (('objectStore' in this ? this.objectStore.name : this.name) === 'versions')
              state.exportVersionReads++;
            return Reflect.apply(original, this, args);
          },
        });
      }
    }
  });
  const started = performance.now();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据 JSON' }).click();
  const download = await downloadEvent;
  const text = await readFile((await download.path())!, 'utf8');
  expect(Buffer.byteLength(text)).toBeGreaterThan(20 * 1024 * 1024);
  expect(JSON.parse(text).versions).toHaveLength(80);
  expect(text).not.toContain('private-export-test-key');
  expect(JSON.parse(text).models[0].key).toBe('[已隐藏]');
  const metrics = await page.evaluate(() => {
    const state = window as typeof window & {
      exportFrames: number;
      exportVersionReads: number;
      exportLongTasks: number[];
    };
    return {
      frames: state.exportFrames,
      reads: state.exportVersionReads,
      longTasks: state.exportLongTasks,
    };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Runtime.getHeapUsage');
  expect(metrics.reads).toBe(0);
  expect(metrics.frames).toBeGreaterThan(2);
  // Includes all page work, excludes the worker heap and Blob backing storage.
  expect(after.usedSize - before.usedSize).toBeLessThan(16 * 1024 * 1024);
  await writeFile(
    testInfo.outputPath('export-metrics.json'),
    JSON.stringify(
      {
        ...metrics,
        bytes: Buffer.byteLength(text),
        elapsedMs: performance.now() - started,
        pageHeapBefore: before.usedSize,
        pageHeapAfter: after.usedSize,
        cpuRate: 4,
        browser: context.browser()?.version(),
      },
      null,
      2,
    ),
  );
});

test('正式构建：首页不下载设置、迁移器、AI实现或完整菜谱', async ({ page }, testInfo) => {
  const resources: string[] = [];
  page.on('request', (request) => resources.push(request.url()));
  const start = performance.now();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  const initialMs = performance.now() - start;
  expect(
    resources.filter((url) =>
      /\/(Settings|PreferenceSheets|Navigation|migration|cooking|catalog|search\.worker|export\.worker)-/.test(
        url,
      ),
    ),
  ).toEqual([]);
  const firstOpen = performance.now();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '忌口与过敏' })).toBeVisible();
  await writeFile(
    testInfo.outputPath('startup-metrics.json'),
    JSON.stringify({ initialMs, firstSheetMs: performance.now() - firstOpen, resources }, null, 2),
  );
});
