import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('cookpilot.demo.v1')!));
async function navigateMenu(page: Page, label: string) {
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: label, exact: true }).click();
}

async function generateChicken(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '菜谱大全', exact: true }).click();
  await page.getByRole('button', { name: '宫保鸡丁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '宫保鸡丁', exact: true })).toBeVisible();
}

async function selectSuggested(page: Page, dish: string) {
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^(生成菜谱|使用已有菜谱)：${dish}$`) }).last().click();
  await expect(page).toHaveURL(/#cook$/);
}

async function removeSeedChicken(page: Page) {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    state.guides = state.guides.filter((g: any) => g.recipe.id !== 'chicken');
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
}

test('我的指南双 tab、首页直达、刷新与旧入口兼容，AI 菜谱和预置列表独立', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '菜谱大全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的指南' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['AI 菜谱2', '菜谱大全6']);
  await expect(page.getByRole('tab', { name: /菜谱大全/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的指南', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page).toHaveURL(/#library\/recipes$/);
  await page.reload();
  await expect(page.getByRole('tab', { name: /菜谱大全/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.catalog-recipe')).toHaveCount(6);

  await page.getByRole('tab', { name: /AI 菜谱/ }).click();
  await page.getByRole('textbox', { name: '搜索我的指南' }).fill('不存在');
  await expect(page.getByRole('heading', { name: '未找到菜谱' })).toBeVisible();
  await page.getByRole('tab', { name: /菜谱大全/ }).click();
  await page.getByRole('textbox', { name: '搜索菜谱' }).fill('咖喱');
  await expect(page.locator('.catalog-recipe')).toHaveCount(1);
  await page.getByRole('tab', { name: /AI 菜谱/ }).click();
  await expect(page.getByRole('textbox', { name: '搜索我的指南' })).toHaveValue('不存在');
  await page.locator('.search-field').getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(page.locator('.guide-card')).toHaveCount(2);

  await page.goto('/#recipes');
  await expect(page).toHaveURL(/#library\/recipes$/);
  await page.getByRole('button', { name: '日式咖喱鸡', exact: true }).click();
  expect((await stored(page)).guides[0].source).toBe('catalog');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('tab', { name: /菜谱大全/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '搜索菜谱' })).toHaveValue('咖喱');
  await page.getByRole('textbox', { name: '搜索菜谱' }).fill('');
  await expect(page.locator('.catalog-recipe')).toHaveCount(6);
  await page.getByRole('tab', { name: /AI 菜谱/ }).click();
  await expect(page.locator('.guide-card')).toHaveCount(2);

  await navigateMenu(page, '开始做菜');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('日式咖喱鸡');
  await selectSuggested(page, '日式咖喱鸡');
  expect((await stored(page)).guides[0].source).toBe('ai');
  await page.goto('/#library');
  await expect(page.locator('.guide-card')).toHaveCount(3);
  await expect(page.getByText('收藏', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: '.local/library-ai-mobile.png', fullPage: true });
  await page.getByRole('tab', { name: /菜谱大全/ }).click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeVisible();
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/library-recipes-mobile.png', fullPage: true });
});

test('旧收藏数据迁移保留指南和复盘，本地管理与导出移除收藏', async ({ page }) => {
  await page.goto('/');
  const original = await stored(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    delete state.conversations;
    delete state.activeConversationId;
    for (const guide of state.guides) {
      guide.favorite = true;
      delete guide.source;
    }
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.goto('/#library');
  await page.reload();
  await expect(page.locator('.guide-card')).toHaveCount(2);
  const migrated = await stored(page);
  expect(migrated.conversations).toHaveLength(4);
  expect(migrated.activeConversationId).toBeNull();
  expect(migrated.guides.map((g: any) => g.id)).toEqual(original.guides.map((g: any) => g.id));
  expect(migrated.guides[1].note).toBe(original.guides[1].note);
  expect(migrated.guides.every((g: any) => g.source === 'ai' && !('favorite' in g))).toBe(true);
  await page.getByRole('button', { name: '指南数据管理' }).click();
  await expect(page.getByRole('dialog')).not.toContainText('收藏');
  await expect(page.locator('.data-stats > span')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出数据/ }).click();
  const download = await downloadPromise;
  const content = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(content).guides.every((g: any) => !('favorite' in g))).toBe(true);
});

test('卡片阅读、心得保存、搜索与沿用保存版本', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await removeSeedChicken(page);
  await page
    .getByRole('textbox', { name: '描述做菜需求' })
    .fill('想做宫保鸡丁，3人吃，450克鸡肉，不辣，花生过敏');
  await selectSuggested(page, '宫保鸡丁');
  await expect(page.getByRole('heading', { name: '宫保鸡丁', exact: true })).toBeVisible();
  const generated = await stored(page);
  const original = generated.guides[0];
  expect(original.conditions.servings).toBe(2);
  expect(original.recipe.ingredients.find((i: any) => i.id === 'chicken').quantity).toBe(450);
  expect(
    original.recipe.ingredients.some((i: any) => ['peanuts', 'chili', 'pepper'].includes(i.id)),
  ).toBe(false);
  expect(original.recipe.prep.find((p: any) => p.id === 'tools').title).toBe('准备餐具');
  expect(original.recipe).not.toHaveProperty('signals');
  await expect(page.getByRole('button', { name: /收藏/ })).toHaveCount(0);
  for (const prep of original.recipe.prep)
    await page.getByRole('button', { name: `完成：${prep.title}`, exact: true }).click();
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  for (let index = 0; index < original.recipe.steps.length; index++) {
    await expect(page.locator('.current-step h1')).toHaveText(original.recipe.steps[index].title);
    if (index < original.recipe.steps.length - 1)
      await page.getByRole('button', { name: `跳转第 ${index + 2} 步` }).click();
  }
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByLabel('我的记录').fill('不放花生很合适，下次还用这个版本。');
  await page.getByRole('button', { name: '保存心得' }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await navigateMenu(page, '我的指南');
  await expect(page.getByRole('heading', { name: '我的指南' })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索我的指南' }).fill('宫保');
  await expect(page.locator('.guide-card')).toHaveCount(1);
  const finished = (await stored(page)).guides.find((g: any) => g.id === original.id);
  expect(finished.status).toBe('cooking');
  expect(finished.note).toContain('下次还用这个版本');
  expect(finished).not.toHaveProperty('rating');
  expect(finished).not.toHaveProperty('favorite');
  expect(finished.source).toBe('ai');
  await page.getByRole('button', { name: '再做一次', exact: true }).first().click();
  const repeated = (await stored(page)).guides[0];
  expect(repeated.id).not.toBe(original.id);
  expect(repeated.recipe).toEqual(finished.recipe);
  expect(repeated.completed).toEqual([]);
  expect(errors).toEqual([]);
});

test('首页与指南库移除续做入口，旧制作记录可查看或从头再做', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /继续烹饪/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('宫保鸡丁');
  await selectSuggested(page, '宫保鸡丁');
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await page.getByRole('button', { name: '跳转第 3 步', exact: true }).click();
  const original = (await stored(page)).guides[0];
  expect(original.status).toBe('cooking');
  expect(original.currentStep).toBe(2);

  await page.goto('/#home');
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(page.getByRole('button', { name: /继续烹饪|继续做/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '菜谱大全', exact: true })).toBeVisible();
  await navigateMenu(page, '我的指南');
  await expect(page.getByRole('tab')).toHaveText(['AI 菜谱2', '菜谱大全6']);
  await expect(page.getByRole('button', { name: /进行中|继续做/ })).toHaveCount(0);
  await expect(page.locator('.guide-status')).not.toContainText([/进行中/]);

  const card = page.locator('.guide-card').first();
  await card.locator('.guide-main').click();
  await expect(page).toHaveURL(/#cook$/);
  await expect(page.getByRole('heading', { name: '宫保鸡丁', exact: true })).toBeVisible();
  await page.goto('/#library');
  await card.getByRole('button', { name: '再做一次', exact: true }).click();
  const repeated = (await stored(page)).guides[0];
  expect(repeated.id).not.toBe(original.id);
  expect(repeated.recipe).toEqual(original.recipe);
  expect(repeated.currentStep).toBe(0);
  expect(repeated.completed).toEqual([]);
  expect(repeated.checked).toEqual([]);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await expect(page.locator('.current-step h1')).toHaveText(original.recipe.steps[0].title);
});

test('进度问答与确认后调整，仅更新剩余流程，刷新恢复', async ({ page }) => {
  await generateChicken(page);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  // Existing saved progress still limits AI adjustments to unfinished steps.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    state.guides[0].completed = [state.guides[0].recipe.steps[0].id];
    state.guides[0].currentStep = 1;
    state.guides[0].currentCard = 2;
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  const before = (await stored(page)).guides[0];
  await page.getByRole('button', { name: '问问 AI' }).click();
  await expect(page.getByRole('dialog')).toContainText('第 2 步');
  await page.getByRole('button', { name: '锅里出水了', exact: true }).click();
  await expect(page.getByRole('button', { name: '更新剩余步骤' })).toBeVisible();
  expect((await stored(page)).guides[0].version).toBe(1);
  await page.getByRole('button', { name: '更新剩余步骤' }).click();
  const after = (await stored(page)).guides[0];
  expect(after.version).toBe(2);
  expect(after.completed).toEqual(before.completed);
  expect(after.recipe.steps[0]).toEqual(before.recipe.steps[0]);
  expect(after.recipe.steps[1].action).toContain('调整：');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.reload();
  await expect(page.locator('.current-step h1')).toHaveText('滑炒鸡丁');
  await expect(page.locator('.current-step .step-action')).toContainText('调整：');
  await page.getByRole('button', { name: '查看全部步骤' }).click();
  await expect(page.locator('.step-circle.done')).toHaveCount(1);
});

test('多个命名计时器暂停、刷新、继续、到点不自动完成和取消', async ({ page }) => {
  await generateChicken(page);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await page.getByRole('button', { name: /开始计时/ }).click();
  await page.getByRole('button', { name: /查看 1 个运行中的计时器/ }).click();
  await page.getByRole('textbox', { name: '计时名称', exact: true }).fill('第二个计时');
  await page.getByRole('spinbutton', { name: '计时分钟' }).fill('0.5');
  await page.getByRole('button', { name: '开始计时', exact: true }).click();
  await expect(page.locator('.timers-list .timer-card')).toHaveCount(2);
  await page.getByRole('button', { name: '暂停计时第二个计时', exact: true }).click();
  const before = await stored(page);
  const paused = before.timers.find((t: any) => t.name === '第二个计时');
  expect(paused.endAt).toBeNull();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.reload();
  const restored = await stored(page);
  expect(restored.timers.find((t: any) => t.id === paused.id)).toEqual(paused);
  expect(restored.guides[0].currentStep).toBe(0);
  await page.getByRole('button', { name: /查看 1 个运行中的计时器/ }).click();
  await page.getByRole('button', { name: '继续计时第二个计时', exact: true }).click();
  expect((await stored(page)).timers.find((t: any) => t.id === paused.id).endAt).not.toBeNull();
  await page.getByRole('textbox', { name: '计时名称', exact: true }).fill('到点演示');
  await page.getByRole('spinbutton', { name: '计时分钟' }).fill('0.05');
  await page.getByRole('button', { name: '开始计时', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.timer-card.expired')).toContainText('到点演示', {
    timeout: 6000,
  });
  const expired = await stored(page);
  expect(expired.guides[0].currentStep).toBe(0);
  expect(expired.guides[0].completed).toEqual([]);
  await page.getByRole('button', { name: '取消计时到点演示' }).click();
  await expect(page.locator('.timers-list .timer-card')).toHaveCount(2);
});

test('模型增改测切删，默认隐藏敏感值，导出不含 API Key', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('配置名称', { exact: true }).fill('厨房测试模型');
  await page.getByLabel('接口地址', { exact: true }).fill('https://example.com/v1');
  const key = page.getByLabel('API Key', { exact: true });
  await key.fill('sk-test-SECRET-should-not-export');
  await expect(key).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '显示 API Key' }).click();
  await expect(key).toHaveAttribute('type', 'text');
  await page.getByLabel('模型名称', { exact: true }).fill('test-model');
  await page.getByRole('button', { name: '保存配置' }).click();
  const card = page.locator('.model-card').filter({ hasText: '厨房测试模型' });
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByRole('status')).toContainText('模拟连接成功');
  await page.getByRole('button', { name: '使用厨房测试模型' }).click();
  await expect(card).toHaveClass(/selected/);
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('配置名称', { exact: true }).fill('修改后的搭档');
  await page.getByRole('button', { name: '保存配置' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出数据/ }).click();
  const download = await downloadPromise;
  const content = await readFile((await download.path())!, 'utf8');
  expect(content).not.toContain('sk-test-SECRET');
  expect(JSON.parse(content).models.every((m: any) => !('key' in m))).toBe(true);
  await page.getByRole('button', { name: '删除模型修改后的搭档' }).click();
  await page.getByRole('button', { name: '删除配置', exact: true }).click();
  await expect(page.locator('.model-card')).toHaveCount(2);
});

test('空状态、删除数据、恢复示例与新增意面菜谱', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByRole('button', { name: /管理本地数据/ }).click();
  await page.getByRole('button', { name: '清除全部本地数据' }).click();
  await page.getByRole('button', { name: '清除全部数据', exact: true }).click();
  expect((await stored(page)).conversations).toEqual([]);
  await page.reload();
  expect((await stored(page)).conversations).toEqual([]);
  await navigateMenu(page, '我的指南');
  await expect(page.getByRole('heading', { name: '暂无指南' })).toBeVisible();
  await navigateMenu(page, '开始做菜');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('我想做意大利面');
  await selectSuggested(page, '番茄罗勒意面');
  await expect(page.getByRole('heading', { name: '番茄罗勒意面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await navigateMenu(page, '我的厨房');
  await page.getByRole('button', { name: /管理本地数据/ }).click();
  await page.getByRole('button', { name: '恢复演示数据', exact: true }).click();
  await page.getByRole('button', { name: '恢复演示数据', exact: true }).click();
  expect((await stored(page)).guides).toHaveLength(2);
  expect((await stored(page)).conversations).toHaveLength(4);
});

test('通用设置保存、取消和刷新恢复，忌口口味与多个锅具用于新指南', async ({ page }) => {
  await page.goto('/');
  await removeSeedChicken(page);
  await page.getByRole('button', { name: '通用设置' }).click();
  await page.getByLabel('忌口', { exact: true }).fill('花生过敏、蚕豆过敏、不吃小葱');
  await page.getByLabel('口味', { exact: true }).fill('不辣、不要太咸');
  await page.getByLabel('铁炒锅', { exact: true }).check();
  await page.getByLabel('带盖炖锅', { exact: true }).check();
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.reload();
  await page.getByRole('button', { name: '通用设置' }).click();
  await expect(page.getByLabel('忌口', { exact: true })).toHaveValue(
    '花生过敏、蚕豆过敏、不吃小葱',
  );
  await expect(page.getByLabel('铁炒锅', { exact: true })).toBeChecked();
  await expect(page.getByLabel('带盖炖锅', { exact: true })).toBeChecked();
  await page.getByLabel('忌口', { exact: true }).fill('鸡蛋过敏');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('宫保鸡丁');
  await selectSuggested(page, '宫保鸡丁');
  await expect(page).toHaveURL(/#cook$/);
  const guide = (await stored(page)).guides[0];
  expect(guide.conditions.allergies).toEqual(['花生', '蚕豆', '小葱']);
  expect(
    guide.recipe.ingredients.some((item: any) =>
      ['peanuts', 'scallion', 'chili', 'pepper'].includes(item.id),
    ),
  ).toBe(false);
  expect(guide.recipe.ingredients.find((item: any) => item.id === 'salt').quantity).toBe(0.7);
  expect(guide.conditions.cookwares).toEqual(['铁炒锅', '带盖炖锅']);
  await expect(page.locator('.tools-list')).toHaveCount(0);
});

test('指南直接进入准备卡片，内容顺序固定，不展示器具或成品检查', async ({ page }) => {
  await generateChicken(page);
  await expect(page).toHaveURL(/#cook$/);
  const active = page.locator('.step-card.active');
  await expect(active).toHaveClass(/preparation-card/);
  await expect(active.locator('h2')).toHaveText(['要点', '食材和调味辅料', '备菜']);
  await expect(active.locator('.preparation-key')).toContainText('花生最后放');
  await expect(active.getByRole('table', { name: '主要食材' })).toBeVisible();
  await expect(active.getByRole('table', { name: '调味与辅料' })).toBeVisible();
  await expect(active.locator('.guide-prep-item')).toHaveCount(4);
  await expect(page.locator('.step-card')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '成品检查' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '器具', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '步骤卡片', exact: true })).toHaveCount(0);
  await expect(page.locator('.cards-page img, .finish-page, .rating-row')).toHaveCount(0);
  await page.getByRole('button', { name: '完成：切鸡丁与配料', exact: true }).click();
  await page.getByRole('button', { name: '开始 10 分钟计时', exact: true }).click();
  await page.reload();
  await expect(page.locator('.step-card.active')).toHaveClass(/preparation-card/);
  await expect(page.getByRole('button', { name: '取消：切鸡丁与配料', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '问问 AI' }).click();
  await expect(page.getByRole('dialog')).toContainText('备菜阶段');
  await page.getByRole('button', { name: '锅里出水了', exact: true }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('现在先完成备菜');
  await expect(page.locator('.message.assistant').last()).not.toContainText('现在还在热锅阶段');
  await expect(page.getByRole('button', { name: '更新剩余步骤' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '跳转第 2 步' }).click();
  await page.getByRole('button', { name: '查看全部步骤' }).click();
  await page.locator('.full-prep').getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.locator('.step-card.active')).toHaveClass(/preparation-card/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('心得在问问 AI 左侧，可编辑保存、取消、清空，刷新与再次制作隔离', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('番茄炒蛋');
  await selectSuggested(page, '番茄炒蛋');
  const before = (await stored(page)).guides.find((g: any) => g.recipe.id === 'eggs');
  expect(await page.locator('.cards-header-actions > button').evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')),
  )).toEqual(['心得', '问问 AI', '查看厨房计时器']);
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue(before.note);
  await page.getByLabel('我的记录').fill('记'.repeat(2001));
  await expect(page.getByLabel('我的记录')).toHaveValue('记'.repeat(2000));
  await expect(page.locator('.notes-count')).toHaveText('2000 / 2000');
  await page.getByLabel('我的记录').fill('番茄多炒一会儿。\n下次少放盐。');
  await page.getByRole('button', { name: '保存心得' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '心得', exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue('番茄多炒一会儿。\n下次少放盐。');
  await page.getByLabel('我的记录').fill('不保存的修改');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue('番茄多炒一会儿。\n下次少放盐。');
  await page.getByLabel('我的记录').fill('Escape 不保存');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue('番茄多炒一会儿。\n下次少放盐。');
  await page.screenshot({ path: '.local/notes-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('我的记录').fill('');
  await page.getByRole('button', { name: '保存心得' }).click();
  expect((await stored(page)).guides.find((g: any) => g.id === before.id).note).toBe('');
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByLabel('我的记录').fill('保留在这次制作');
  await page.getByRole('button', { name: '保存心得' }).click();
  const after = (await stored(page)).guides.find((g: any) => g.id === before.id);
  expect({ ...after, note: before.note }).toEqual(before);
  await page.goto('/#library');
  await page.getByRole('button', { name: '指南数据管理' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出数据/ }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(backup.guides.find((g: any) => g.id === before.id).note).toBe('保留在这次制作');
  await page.keyboard.press('Escape');
  await page.locator('.guide-card').filter({ hasText: '番茄炒蛋' }).getByRole('button', { name: '再做一次', exact: true }).click();
  expect((await stored(page)).guides[0].note).toBe('');
  expect((await stored(page)).guides.find((g: any) => g.id === before.id).note).toBe('保留在这次制作');
});

test('旧检查路由与评分字段迁移，保留笔记和步骤', async ({ page }) => {
  await generateChicken(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    delete state.guides[0].currentCard;
    state.guides[0].currentStep = 2;
    state.guides[0].rating = 4;
    state.guides[0].recipe.signals = [{ title: '旧检查', detail: '旧内容' }];
    state.guides[0].note = '旧笔记';
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.goto('/#finish');
  await page.reload();
  await expect(page).toHaveURL(/#cook$/);
  await expect(page.locator('.current-step h1')).toHaveText('小火炒香配料');
  const migrated = (await stored(page)).guides[0];
  expect(migrated.currentCard).toBe(3);
  expect(migrated.currentStep).toBe(2);
  expect(migrated).not.toHaveProperty('rating');
  expect(migrated.recipe).not.toHaveProperty('signals');
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue('旧笔记');
  await page.keyboard.press('Escape');
  await page.goto('/#overview');
  await expect(page).toHaveURL(/#cook$/);
  await expect(page.locator('.finish-page')).toHaveCount(0);
});

test('步骤卡片触摸双向滑动、数字跳转、键盘切换、独立滚动与刷新恢复', async ({ page }) => {
  await generateChicken(page);
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(page.locator('.cards-progress, .cook-dock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '调整做法', exact: true })).toHaveCount(0);
  await expect(page.locator('.process-header').getByRole('button', { name: '问问 AI' })).toBeVisible();
  await expect(page.locator('.process-header').getByRole('button', { name: '查看厨房计时器' })).toBeVisible();
  const active = page.locator('.step-card.active');
  await expect(active.locator('h1')).toHaveText('热锅放油');
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y: 320 }],
    });
    for (let index = 1; index <= 12; index++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from + ((to - from) * index) / 12, y: 320 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(310, 75);
  await expect(active.locator('h1')).toHaveText('滑炒鸡丁');
  await swipe(75, 310);
  await expect(active.locator('h1')).toHaveText('热锅放油');
  await swipe(75, 310);
  await expect(active).toHaveClass(/preparation-card/);
  expect((await stored(page)).guides[0].currentCard).toBe(0);
  await swipe(310, 75);
  await expect(active.locator('h1')).toHaveText('热锅放油');
  await page.getByRole('button', { name: '跳转第 3 步' }).click();
  await expect(active.locator('h1')).toHaveText('小火炒香配料');
  expect((await stored(page)).guides[0].completed).toEqual([]);
  const box = await active.boundingBox();
  await page.mouse.move(box!.x + 140, box!.y + 150);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => active.locator('.step-card-scroll').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('.step-carousel').focus();
  await page.keyboard.press('ArrowRight');
  await expect(active.locator('h1')).toHaveText('鸡丁回锅调味');
  await page.reload();
  await expect(active.locator('h1')).toHaveText('鸡丁回锅调味');
  await expect(page.getByRole('button', { name: '跳转第 4 步' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  const layout = await page.evaluate(() => {
    const card = document.querySelector('.step-card.active')!.getBoundingClientRect();
    const previous = document.querySelectorAll('.step-card')[3].getBoundingClientRect();
    const next = document.querySelectorAll('.step-card')[5].getBoundingClientRect();
    const pagination = document.querySelector('.card-pagination')!.getBoundingClientRect();
    const header = document.querySelector('.process-header')!.getBoundingClientRect();
    const back = document.querySelector('.process-header > button')!.getBoundingClientRect();
    const title = document.querySelector('.process-header > span')!.getBoundingClientRect();
    return {
      previousVisible: previous.right > 0 && previous.right < card.left,
      nextVisible: next.left < innerWidth && next.left > card.right,
      paginationFits: pagination.bottom <= innerHeight + 1,
      cardHeight: card.height >= innerHeight - 150,
      titleByBack: title.left - back.right <= 4,
      cardBelowHeader: card.top >= header.bottom,
      pageFits: document.documentElement.scrollHeight <= innerHeight + 1,
    };
  });
  expect(layout).toEqual({
    previousVisible: true,
    nextVisible: true,
    paginationFits: true,
    cardHeight: true,
    titleByBack: true,
    cardBelowHeader: true,
    pageFits: true,
  });
  await cdp.detach();
});

test('卡片与心得在窄屏和大屏可用，操作按钮及数字栏不溢出', async ({ page }) => {
  await generateChicken(page);
  for (const width of [320, 390, 480, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.step-card.active')).toHaveClass(/preparation-card/);
    const layout = await page.evaluate(() => {
      const header = document.querySelector('.cards-header-actions')!.getBoundingClientRect();
      const title = document.querySelector('.process-header > span')!.getBoundingClientRect();
      const app = document.querySelector('.app')!.getBoundingClientRect();
      const navigation = document.querySelector('.card-pagination')!;
      return {
        pageFits: document.documentElement.scrollWidth <= innerWidth,
        headerFits: header.right <= app.right && title.right <= header.left,
        navigationFits: navigation.scrollWidth <= navigation.clientWidth,
      };
    });
    expect(layout).toEqual({ pageFits: true, headerFits: true, navigationFits: true });
    if (width <= 390)
      await page.screenshot({ path: `.local/guide-preparation-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '心得', exact: true }).click();
    await page.getByLabel('我的记录').fill('下次试试少放一点盐。');
    await expect(page.getByRole('button', { name: '保存心得' })).toBeInViewport();
    if (width <= 390)
      await page.screenshot({ path: `.local/guide-notes-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
  }
});

test('菜谱搜索筛选、新增世界家常菜可独立打开，过敏冲突不会生成', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '通用设置' }).click();
  await page.getByLabel('忌口', { exact: true }).fill('鸡蛋过敏');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '菜谱大全', exact: true }).click();
  await expect(page.locator('.catalog-recipe')).toHaveCount(6);
  await page.getByRole('button', { name: '番茄炒蛋', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('这道菜含鸡蛋');
  await expect(page).toHaveURL(/#library\/recipes$/);
  await page.getByRole('button', { name: '西式与日式', exact: true }).click();
  await expect(page.locator('.catalog-recipe')).toHaveCount(3);
  await page.getByRole('textbox', { name: '搜索菜谱' }).fill('咖喱');
  await expect(page.locator('.catalog-recipe')).toHaveCount(1);
  await page.getByRole('button', { name: '日式咖喱鸡', exact: true }).click();
  await expect(page.getByRole('heading', { name: '日式咖喱鸡', exact: true })).toBeVisible();
  await expect(page.locator('.step-card:not(.preparation-card)')).toHaveCount(3);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('tab', { name: /菜谱大全/ })).toHaveAttribute('aria-selected', 'true');
  await navigateMenu(page, '开始做菜');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('番茄罗勒意面');
  await selectSuggested(page, '番茄罗勒意面');
  await expect(page.getByRole('heading', { name: '番茄罗勒意面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('法式蘑菇煎蛋');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const blocked = page.locator('.recommendation').filter({ hasText: '法式蘑菇煎蛋' }).last();
  await expect(blocked).toContainText('这道菜含鸡蛋');
  await expect(blocked.getByRole('button')).toBeDisabled();
});

test('320px 到桌面保持手机布局，图片可用，弹窗键盘可关闭', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 390, 480, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await page.locator('.app').evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(480);
  }
  await expect
    .poll(async () =>
      page
        .locator('.home img')
        .evaluateAll((imgs) =>
          imgs.every(
            (img) =>
              (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await page.getByRole('button', { name: /DeepSeek/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { level: 1 }).click();
  await page.screenshot({ path: '.local/home-mobile.png', fullPage: true });
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: '我的厨房' })).toBeVisible();
});

for (const [dish, firstStep, steps] of [
  ['番茄炒蛋', '炒鸡蛋', 4],
  ['土豆炖牛肉', '冷水焯牛肉', 5],
] as const) {
  test(`${dish}独立指南可完整阅读并保存心得`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '菜谱大全', exact: true }).click();
    await page.getByRole('button', { name: dish, exact: true }).click();
    await expect(page.getByRole('heading', { name: dish, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
    await expect(page.locator('.current-step h1')).toHaveText(firstStep);
    for (let step = 0; step < steps; step++) {
      await expect(page.locator('.current-step .signal-card p')).not.toBeEmpty();
      await page
        .getByRole('button', {
          name: `跳转第 ${Math.min(step + 2, steps)} 步`,
          exact: true,
        })
        .click();
    }
    await page.getByRole('button', { name: '心得', exact: true }).click();
    await page.getByLabel('我的记录').fill(`${dish}第一次尝试成功。`);
    await page.getByRole('button', { name: '保存心得' }).click();
    const saved = (await stored(page)).guides[0];
    expect(saved.status).toBe('cooking');
    expect(saved.completed).toEqual([]);
    expect(saved.note).toContain(dish);
  });
}

test('旧指南标题更新，已调整做法、笔记和计时进度保留', async ({ page }) => {
  await generateChicken(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    const guide = state.guides[0];
    guide.recipe.prep[1].title = '给鸡丁一点腌制时间';
    guide.recipe.steps[0].title = '热锅，让油铺满锅底';
    guide.recipe.steps[0].action = '已调整：热锅后加入 15 ml 油。';
    guide.completed = ['heat'];
    guide.currentStep = 1;
    guide.version = 3;
    guide.note = '小火慢炖，把时间交给锅';
    state.timers = [
      {
        id: 'legacy-timer',
        guideId: guide.id,
        stepId: 'marinate',
        name: '给鸡丁一点腌制时间',
        total: 600,
        remaining: 183,
        endAt: null,
        notified: false,
      },
      {
        id: 'custom-timer',
        guideId: guide.id,
        stepId: 'custom',
        name: '给鸡丁一点腌制时间',
        total: 300,
        remaining: 90,
        endAt: null,
        notified: false,
      },
    ];
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '宫保鸡丁', exact: true })).toBeVisible();
  const restored = await stored(page);
  expect(restored.guides[0].recipe.prep[1].title).toBe('腌制鸡丁');
  expect(restored.guides[0].recipe.steps[0].title).toBe('热锅放油');
  expect(restored.guides[0].recipe.steps[0].action).toContain('已调整：');
  expect(restored.guides[0].completed).toEqual(['heat']);
  expect(restored.guides[0].currentStep).toBe(1);
  expect(restored.guides[0].version).toBe(3);
  expect(restored.guides[0].note).toBe('小火慢炖，把时间交给锅');
  expect(restored.timers[0]).toMatchObject({ name: '腌制鸡丁', remaining: 183, endAt: null });
  expect(restored.timers[1]).toMatchObject({
    name: '给鸡丁一点腌制时间',
    remaining: 90,
    endAt: null,
  });
});

test('单文件 Demo 离线打开，无外部请求，生成与刷新恢复可用', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('demo.html')).href);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('想做什么菜');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('想做日式咖喱鸡');
  await selectSuggested(page, '日式咖喱鸡');
  await expect(page.getByRole('heading', { name: '日式咖喱鸡', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByLabel('我的记录').fill('离线保存的心得');
  await page.getByRole('button', { name: '保存心得' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '日式咖喱鸡', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByLabel('我的记录')).toHaveValue('离线保存的心得');
  expect(externalRequests).toEqual([]);
});

test('食材输入先推荐，选中新菜谱才生成并自动入库，再次输入直接复用', async ({ page }) => {
  await page.goto('/');
  const before = await stored(page);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('鸡肉、土豆，450克鸡肉');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('正在理解');
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await expect(page).toHaveURL(/#home$/);
  expect((await stored(page)).guides).toEqual(before.guides);
  const curry = page.getByRole('button', { name: '生成菜谱：日式咖喱鸡', exact: true });
  await curry.click();
  await expect(curry).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('自动加入 AI 菜谱');
  await expect(page).toHaveURL(/#cook$/);
  const saved = (await stored(page)).guides[0];
  expect(saved.recipe.title).toBe('日式咖喱鸡');
  expect(saved.recipe.ingredients.find((i: any) => i.id === 'curry').quantity).toBe(450);
  expect(saved.source).toBe('ai');
  expect((await stored(page)).guides).toHaveLength(before.guides.length + 1);
  await page.reload();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await navigateMenu(page, '我的指南');
  await page.getByRole('textbox', { name: '搜索我的指南' }).fill('咖喱');
  await expect(page.locator('.guide-card')).toHaveCount(1);
  await navigateMenu(page, '开始做菜');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('想做咖喱鸡，600克鸡肉');
  await selectSuggested(page, '日式咖喱鸡');
  const reused = await stored(page);
  expect(reused.activeId).toBe(saved.id);
  expect(reused.guides[0]).toEqual(saved);
  expect(reused.guides).toHaveLength(before.guides.length + 1);
});

test('别名命中已有菜谱，复用不改变版本、完成记录、复盘和计时器', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
    const eggs = state.guides.find((g: any) => g.recipe.id === 'eggs');
    eggs.version = 3;
    eggs.changes = ['按个人口味减少糖'];
    state.timers.push({ id: 'keep-timer', guideId: eggs.id, stepId: 'custom', name: '准备米饭', total: 300, remaining: 180, endAt: null, notified: false });
    localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  const before = await stored(page);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('想做西红柿炒鸡蛋');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const card = page.locator('.recommendation').filter({ hasText: '番茄炒蛋' });
  await expect(card).toContainText('AI 菜谱 · 已有');
  await expect(card).toContainText('沿用 v3');
  await card.getByRole('button', { name: '使用已有菜谱：番茄炒蛋', exact: true }).click();
  await expect(page).toHaveURL(/#cook$/);
  const after = await stored(page);
  expect(after.guides).toEqual(before.guides);
  expect(after.timers).toEqual(before.timers);
  expect(after.activeId).toBe(before.guides[1].id);
});

test('模糊输入给几个选择，无关问题普通聊天后仍可输入做菜需求', async ({ page }) => {
  await page.goto('/');
  const before = await stored(page);
  for (const question of ['月亮为什么会发光？', '帮我写个网页界面']) {
    await page.getByRole('textbox', { name: '描述做菜需求' }).fill(question);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await expect(page.locator('.discovery-summary')).toHaveCount(question.includes('月亮') ? 1 : 2);
  }
  await expect(page.locator('.discovery-summary').first()).toContainText('太阳光');
  await expect(page.locator('.recommendation')).toHaveCount(0);
  expect((await stored(page)).guides).toEqual(before.guides);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('不知道今晚吃什么，想吃点快手的');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  expect((await stored(page)).guides).toEqual(before.guides);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/discovery-mobile.png', fullPage: true });
});

test('已有版本含当前忌口时禁止复用，不生成同名副本；离开生成不延迟入库', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '通用设置' }).click();
  await page.getByLabel('忌口', { exact: true }).fill('花生过敏');
  await page.getByRole('button', { name: '保存设置' }).click();
  const before = await stored(page);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('想做宫保鸡丁');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const card = page.locator('.recommendation').filter({ hasText: '宫保鸡丁' });
  await expect(card).toContainText('忌口冲突');
  await expect(card.getByRole('button')).toBeDisabled();
  expect((await stored(page)).guides).toEqual(before.guides);
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('日式咖喱鸡');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '生成菜谱：日式咖喱鸡', exact: true }).last().click();
  await navigateMenu(page, '我的指南');
  await page.waitForTimeout(1100);
  await expect(page).toHaveURL(/#library$/);
  expect((await stored(page)).guides).toEqual(before.guides);
});
