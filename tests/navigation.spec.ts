import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cookpilot.demo.v1')!));
const menu = (page: Page) => page.getByRole('button', { name: '菜单', exact: true });

test('首页独占菜单入口，菜谱分成独立页面，抽屉紧凑且可关闭', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toHaveCount(0);
  await menu(page).click();
  const drawer = page.getByRole('dialog', { name: 'CookPilot', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.history-item')).toHaveCount(4);
  await expect(drawer.locator('.drawer-navigation button')).toHaveText(['AI 菜谱', '菜谱大全', '我的厨房']);
  await expect(drawer.getByRole('button', { name: /开始做菜|我的指南/ })).toHaveCount(0);
  const search = await drawer.getByRole('button', { name: '全局搜索' }).boundingBox();
  const close = await drawer.getByRole('button', { name: '关闭弹窗' }).boundingBox();
  expect(search!.x + search!.width).toBeLessThanOrEqual(close!.x);
  expect(search!.y).toBeLessThan(24);
  const firstItem = await drawer.locator('.drawer-navigation button').first().boundingBox();
  expect(firstItem!.y).toBeLessThan(80);
  const kitchen = await drawer.getByRole('button', { name: '我的厨房' }).boundingBox();
  const history = await drawer.getByRole('heading', { name: '对话历史' }).boundingBox();
  expect(history!.y).toBeGreaterThan(kitchen!.y + kitchen!.height);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
  for (const [label, hash] of [['AI 菜谱', 'ai-recipes'], ['菜谱大全', 'recipes'], ['我的厨房', 'settings']]) {
    await menu(page).click();
    await drawer.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/#home$/);
  }
  await menu(page).click();
  await page.mouse.click(375, 200);
  await expect(drawer).toHaveCount(0);
  await menu(page).click();
  await page.screenshot({ path: '.local/navigation-drawer.png', animations: 'disabled' });
});

test('首屏减少顶部留白和多余入口，提交后标题与输入框固定，窄屏没有遮挡', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const center = await page.locator('.home-center').boundingBox();
  const header = await page.locator('.home-header').boundingBox();
  expect(header!.height).toBe(64);
  expect(center!.y).toBeGreaterThan(header!.height + 24);
  expect(center!.y).toBeLessThan(180);
  await expect(page.getByRole('button', { name: '菜谱大全', exact: true })).toHaveCount(0);
  await expect(page.locator('.prompt-intro, .prompt-examples')).toHaveCount(0);
  await page.screenshot({ path: '.local/home-compact.png', animations: 'disabled' });
  for (const prompt of ['有番茄和鸡蛋', '想吃点快手的', '今晚想吃牛肉']) {
    await page.getByLabel('描述做菜需求').fill(prompt);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByLabel('描述做菜需求')).toBeEnabled();
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const composerBefore = await page.locator('.home-composer').boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const composer = await page.locator('.home-composer').boundingBox();
    const fixedHeader = await page.locator('.home-header').boundingBox();
    expect(fixedHeader!.y).toBe(0);
    expect(composer!.y).toBe(composerBefore!.y);
    expect(composer!.y + composer!.height).toBeCloseTo(844, 0);
    const lastMessage = await page.locator('.discovery-turn').last().boundingBox();
    expect(lastMessage!.y + lastMessage!.height).toBeLessThanOrEqual(composer!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const identity = await page.locator('.header-identity').boundingBox();
    const controls = await page.locator('.home-controls').boundingBox();
    expect(identity!.x + identity!.width).toBeLessThanOrEqual(controls!.x);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/conversation-fixed.png' });
});

test('新建对话保留旧历史，历史恢复与继续输入、刷新保存，取消生成不会串入新对话', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('描述做菜需求').fill('月亮为什么会发光？');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.discovery-summary')).toContainText('太阳光');
  const original = (await stored(page)).activeConversationId;
  await page.getByRole('button', { name: '新建对话' }).click();
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  expect((await stored(page)).conversations).toHaveLength(5);
  await menu(page).click();
  await page.locator('.history-item').filter({ hasText: '月亮为什么会发光？' }).click();
  expect((await stored(page)).activeConversationId).toBe(original);
  await page.getByLabel('描述做菜需求').fill('谢谢');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.discovery-summary')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.discovery-summary')).toHaveCount(2);
  await page.getByRole('button', { name: '新建对话' }).click();
  await page.getByLabel('描述做菜需求').fill('日式咖喱鸡');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('button', { name: '生成菜谱：日式咖喱鸡', exact: true }).click();
  await page.getByRole('button', { name: '新建对话' }).click();
  await page.waitForTimeout(1000);
  expect((await stored(page)).guides).toHaveLength(2);
  expect((await stored(page)).activeConversationId).toBeNull();
  await expect(page.locator('.discovery-turn')).toHaveCount(0);
  await expect(page).toHaveURL(/#home$/);
});

test('返回按访问顺序逐级到首页，刷新和浏览器后退前进保持页面', async ({ page }) => {
  await page.goto('/');
  for (const [label, hash, dish] of [['AI 菜谱', 'ai-recipes', '宫保鸡丁'], ['菜谱大全', 'recipes', '日式咖喱鸡']]) {
    await menu(page).click();
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: label, exact: true }).click();
    const opener = hash === 'ai-recipes' ? page.locator('.guide-main').filter({ hasText: dish })
      : page.getByRole('button', { name: dish, exact: true });
    await opener.click();
    await expect(page).toHaveURL(/#cook$/);
    await expect(menu(page)).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/#home$/);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await page.goBack();
    await expect(menu(page)).toBeVisible();
  }
  await page.goto('/#settings');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#home$/);
});

async function openSearch(page: Page) {
  await menu(page).click();
  await page.getByRole('button', { name: '全局搜索', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '搜索', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索全部内容' })).toBeFocused();
}

test('全局搜索覆盖菜谱正文、心得及完整对话，结果按来源分组并可打开', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    state.guides[0].note = '独家心得：青柠皮最后加';
    state.guides[0].recipe.steps[0].tip = '独家步骤：观察锅边的小气泡';
    state.conversations[0].turns.push({ id: 'deep-message', prompt: '第二轮的问题藏在这里',
      result: { kind: 'chat', text: '答复中的隐藏关键词：玫瑰盐' } });
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  await openSearch(page);
  const dialog = page.getByRole('dialog', { name: '搜索', exact: true });
  const input = page.getByRole('textbox', { name: '搜索全部内容' });
  await expect(input).toHaveAttribute('placeholder', '搜索菜谱、心得或对话');
  await expect(dialog.locator('.global-search-results')).toHaveCount(0);
  for (const term of ['青柠皮', '观察锅边的小气泡']) {
    await input.fill(term);
    await expect(dialog.getByRole('region', { name: 'AI 菜谱', exact: true }).getByRole('button')).toHaveCount(1);
    await expect(dialog.getByRole('region', { name: '菜谱大全', exact: true }).getByRole('button')).toHaveCount(0);
  }
  await input.fill('青柠皮');
  await dialog.getByRole('region', { name: 'AI 菜谱', exact: true }).getByRole('button').click();
  await expect(page).toHaveURL(/#cook$/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await openSearch(page);
  await input.fill('碗汁');
  await expect(dialog.getByRole('region', { name: '菜谱大全', exact: true }).getByRole('button')).not.toHaveCount(0);
  await dialog.getByRole('region', { name: '菜谱大全', exact: true }).getByRole('button').first().click();
  await expect(page).toHaveURL(/#cook$/);
  expect((await stored(page)).guides[0].source).toBe('catalog');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await openSearch(page);
  for (const term of ['第二轮的问题', '玫瑰盐']) {
    await input.fill(term);
    await expect(dialog.getByRole('region', { name: '对话历史', exact: true }).getByRole('button')).toHaveCount(1);
  }
  await dialog.getByRole('region', { name: '对话历史', exact: true }).getByRole('button').click();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.discovery-summary').last()).toContainText('玫瑰盐');
  expect((await stored(page)).activeConversationId).toBe('demo-conversation-0');
});

test('搜索空结果、清空、键盘关闭和窄屏长内容均可用', async ({ page }) => {
  await page.goto('/');
  await openSearch(page);
  const dialog = page.getByRole('dialog', { name: '搜索', exact: true });
  const input = page.getByRole('textbox', { name: '搜索全部内容' });
  await input.fill('完全不存在的菜名');
  await expect(dialog.getByText('没有匹配结果', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('鸡');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(input).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/global-search.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'CookPilot', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeFocused();
});

test('30 天边界保留，超期记录从存储删除，打开页面期间到期也清理', async ({ page }) => {
  const fixedNow = new Date('2026-10-12T04:00:00Z');
  await page.clock.install({ time: fixedNow });
  await page.clock.pauseAt(new Date(fixedNow.getTime() + 1000));
  await page.goto('/');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    const template = state.conversations[0];
    const date = (age: number) => new Date(Date.now() - age).toISOString();
    const days30 = 30 * 24 * 60 * 60 * 1000;
    state.conversations = [
      { ...template, id: 'expired', title: '已经过期', updatedAt: date(days30 + 1) },
      { ...template, id: 'boundary', title: '正好三十天', updatedAt: date(days30) },
      { ...template, id: 'recent', title: '最近对话', updatedAt: date(0) },
    ];
    state.activeConversationId = 'expired';
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  let state = await stored(page);
  expect(state.conversations.map((c: any) => c.id)).toEqual(['boundary', 'recent']);
  expect(state.activeConversationId).toBeNull();
  await menu(page).click();
  await expect(page.locator('.history-item')).toHaveText(['最近对话', '正好三十天']);
  await page.locator('.history-item').filter({ hasText: '正好三十天' }).click();
  await page.clock.fastForward(61000);
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  expect((await stored(page)).activeConversationId).toBeNull();
  await menu(page).click();
  await expect(page.locator('.history-item')).toHaveText(['最近对话']);
  state = await stored(page);
  expect(state.conversations.map((c: any) => c.id)).toEqual(['recent']);
});
