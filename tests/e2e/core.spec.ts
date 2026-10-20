import { test, expect, type Page } from '@playwright/test';
import { contentExample } from '../../src/services/ai/cooking';
import { readFile } from 'node:fs/promises';

async function mock(page: Page) {
  await page.route('**/__local-model', (route) =>
    route.fulfill({
      json: {
        name: 'DeepSeek Flash',
        url: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        key: 'test-key-no-real-requests',
      },
    }),
  );
  await page.route('https://api.deepseek.com/**', async (route) => {
    if (route.request().url().endsWith('/v1/tools/search'))
      return route.fulfill({ json: { results: [] } });
    const body = route.request().postDataJSON();
    const system = body.messages?.[0]?.content ?? '';
    let result: unknown;
    if (system.includes('职责：首页对话'))
      result = {
        text: '可以做这道清爽家常菜。',
        candidates: [
          {
            name: '西红柿炒鸡蛋',
            aliases: ['番茄炒蛋'],
            minutes: 15,
            difficulty: '简单',
            summary: '番茄400g、鸡蛋3个。',
            blocked: '',
          },
        ],
      };
    else if (system.includes('职责：当前制作问答'))
      result = { text: '观察蛋液是否完全凝固；计时只是参考。', confirmations: [], proposal: null };
    else if (system.includes('完整指南按此')) result = contentExample;
    else result = '连接成功';
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: typeof result === 'string' ? result : JSON.stringify(result) },
          },
        ],
      },
    });
  });
}
async function generate(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'DeepSeek Flash' })).toBeVisible();
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('番茄400g和鸡蛋3个，做番茄炒蛋');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('button', { name: '生成菜谱' }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mock(page);
});
test('生成前只查一次网页搜索，参考内容进入提示词', async ({ page }) => {
  let searches = 0;
  let prompt = '';
  await page.route('https://api.deepseek.com/**', async (route) => {
    if (!route.request().url().endsWith('/v1/tools/search')) return route.fallback();
    searches++;
    await route.fulfill({
      json: {
        results: [{ title: '番茄炒蛋', url: 'https://a.example/1', summary: '鸡蛋先炒后盛出。' }],
      },
    });
  });
  await page.route('https://api.deepseek.com/**', async (route) => {
    const system = route.request().postDataJSON().messages?.[0]?.content ?? '';
    if (!system.includes('完整指南按此')) return route.fallback();
    prompt = route.request().postDataJSON().messages[1].content;
    await route.fulfill({
      json: {
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(contentExample) } }],
      },
    });
  });
  await generate(page);
  expect(searches).toBe(1);
  expect(prompt).toContain('网络参考');
  expect(prompt).toContain('鸡蛋先炒后盛出。');
});
test('步骤漏写油的引用仍可生成、保存，刷新后保留正确的分步用量', async ({ page }) => {
  const guide = structuredClone(contentExample);
  guide.steps[0].id = 'sear';
  guide.steps[1].id = 'combine';
  guide.steps[1].dependsOn = ['sear'];
  for (const step of guide.steps) step.action = step.action.replace('{{oil}}', '食用油');
  let generations = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    const system = route.request().postDataJSON().messages?.[0]?.content ?? '';
    if (!system.includes('完整指南按此')) return route.fallback();
    generations++;
    await route.fulfill({
      json: {
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(guide) } }],
      },
    });
  });
  await generate(page);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await expect(page.getByText('本步用量：食用油 10ml。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '跳转第 2 步', exact: true }).click();
  await expect(page.getByText('本步用量：食用油 5ml。', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('本步用量：食用油 5ml。', { exact: false })).toBeVisible();
  await expect(page.getByText(/\{\{oil\}\}/)).toHaveCount(0);
  expect(generations).toBe(1);
});

test('备菜依赖和重复提及的食材在本地修复，保存刷新后仍可阅读', async ({ page }) => {
  const guide = structuredClone(contentExample);
  guide.steps[0].dependsOn = ['cut'];
  guide.steps[1].action += '倒回 {{ egg }}。';
  let generations = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    if (!route.request().postDataJSON().messages?.[0]?.content.includes('完整指南按此'))
      return route.fallback();
    generations++;
    await route.fulfill({
      json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(guide) } }] },
    });
  });
  await generate(page);
  await page.getByRole('button', { name: '跳转第 2 步', exact: true }).click();
  await expect(page.getByText('倒回 鸡蛋。', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('倒回 鸡蛋。', { exact: false })).toBeVisible();
  await expect(page.getByText(/\{\{\s*egg\s*\}\}/)).toHaveCount(0);
  expect(generations).toBe(1);
});

test('字段和用量错误连续修复后自动保存，复用时不再生成', async ({ page }) => {
  // 菜系与分组现在会自动归一，这里用一个真实的字段缺失来触发修复回合。
  const wrongSchema = { ...contentExample, cookware: [] };
  const wrongAmounts = structuredClone(contentExample);
  wrongAmounts.steps[1].uses[0].fraction = 1;
  const responses = [wrongSchema, wrongAmounts, contentExample];
  let generations = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    if (!route.request().postDataJSON().messages?.[0]?.content.includes('完整指南按此'))
      return route.fallback();
    const response = responses[generations++];
    await route.fulfill({
      json: {
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }],
      },
    });
  });
  await generate(page);
  expect(generations).toBe(3);
  await page.reload();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '使用已有菜谱' }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  expect(generations).toBe(3);
});

test('修复后仍有用量冲突时保留候选，禁止保存无效菜谱', async ({ page }) => {
  const guide = structuredClone(contentExample);
  guide.steps[1].uses[0].fraction = 1;
  let generations = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    if (!route.request().postDataJSON().messages?.[0]?.content.includes('完整指南按此'))
      return route.fallback();
    generations++;
    await route.fulfill({
      json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(guide) } }] },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'DeepSeek Flash' })).toBeVisible();
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('番茄炒蛋');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('button', { name: '生成菜谱' }).click();
  await expect(page.getByText('菜谱内容校验未通过，未保存', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成菜谱' })).toBeEnabled();
  await expect(page.getByText('指南已生成，但尚未保存。')).toHaveCount(0);
  expect(generations).toBe(3);
  await page.goto('/#ai-recipes');
  await expect(page.getByText('还没有 AI 菜谱')).toBeVisible();
});
test('空白初态；推荐、生成、刷新、心得、再次制作', async ({ page }) => {
  await generate(page);
  await page.getByRole('checkbox', { name: '处理食材', exact: true }).check();
  await expect(page.getByText('1 / 1 已备好', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步：炒蛋盛出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '炒蛋盛出' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '炒蛋盛出' })).toBeVisible();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByRole('textbox', { name: '心得内容' }).fill('下次番茄多炒一会\n很好吃');
  await page.getByRole('button', { name: '保存心得' }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: 'AI 菜谱', exact: true }).click();
  await expect(page.getByText('下次番茄多炒一会', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '再做一次' }).click();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '心得内容' })).toHaveValue('');
});
test('预置列表200道；搜索分类组合；直接打开且不进入AI菜谱', async ({ page }) => {
  await page.goto('/#recipes');
  await expect(page.getByText('200 道家常菜')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索菜名' }).fill('西红柿炒鸡蛋');
  await page.getByRole('button', { name: '西式与日式', exact: true }).click();
  await expect(page.getByText('没有匹配的菜谱')).toBeVisible();
  await page.getByRole('button', { name: '中式', exact: true }).click();
  await page.getByRole('button', { name: /西红柿炒鸡蛋 中式/ }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  await page.goto('/#ai-recipes');
  await expect(page.getByText('还没有 AI 菜谱')).toBeVisible();
});
test('已有别名复用，不再次完整生成', async ({ page }) => {
  let generations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/chat/completions') && request.postData()?.includes('完整指南按此'))
      generations++;
  });
  await generate(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '使用已有菜谱' }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  expect(generations).toBe(1);
});
test('计时暂停与刷新恢复，心得取消保留原文', async ({ page }) => {
  await generate(page);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await page.getByRole('button', { name: '启动计时', exact: false }).click();
  await page.getByRole('button', { name: '暂停炒蛋盛出' }).click();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.reload();
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '计时器', exact: true }).getByText('已暂停', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '继续炒蛋盛出' }).click();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('button', { name: '计时中 · 查看计时' })).toBeVisible();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByRole('textbox', { name: '心得内容' }).fill('不会保存的草稿');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '心得内容' })).toHaveValue('');
});
test('备菜勾选即时反馈，保存失败回退并支持重试与刷新', async ({ page }) => {
  await generate(page);
  await page.evaluate(async () => {
    const path = '/src/storage/db.ts';
    const { db } = await import(path);
    const update = db.sessions.update.bind(db.sessions);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releasePrepSave: release });
    let first = true;
    db.sessions.update = async (id: string, changes: Record<string, unknown>) => {
      if ('checked' in changes && first) {
        first = false;
        await gate;
        throw new Error('备菜保存失败，请重试');
      }
      return update(id, changes);
    };
  });
  const checkbox = page.getByRole('checkbox', { name: '处理食材', exact: true });
  await checkbox.check();
  await expect(page.getByText('1 / 1 已备好', { exact: true })).toBeVisible();
  await expect(checkbox).toBeDisabled();
  await page.evaluate(() => {
    (window as typeof window & { releasePrepSave: () => void }).releasePrepSave();
  });
  await expect(page.getByRole('alert')).toContainText('备菜保存失败，请重试');
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  await expect(page.getByText('0 / 1 已备好', { exact: true })).toBeVisible();
  await checkbox.check();
  await expect(checkbox).toBeEnabled();
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('1 / 1 已备好', { exact: true })).toBeVisible();
});

test('问答分离；备菜阶段；确认进度不依赖翻卡', async ({ page }) => {
  await generate(page);
  await page.getByRole('button', { name: '问问 AI', exact: true }).click();
  await expect(page.getByText('备菜阶段 · v1')).toBeVisible();
  await page.getByRole('textbox', { name: '烹饪问题' }).fill('现在怎么处理');
  await page.getByRole('button', { name: '发送烹饪问题' }).click();
  await expect(page.getByText('观察蛋液是否完全凝固；计时只是参考。')).toBeVisible();
  await page.getByRole('button', { name: '确认实际执行进度' }).click();
  await page.getByRole('button', { name: '确认这些进度' }).click();
  await expect(page.getByText('实际进度已确认', { exact: false })).toBeVisible();
});
test('制作问答默认联网，关掉开关后不再检索', async ({ page }) => {
  let searches = 0;
  let prompts: string[] = [];
  await page.route('https://api.deepseek.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/v1/tools/search')) {
      searches++;
      return route.fulfill({
        json: {
          results: [
            {
              title: '生抽对比',
              url: 'https://a.example/1',
              summary: '金标生抽氨基酸态氮更高。',
              rerank_score: 2.2,
            },
          ],
        },
      });
    }
    if (!(route.request().postDataJSON().messages?.[0]?.content ?? '').includes('当前制作问答'))
      return route.fallback();
    prompts.push(route.request().postDataJSON().messages[0].content);
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ text: '换金标也行。', confirmations: [], proposal: null }),
            },
          },
        ],
      },
    });
  });
  await generate(page);
  searches = 0; // 生成阶段的检索单独计，这里只关心问答
  await page.getByRole('button', { name: '问问 AI', exact: true }).click();
  await page.getByRole('textbox', { name: '烹饪问题' }).fill('金标生抽咸不咸');
  await page.getByRole('button', { name: '发送烹饪问题' }).click();
  await expect(page.getByText('换金标也行。')).toBeVisible();
  expect(searches).toBe(1);
  expect(prompts[0]).toContain('金标生抽氨基酸态氮更高');
  prompts = [];
  await page.getByRole('button', { name: '关闭联网查找' }).click();
  await page.getByRole('textbox', { name: '烹饪问题' }).fill('还可以再放盐吗');
  await page.getByRole('button', { name: '发送烹饪问题' }).click();
  await expect(page.getByText('换金标也行。')).toHaveCount(2);
  expect(searches).toBe(1);
  expect(prompts[0]).not.toContain('网络参考');
});
test('认证失败不伪装成功，保留输入与候选', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'DeepSeek Flash' })).toBeVisible();
  await page.route('https://api.deepseek.com/**', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'private error body' } } }),
  );
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('做饭');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('API Key 无效或已失效', { exact: false })).toBeVisible();
  await expect(page.getByText('分析失败，可重新发送。')).toBeVisible();
  await expect(page.getByText('private error body')).toHaveCount(0);
});
test('新建对话取消延迟生成，旧响应不能入库或跳转', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'DeepSeek Flash' })).toBeVisible();
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('番茄炒蛋');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '生成菜谱' })).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('https://api.deepseek.com/**', async (route) => {
    await gate;
    await route
      .fulfill({
        json: {
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(contentExample) } },
          ],
        },
      })
      .catch(() => undefined);
  });
  await page.getByRole('button', { name: '生成菜谱' }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在生成' })).toBeVisible();
  const generating = page.getByRole('button', { name: '正在生成…', exact: true });
  await expect(generating).toBeDisabled();
  await expect(generating).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: '新建对话' }).click();
  release();
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  await page.goto('/#ai-recipes');
  await expect(page.getByText('还没有 AI 菜谱')).toBeVisible();
});

test('首页可直达菜谱，筛选可清空并恢复输入焦点', async ({ page }) => {
  await page.route('**/__local-model', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.getByRole('button', { name: '逛逛菜谱大全' }).click();
  const search = page.getByRole('textbox', { name: '搜索菜名' });
  await search.fill('鸡蛋');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByText('200 道家常菜')).toBeVisible();
  await page.getByRole('button', { name: '西式与日式', exact: true }).click();
  await expect(page.getByRole('button', { name: '西式与日式', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await search.fill('西红柿炒鸡蛋');
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('200 道家常菜')).toBeVisible();
});

test('设置保存等待期间防止重复提交，失败后保留输入并可重试', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('textbox', { name: '口味', exact: true }).fill('清淡少辣');
  await page.evaluate(async () => {
    const path = '/src/storage/db.ts';
    const { db } = await import(path);
    const put = db.settings.put.bind(db.settings);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseSave: release, preferenceSaves: 0 });
    db.settings.put = async (value: { id: string; value: unknown }) => {
      if (value.id !== 'preferences') return put(value);
      const state = window as typeof window & { preferenceSaves: number };
      state.preferenceSaves++;
      if (state.preferenceSaves === 1) {
        await gate;
        throw new Error('保存失败，请重试');
      }
      return put(value);
    };
  });
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  const saving = page.getByRole('button', { name: '正在保存…', exact: true });
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  await expect(saving).toBeDisabled();
  await saving.evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await page.evaluate(() => {
    (window as typeof window & { releaseSave: () => void }).releaseSave();
  });
  await expect(page.getByRole('alert')).toContainText('保存失败，请重试');
  await expect(page.getByRole('textbox', { name: '口味', exact: true })).toHaveValue('清淡少辣');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('通用设置已保存');
  expect(
    await page.evaluate(
      () => (window as typeof window & { preferenceSaves: number }).preferenceSaves,
    ),
  ).toBe(2);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '口味', exact: true })).toHaveValue('清淡少辣');
});
test('全局搜索直接展示结果、支持返回与刷新恢复', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: '搜索菜谱、心得与对话' }).click();
  await expect(page).toHaveURL(/#search$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const input = page.getByRole('searchbox', { name: '全局搜索', exact: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole('group', { name: '搜索范围' })).toHaveCount(0);
  await expect(page.getByRole('region')).toHaveCount(0);
  await input.fill('鸡蛋');
  await expect(input).toHaveValue('鸡蛋');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toHaveValue('');
  await input.fill('西红柿 鸡蛋');
  const results = page.getByRole('region', { name: '菜谱大全搜索结果' });
  await expect(results.locator('mark').filter({ hasText: '鸡蛋' }).first()).toBeVisible();
  await results.getByRole('button', { name: /^西红柿炒鸡蛋/ }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(input).toHaveValue('西红柿 鸡蛋');
  await expect(results).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue('西红柿 鸡蛋');
  await expect(results).toBeVisible();
  await input.fill('不存在的菜谱[.*');
  await expect(page.getByRole('status')).toHaveText('没有匹配结果');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toHaveValue('');
  await input.fill('   ');
  await expect(page.getByRole('region')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#home$/);
});

test('全局搜索忽略旧链接范围、支持同页切换关键词与浏览器后退', async ({ page }) => {
  await page.goto('/#search?q=鸡蛋&scope=catalog');
  const input = page.getByRole('searchbox', { name: '全局搜索', exact: true });
  await expect(input).toHaveValue('鸡蛋');
  await expect(page.getByRole('region', { name: '菜谱大全搜索结果' })).toBeVisible();
  await expect(page).not.toHaveURL(/scope=/);
  await page.evaluate(() => {
    location.hash = '#search?q=土豆&scope=ai';
  });
  await expect(input).toHaveValue('土豆');
  await expect(page.getByRole('region', { name: '菜谱大全搜索结果' })).toBeVisible();
  await expect(page).not.toHaveURL(/scope=/);
  await page.goBack();
  await expect(input).toHaveValue('鸡蛋');
  await expect(page.getByRole('region', { name: '菜谱大全搜索结果' })).toBeVisible();
});

test('全局搜索可命中心得与后续对话；历史可恢复', async ({ page }) => {
  await generate(page);
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByRole('textbox', { name: '心得内容' }).fill('特有心得青柠');
  await page.getByRole('button', { name: '保存心得' }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: '搜索菜谱、心得与对话' }).click();
  await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('鸡蛋');
  for (const source of ['AI 菜谱', '菜谱大全', '对话历史']) {
    await expect(page.getByRole('region', { name: `${source}搜索结果` })).toBeVisible();
  }
  await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('青柠');
  await page.getByRole('button', { name: /西红柿炒鸡蛋.*青柠/ }).click();
  await expect(page.getByRole('heading', { name: '准备好，再开火' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '全局搜索', exact: true })).toHaveValue('青柠');
  await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('番茄400g');
  await page.getByRole('region', { name: '对话历史搜索结果' }).getByRole('button').click();
  await expect(page.getByRole('button', { name: '使用已有菜谱' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '全局搜索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: '全部' }).click();
  await page.getByRole('button', { name: /番茄400g和鸡蛋3个/ }).click();
  await expect(page.getByRole('button', { name: '使用已有菜谱' })).toBeVisible();
});

for (const width of [320, 390, 480, 1280])
  test(`全局搜索页面与结果无横向溢出 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#search');
    await expect(page.getByRole('heading', { name: '全局搜索', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/screenshots/search-start-${width}.png`, fullPage: true });
    await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('鸡蛋');
    await expect(page.getByRole('region', { name: '菜谱大全搜索结果' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/screenshots/search-results-${width}.png` });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(page.locator('.search-controls')).toHaveCSS('position', 'sticky');
    expect(
      await page
        .locator('.search-controls')
        .evaluate((element) => element.getBoundingClientRect().top),
    ).toBe(76);
    await page.getByRole('searchbox', { name: '全局搜索', exact: true }).fill('土豆');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('region', { name: '菜谱大全搜索结果' })).toBeVisible();
  });
for (const width of [320, 390, 480, 1280])
  test(`布局无横向溢出 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await generate(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/screenshots/cooking-${width}.png` });
  });

test('模型编辑、真实连接适配测试、添加、切换、删除；刷新不补回配置', async ({ page }) => {
  await page.goto('/#settings');
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '配置名称' }).fill('我的模型');
  await expect(page.locator('input[aria-label="API Key"]')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功 · 连接成功')).toBeVisible();
  await page.getByRole('button', { name: '保存模型' }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('textbox', { name: '配置名称' }).fill('第二模型');
  await page.getByRole('button', { name: '保存模型' }).click();
  await page.getByRole('button', { name: '使用第二模型' }).click();
  await page.getByRole('button', { name: '删除模型我的模型' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('button', { name: '删除模型第二模型' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '添加你的第一个模型' })).toBeVisible();
});
test('导出无 Key；确认清空后用户数据不重建，预置仍可使用', async ({ page }) => {
  await generate(page);
  await page.goto('/#settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据 JSON' }).click();
  const download = await downloadPromise;
  const output = await readFile((await download.path())!, 'utf8');
  expect(output).not.toContain('test-key-no-real-requests');
  expect(JSON.parse(output).sessions).toHaveLength(1);
  expect(JSON.parse(output).models[0].key).toBe('[已隐藏]');
  await page.getByRole('button', { name: '清除全部本地数据', exact: true }).click();
  await page.getByRole('button', { name: '确认清除全部数据' }).click();
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择模型' })).toBeVisible();
  await page.goto('/#ai-recipes');
  await expect(page.getByText('还没有 AI 菜谱')).toBeVisible();
  await page.goto('/#recipes');
  await expect(page.getByText('200 道家常菜')).toBeVisible();
});
test('分析中刷新会标记中断，不留下永久处理中消息', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'DeepSeek Flash' })).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('https://api.deepseek.com/**', async (route) => {
    await gate;
    await route.abort().catch(() => undefined);
  });
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('做番茄炒蛋');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('正在分析…', { exact: true }).first()).toBeVisible();
  await page.reload();
  release();
  await expect(page.getByText(/请求已中断，请重新发送|请求已取消，可继续发送/)).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('再试一次');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
});
