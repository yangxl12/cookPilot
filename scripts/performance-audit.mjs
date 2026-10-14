import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const label = process.argv[2] || 'after';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a plain label for the output filename');
await mkdir('.local', { recursive: true });
const base = process.argv[3] || 'http://localhost:5173';
const target = new URL(base);
if (
  target.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/'
)
  throw new Error('Use a local development server at the root path');
const catalog = JSON.parse(await readFile('src/assets/recipes/catalog.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__local-model', (route) => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    window.audit = { reads: {}, renders: {} };
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      for (const name of ['getAll', 'get', 'openCursor', 'getAllKeys']) {
        const original = prototype[name];
        prototype[name] = function (...args) {
          const table = this.objectStore?.name || this.name;
          window.audit.reads[table] = (window.audit.reads[table] || 0) + 1;
          return original.apply(this, args);
        };
      }
    }
    let previousFibers = new WeakSet();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        this.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberUnmount() {},
      onCommitFiberRoot(_id, root) {
        const currentFibers = new WeakSet();
        const visit = (fiber) => {
          if (!fiber) return;
          currentFibers.add(fiber);
          const name = fiber.type?.name;
          if (name && fiber.flags & 1 && !previousFibers.has(fiber))
            window.audit.renders[name] = (window.audit.renders[name] || 0) + 1;
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
        previousFibers = currentFibers;
      },
    };
  });
  await page.goto(`${base}/`);
  await page.getByRole('heading', { name: '想做什么菜？' }).waitFor();
  await page.evaluate(async (content) => {
    const { db } = await import('/src/storage/db.ts');
    const now = Date.now();
    await db.transaction(
      'rw',
      db.recipes,
      db.versions,
      db.sessions,
      db.conversations,
      db.cookingMessages,
      async () => {
        for (let i = 0; i < 250; i++) {
          await db.recipes.put({
            id: `r${i}`,
            identity: `r${i}`,
            name: `测试菜${i}`,
            aliases: [],
            source: 'ai',
            createdAt: now,
          });
          for (let v = 1; v <= 3; v++)
            await db.versions.put({
              id: `v${i}-${v}`,
              recipeId: `r${i}`,
              number: v,
              parentId: null,
              content: { ...content, title: `测试菜${i}` },
              change: '初始版本',
              createdAt: now,
            });
          await db.sessions.put({
            id: `s${i}`,
            recipeId: `r${i}`,
            versionId: `v${i}-3`,
            checked: [],
            currentCard: 0,
            execution: [],
            progressKnown: false,
            revision: 0,
            note: '',
            createdAt: now,
          });
        }
        for (let i = 0; i < 100; i++)
          await db.conversations.put({
            id: `c${i}`,
            title: `对话${i}`,
            createdAt: now,
            lastSentAt: now,
            messages: Array.from({ length: 40 }, (_, j) => ({
              id: `m${j}`,
              role: j % 2 ? 'assistant' : 'user',
              text: '西红柿炒鸡蛋做法'.repeat(30),
              createdAt: now,
            })),
          });
        for (let i = 0; i < 1000; i++)
          await db.cookingMessages.put({
            id: `q${i}`,
            sessionId: `s${i % 250}`,
            role: 'assistant',
            text: '问答内容'.repeat(100),
            createdAt: now,
          });
      },
    );
  }, catalog[0].content);
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole('heading', { name: '想做什么菜？' }).waitFor();
  await page.waitForTimeout(500);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const initial = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => {
    window.audit = { reads: {}, renders: {} };
  });
  await page.waitForTimeout(3500);
  const idle = await page.evaluate(() => window.audit);
  await page.evaluate(async () => {
    const { db } = await import('/src/storage/db.ts');
    await db.settings.put({ id: 'lease:performance-probe', value: Date.now() });
  });
  await page.waitForTimeout(500);
  const heartbeat = await page.evaluate(() => window.audit);
  await page.goto(`${base}/#cook?session=s0`);
  await page.getByRole('heading', { name: '准备好，再开火' }).waitFor();
  await page.evaluate(() => {
    window.audit = { reads: {}, renders: {} };
  });
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
    await page.getByRole('button', { name: '跳转准备卡片', exact: true }).click();
  }
  await page.waitForTimeout(300);
  const cards = await page.evaluate(() => window.audit);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const measure = async (operation) => {
    const before = await cdp.send('Performance.getMetrics');
    const start = await page.evaluate(() => performance.now());
    await operation();
    const elapsedMs = await page.evaluate((start) => performance.now() - start, start);
    const after = await cdp.send('Performance.getMetrics');
    const get = (metrics, key) => metrics.metrics.find((m) => m.name === key)?.value || 0;
    return {
      elapsedMs,
      taskMs: (get(after, 'TaskDuration') - get(before, 'TaskDuration')) * 1000,
      layoutMs: (get(after, 'LayoutDuration') - get(before, 'LayoutDuration')) * 1000,
    };
  };
  const list = await measure(async () => {
    await page.evaluate(() => {
      location.hash = '#ai-recipes';
    });
    await page.locator('.saved-recipe').last().waitFor({ state: 'attached' });
  });
  const filter = await measure(async () => {
    await page.getByRole('textbox', { name: '搜索菜名' }).pressSequentially('测试菜2');
    await page.getByText('61 条制作记录', { exact: true }).waitFor();
  });
  await page.evaluate(() => {
    location.hash = '#search';
  });
  await page.getByRole('searchbox', { name: '全局搜索' }).waitFor();
  const search = await measure(async () => {
    await page.getByRole('searchbox', { name: '全局搜索' }).pressSequentially('鸡蛋');
    for (const source of ['AI 菜谱', '菜谱大全', '对话历史']) {
      await page.getByRole('region', { name: `${source}搜索结果` }).waitFor({ state: 'attached' });
    }
    await page.locator('.search-result mark').filter({ hasText: '鸡蛋' }).first().waitFor();
  });
  const result = {
    label,
    throttled4x: { list, filter, search },
    initialMetrics: Object.fromEntries(
      initial.metrics
        .filter((m) => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners'].includes(m.name))
        .map((m) => [m.name, m.value]),
    ),
    idle,
    heartbeat,
    cards,
  };
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(`.local/performance-${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
