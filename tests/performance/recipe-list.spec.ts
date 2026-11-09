import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { contentExample } from '../../src/services/ai/cooking';

for (const size of [250, 1000]) {
  test(`正式构建：${size}条制作与${size * 3}份版本，AI首屏不读正文且搜索覆盖末尾`, async ({
    page,
    context,
  }, testInfo) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      Object.assign(window, { listReads: {} });
      for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
        for (const method of ['getAll', 'get', 'openCursor'] as const) {
          const original = prototype[method];
          Object.defineProperty(prototype, method, {
            configurable: true,
            value: function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
              const request = Reflect.apply(original, this, args) as IDBRequest;
              const name = 'objectStore' in this ? this.objectStore.name : this.name;
              request.addEventListener('success', () => {
                const result = request.result;
                const rows = (Array.isArray(result) ? result : [result?.value ?? result]).filter(
                  (row) => row && typeof row === 'object',
                );
                const reads = (window as typeof window & { listReads: Record<string, number> })
                  .listReads;
                reads[name] = (reads[name] ?? 0) + rows.length;
              });
              return request;
            },
          });
        }
      }
    });
    await page.route('**/chat/completions', (route) => {
      throw new Error(`性能回归禁止调用模型：${route.request().url()}`);
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
    // Seed a fully prepared v3 database. Upgrade/backfill is measured separately in unit tests.
    await page.evaluate(
      async ({ content, size }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('cookpilot-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = database.transaction(
          ['recipes', 'versions', 'versionSummaries', 'sessions'],
          'readwrite',
        );
        const now = Date.now();
        for (let i = 0; i < size; i++) {
          const title = i ? `${content.title}${i}` : '冷门藏菜';
          const aliases = i ? [] : ['Hidden Secret'];
          tx.objectStore('recipes').put({
            id: `r${i}`,
            identity: `dish${i}`,
            name: title,
            aliases: [],
            source: 'ai',
            createdAt: now,
          });
          for (let number = 1; number <= 3; number++) {
            const id = `v${i}-${number}`;
            tx.objectStore('versions').put({
              id,
              recipeId: `r${i}`,
              number,
              parentId: number > 1 ? `v${i}-${number - 1}` : null,
              content: { ...content, title, aliases },
              change: '历史调整',
              createdAt: now,
            });
            tx.objectStore('versionSummaries').put({
              id,
              recipeId: `r${i}`,
              number,
              title,
              minutes: content.minutes,
              conditions: content.conditions,
              searchText: `${title} ${aliases.join(' ')}`.toLowerCase(),
            });
          }
          tx.objectStore('sessions').put({
            id: `s${i}`,
            recipeId: `r${i}`,
            versionId: `v${i}-3`,
            source: 'ai',
            checked: [],
            currentCard: 0,
            execution: [],
            progressKnown: false,
            revision: 0,
            note: `心得${i}`,
            createdAt: now + i,
          });
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();
      },
      { content: contentExample, size },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
    await page.evaluate(() => {
      Object.assign(window, { listReads: {} });
      location.hash = '#ai-recipes';
    });
    const start = performance.now();
    await expect(page.getByText(`${size} 条制作记录`)).toBeVisible();
    await expect(page.locator('.saved-recipe')).toHaveCount(24);
    const firstPageMs = performance.now() - start;
    const reads = await page.evaluate(
      () => (window as typeof window & { listReads: Record<string, number> }).listReads,
    );
    expect(reads.versions ?? 0).toBe(0);
    expect(reads.sessions).toBe(25);
    expect(reads.versionSummaries).toBe(24);
    await page.screenshot({ path: testInfo.outputPath(`ai-list-${size}.png`) });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('.saved-recipe')).toHaveCount(48);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('textbox', { name: '搜索菜名' }).fill('hidden secret');
    await expect(page.locator('.saved-recipe')).toHaveCount(1);
    await expect(page.locator('.saved-recipe h2')).toHaveText('冷门藏菜');
    await page.getByRole('button', { name: '清空搜索' }).click();
    await expect(page.locator('.saved-recipe')).toHaveCount(24);
    expect(
      (
        await page.evaluate(
          () => (window as typeof window & { listReads: Record<string, number> }).listReads,
        )
      ).versions ?? 0,
    ).toBe(0);
    // Switching to the static catalog must not subscribe to saved records or versions.
    await page.evaluate(() => {
      Object.assign(window, { listReads: {} });
      location.hash = '#recipes';
    });
    await expect(page.getByText('200 道家常菜')).toBeVisible();
    const catalogReads = await page.evaluate(
      () => (window as typeof window & { listReads: Record<string, number> }).listReads,
    );
    expect(catalogReads.sessions ?? 0).toBe(0);
    expect(catalogReads.versions ?? 0).toBe(0);
    expect(catalogReads.versionSummaries ?? 0).toBe(0);
    const metricsPath = testInfo.outputPath(`ai-list-${size}.json`);
    await writeFile(
      metricsPath,
      JSON.stringify(
        { sessions: size, versions: size * 3, cpuRate: 4, firstPageMs, reads, catalogReads },
        null,
        2,
      ),
    );
    await testInfo.attach('list-metrics', { path: metricsPath, contentType: 'application/json' });
  });
}
