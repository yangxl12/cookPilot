import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { contentExample } from '../../src/services/ai/cooking';
import { contentSearchText } from '../../src/domain/rules';

for (const size of [250, 1000]) {
  test(`正式构建：${size}条制作全局搜索不读完整版本和对话，历史首屏只读摘要`, async ({
    page,
    context,
  }, testInfo) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      Object.assign(window, { searchReads: {} });
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
                const reads = (window as typeof window & { searchReads: Record<string, number> })
                  .searchReads;
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
    await page.evaluate(
      async ({ size, content, body }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('cookpilot-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = database.transaction(
          [
            'recipes',
            'versions',
            'versionSummaries',
            'versionSearch',
            'sessions',
            'conversations',
            'conversationSearch',
            'conversationSummaries',
          ],
          'readwrite',
        );
        const now = Date.now();
        for (let i = 0; i < size; i++) {
          const title = i ? `${content.title}${i}` : '藏菜鸡蛋';
          tx.objectStore('recipes').put({
            id: `r${i}`,
            identity: `r${i}`,
            name: title,
            aliases: [],
            source: 'ai',
            createdAt: now,
          });
          for (let number = 1; number <= 3; number++) {
            const id = `v${i}-${number}`;
            const change = i === 0 && number === 1 ? 'HiddenOld' : '历史调整';
            tx.objectStore('versions').put({
              id,
              recipeId: `r${i}`,
              number,
              parentId: null,
              content: { ...content, title },
              change,
              createdAt: now,
            });
            tx.objectStore('versionSummaries').put({
              id,
              recipeId: `r${i}`,
              number,
              title,
              minutes: content.minutes,
              conditions: content.conditions,
              searchText: title.toLowerCase(),
              change,
            });
            const text = `${title} ${body}`;
            tx.objectStore('versionSearch').put({
              id,
              recipeId: `r${i}`,
              title,
              body: text,
              searchText: text.toLowerCase(),
            });
          }
          tx.objectStore('sessions').put({
            id: `s${i}`,
            recipeId: `r${i}`,
            versionId: `v${i}-3`,
            source: 'ai',
            note: i === 0 ? '心得深藏' : '心得',
            createdAt: now + i,
            checked: [],
            currentCard: 0,
            execution: [],
            progressKnown: false,
            revision: 0,
          });
        }
        for (let i = 0; i < size * 0.4; i++) {
          const id = `chat${String(i).padStart(4, '0')}`;
          const title = `鸡蛋对话${i}`;
          const messages = Array.from({ length: 40 }, (_, n) => ({
            id: `${id}-${n}`,
            role: n % 2 ? 'assistant' : 'user',
            text: '鸡蛋做法',
            createdAt: now,
            ...(n % 2
              ? {
                  candidates: [
                    {
                      name: '鸡蛋候选',
                      summary: i === 0 ? '候选深藏' : '候选摘要',
                      aliases: [],
                      minutes: 1,
                      difficulty: '简单',
                      blocked: '',
                    },
                  ],
                }
              : {}),
          }));
          const text = messages
            .map(
              (m) =>
                `${m.text} ${m.candidates?.map((c) => `${c.name} ${c.summary}`).join(' ') ?? ''}`,
            )
            .join(' ');
          tx.objectStore('conversations').put({
            id,
            title,
            createdAt: now,
            lastSentAt: now,
            messages,
          });
          tx.objectStore('conversationSummaries').put({
            id,
            title,
            createdAt: now,
            lastSentAt: now,
            questionCount: 20,
          });
          tx.objectStore('conversationSearch').put({
            id,
            title,
            lastSentAt: now,
            body: text,
            searchText: text.toLowerCase(),
          });
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();
      },
      { size, content: contentExample, body: contentSearchText(contentExample) },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
    await page.evaluate(() => {
      Object.assign(window, { searchReads: {} });
      location.hash = '#search';
    });
    const input = page.getByRole('searchbox', { name: '全局搜索', exact: true });
    await expect(input).toBeFocused();
    const emptyReads = await page.evaluate(
      () => (window as typeof window & { searchReads: Record<string, number> }).searchReads,
    );
    for (const table of [
      'sessions',
      'versions',
      'versionSearch',
      'versionSummaries',
      'conversations',
      'conversationSearch',
    ])
      expect(emptyReads[table] ?? 0).toBe(0);
    const firstStart = performance.now();
    await input.fill('鸡蛋');
    for (const source of ['AI 菜谱', '菜谱大全', '对话历史'])
      await expect(page.getByRole('region', { name: `${source}搜索结果` })).toBeVisible();
    const firstResultsMs = performance.now() - firstStart;
    const reads = await page.evaluate(
      () => (window as typeof window & { searchReads: Record<string, number> }).searchReads,
    );
    expect(reads.versions ?? 0).toBe(0);
    expect(reads.conversations ?? 0).toBe(0);
    expect(reads.versionSearch).toBe(size);
    expect(reads.conversationSearch).toBe(size * 0.4);
    await page.screenshot({ path: testInfo.outputPath(`search-${size}.png`) });
    await input.fill('hiddenold 心得深藏');
    await expect(
      page.getByRole('region', { name: 'AI 菜谱搜索结果' }).getByRole('button'),
    ).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'AI 菜谱搜索结果' })).toContainText('藏菜鸡蛋');
    await input.fill('候选深藏');
    await expect(
      page.getByRole('region', { name: '对话历史搜索结果' }).getByRole('button'),
    ).toHaveCount(1);
    const laterReads = await page.evaluate(
      () => (window as typeof window & { searchReads: Record<string, number> }).searchReads,
    );
    expect(laterReads).toEqual(reads);
    await page.evaluate(() => {
      location.hash = '#home';
    });
    await page.getByRole('button', { name: '打开菜单' }).click();
    await expect(page.locator('.drawer-conversation')).toHaveCount(14);
    await page.evaluate(() => {
      Object.assign(window, { searchReads: {} });
    });
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(24);
    const historyReads = await page.evaluate(
      () => (window as typeof window & { searchReads: Record<string, number> }).searchReads,
    );
    expect(historyReads.conversations ?? 0).toBe(0);
    expect(historyReads.conversationSearch ?? 0).toBe(0);
    expect(historyReads.conversationSummaries).toBe(25);
    await page.screenshot({ path: testInfo.outputPath(`history-${size}.png`) });
    const titles = new Set<string>();
    for (;;) {
      const rows = page.locator('.history-row');
      expect(await rows.count()).toBeLessThanOrEqual(24);
      for (const title of await rows.locator('strong').allTextContents()) {
        expect(titles.has(title)).toBe(false);
        titles.add(title);
      }
      const older = page.getByRole('button', { name: '更早对话', exact: true });
      if (!(await older.count())) break;
      const first = await rows.first().textContent();
      await older.click();
      await expect(rows.first()).not.toHaveText(first!);
    }
    expect(titles.size).toBe(size * 0.4);
    await page.getByRole('button', { name: '较新对话' }).click();
    await expect(page.locator('.history-row')).toHaveCount(24);
    const metricsPath = testInfo.outputPath(`search-${size}.json`);
    await writeFile(
      metricsPath,
      JSON.stringify(
        {
          size,
          versions: size * 3,
          conversations: size * 0.4,
          cpuRate: 4,
          firstResultsMs,
          emptyReads,
          reads,
          historyReads,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('search-metrics', { path: metricsPath, contentType: 'application/json' });
  });
}
