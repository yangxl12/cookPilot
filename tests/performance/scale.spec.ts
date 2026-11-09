import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { contentExample } from '../../src/services/ai/cooking';

test('正式构建：1000条消息与100个版本保持有限DOM，翻完历史仍可复用候选', async ({
  page,
  context,
}, testInfo) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    Object.assign(window, { versionReads: 0 });
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      for (const method of ['getAll', 'get', 'openCursor'] as const) {
        const original = prototype[method];
        Object.defineProperty(prototype, method, {
          configurable: true,
          value: function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
            const request = Reflect.apply(original, this, args) as IDBRequest;
            if (('objectStore' in this ? this.objectStore.name : this.name) === 'versions') {
              request.addEventListener('success', () => {
                const result = request.result;
                const rows = Array.isArray(result) ? result : [result?.value ?? result];
                (window as typeof window & { versionReads: number }).versionReads += rows.filter(
                  (row) => row?.content,
                ).length;
              });
            }
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
  await page.evaluate(async (content) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cookpilot-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction(
      ['recipes', 'versions', 'sessions', 'conversations', 'settings', 'cookingMessages'],
      'readwrite',
    );
    const now = Date.now();
    tx.objectStore('recipes').put({
      id: 'r',
      identity: '西红柿炒鸡蛋',
      name: content.title,
      aliases: [],
      source: 'ai',
      createdAt: now,
    });
    for (let number = 1; number <= 100; number++)
      tx.objectStore('versions').put({
        id: `v${number}`,
        recipeId: 'r',
        number,
        parentId: number > 1 ? `v${number - 1}` : null,
        content,
        change: '历史',
        createdAt: now,
      });
    tx.objectStore('sessions').put({
      id: 's',
      recipeId: 'r',
      versionId: 'v100',
      checked: [],
      currentCard: 0,
      execution: [],
      progressKnown: false,
      revision: 0,
      note: '',
      createdAt: now,
    });
    tx.objectStore('conversations').put({
      id: 'c',
      title: '性能对话',
      createdAt: now,
      lastSentAt: now,
      messages: Array.from({ length: 1000 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 ? 'assistant' : 'user',
        text: `历史消息${index}`,
        createdAt: now + index,
        ...(index % 2
          ? {
              candidates: [
                {
                  name: content.title,
                  aliases: [],
                  minutes: 15,
                  difficulty: '简单',
                  summary: '家常做法',
                  blocked: '',
                },
              ],
            }
          : {}),
      })),
    });
    for (let index = 0; index < 1000; index++)
      tx.objectStore('cookingMessages').put({
        id: `q${index}`,
        sessionId: 's',
        role: index % 2 ? 'assistant' : 'user',
        text: `烹饪记录${index}`,
        createdAt: now + index,
      });
    tx.objectStore('settings').put({ id: 'activeConversationId', value: 'c' });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, contentExample);
  await page.reload();
  const messages = page.locator('.discovery-conversation .message');
  await expect(messages).toHaveCount(40);
  await expect(messages.last()).toContainText('历史消息999');
  await expect(page.locator('.recommendation .badge').first()).toHaveText('已有 · v100');
  const versionReads = await page.evaluate(
    () => (window as typeof window & { versionReads: number }).versionReads,
  );
  expect(versionReads).toBeLessThanOrEqual(2);
  const domElements = await page.locator('*').count();
  const inputMs: number[] = [];
  for (let index = 0; index < 4; index++) {
    const start = performance.now();
    await page.getByRole('textbox', { name: '描述做菜需求' }).fill(`输入${index}`);
    inputMs.push(performance.now() - start);
  }
  // Browse every page: old DOM must be removed, rather than accumulating on each click.
  for (let index = 0; index < 24; index++) {
    await page.getByRole('button', { name: '更早消息', exact: true }).click();
    await expect(messages).toHaveCount(40);
  }
  await expect(messages.first()).toContainText('历史消息0');
  await expect(page.getByRole('button', { name: '更早消息', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('oldest-messages.png') });
  await page.getByRole('button', { name: '回到最新', exact: true }).click();
  await expect(messages.last()).toContainText('历史消息999');
  await page.getByRole('button', { name: '使用已有菜谱' }).last().click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  await page.getByRole('button', { name: '问问 AI' }).click();
  const cooking = page.locator('.cooking-messages .message');
  await expect(cooking).toHaveCount(40);
  await expect(cooking.last()).toContainText('烹饪记录999');
  await page.getByRole('textbox', { name: '烹饪问题' }).fill('可以下锅了吗');
  await expect(cooking).toHaveCount(40);
  await page.getByRole('button', { name: '更早消息', exact: true }).click();
  await expect(cooking.last()).toContainText('烹饪记录959');
  await expect(cooking).toHaveCount(40);
  const metricsPath = testInfo.outputPath('scale-metrics.json');
  await writeFile(
    metricsPath,
    JSON.stringify(
      {
        messages: 1000,
        versions: 100,
        cpuRate: 4,
        renderedMessages: 40,
        versionReads,
        domElements,
        inputMs,
        warmedInputMedianMs: inputMs.slice(1).sort((a, b) => a - b)[1],
      },
      null,
      2,
    ),
  );
  await testInfo.attach('scale-metrics.json', {
    path: metricsPath,
    contentType: 'application/json',
  });
});
