import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cookpilot.demo.v1')!));
const menu = (page: Page) => page.getByRole('button', { name: '菜单', exact: true });

test('抽屉导航替代 tabbar，历史位于厨房后，可关闭并在所有主页面使用', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toHaveCount(0);
  await menu(page).click();
  const drawer = page.getByRole('dialog', { name: '菜单', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.history-item')).toHaveCount(4);
  const kitchen = await drawer.getByRole('button', { name: '我的厨房' }).boundingBox();
  const history = await drawer.getByRole('heading', { name: '对话历史' }).boundingBox();
  expect(history!.y).toBeGreaterThan(kitchen!.y + kitchen!.height);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
  for (const [label, hash] of [['我的指南', 'library'], ['我的厨房', 'settings'], ['开始做菜', 'home']]) {
    await menu(page).click();
    await drawer.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(drawer).toHaveCount(0);
  }
  await menu(page).click();
  await page.mouse.click(375, 200);
  await expect(drawer).toHaveCount(0);
  await menu(page).click();
  await page.screenshot({ path: '.local/navigation-drawer.png', animations: 'disabled' });
});

test('首屏居中，提交后标题与输入框固定，长对话和窄屏没有遮挡或横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const center = await page.locator('.home-center').boundingBox();
  const header = await page.locator('.home-header').boundingBox();
  expect(Math.abs(center!.y + center!.height / 2 - (844 + header!.height) / 2)).toBeLessThan(24);
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
