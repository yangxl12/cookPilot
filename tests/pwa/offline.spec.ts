import { test, expect } from '@playwright/test';
import realRecommendation from '../fixtures/deepseek-flash-recommendation.json' with { type: 'json' };

test('正式构建使用最新 DeepSeek 快速配置，原始辣椒炒牛肉响应显示三道候选并持久保存', async ({
  page,
}) => {
  let requests = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    await route.fulfill({ json: realRecommendation });
  });
  await page.goto('./#settings');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  const presets = page.getByRole('combobox', { name: '快速配置' });
  await expect(presets).toHaveValue('deepseek-flash');
  await presets.selectOption('deepseek-v4-pro');
  await expect(page.getByRole('textbox', { name: '模型名称' })).toHaveValue('deepseek-v4-pro');
  await expect(page.getByRole('textbox', { name: '配置名称' })).toHaveValue('DeepSeek V4 Pro');
  await presets.selectOption('deepseek-flash');
  await page.locator('input[aria-label="API Key"]').fill('test-key-no-real-requests');
  await page.getByRole('button', { name: '保存模型' }).click();
  await expect(page.getByRole('button', { name: '使用DeepSeek Flash' })).toBeVisible();
  await page.goto('./#home');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('辣椒炒牛肉');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '辣椒炒牛肉', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '青椒牛肉丝', exact: true })).toBeVisible();
  await expect(page.locator('.recommendation').filter({ hasText: '杭椒牛柳' })).toContainText(
    '适中',
  );
  await page.reload();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await expect(page.locator('.recommendation').filter({ hasText: '杭椒牛柳' })).toContainText(
    '适中',
  );
  expect(requests).toBe(1);
});

test('正式构建无私密配置入口；离线恢复指南、心得、计时与预置内容', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '想做什么菜？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择模型' })).toBeVisible();
  const body = await (
    await page.request.get('./__local-model', { headers: { 'X-CookPilot-Local': '1' } })
  ).text();
  expect(body).not.toContain('deepseek-flash');
  expect(body).not.toContain('"key"');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto('./#recipes');
  await page.getByRole('textbox', { name: '搜索菜名' }).fill('西红柿炒鸡蛋');
  await page.getByRole('button', { name: /西红柿炒鸡蛋 中式/ }).click();
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await page.getByRole('textbox', { name: '心得内容' }).fill('离线也保留');
  await page.getByRole('button', { name: '保存心得' }).click();
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await page.getByRole('textbox', { name: '计时名称' }).fill('离线计时');
  await page.getByRole('button', { name: '添加并开始' }).click();
  await page.getByRole('button', { name: '暂停离线计时' }).click();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '跳转第 1 步', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.getByRole('button', { name: '心得', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '心得内容' })).toHaveValue('离线也保留');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await expect(page.getByText('已暂停', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.goto('./#recipes');
  await expect(page.getByText('200 道家常菜')).toBeVisible();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api.deepseek.com')) requests.push(request.url());
  });
  await page.goto('./#home');
  await page.getByRole('textbox', { name: '描述做菜需求' }).fill('做饭');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('heading', { name: '我的厨房' })).toBeVisible();
  expect(requests).toHaveLength(0);
});
