import { test, expect } from '@playwright/test';

for (const viewport of [
  { width: 320, height: 480 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test(`页面标题固定且只有一个纵向滚动区域 ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const center = await page.locator('.home-center').boundingBox();
    const header = await page.locator('.home-header').boundingBox();
    expect(center!.y - header!.height).toBe(20);

    // Give every page enough real content to exercise scrolling.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('cookpilot.demo.v1')!);
      state.guides = Array.from({ length: 24 }, (_, i) => ({
        ...state.guides[0], id: `layout-guide-${i}`, source: 'ai',
      }));
      state.activeId = state.guides[0].id;
      state.models = Array.from({ length: 12 }, (_, i) => ({
        ...state.models[0], id: `layout-model-${i}`,
      }));
      const conversation = state.conversations[0];
      conversation.turns = Array.from({ length: 12 }, (_, i) => ({
        id: `layout-turn-${i}`, prompt: '今天想做一道家常菜',
        result: { kind: 'chat', text: '可以试试番茄炒蛋，备好食材后先炒鸡蛋，再炒番茄。'.repeat(8) },
      }));
      state.activeConversationId = conversation.id;
      localStorage.setItem('cookpilot.demo.v1', JSON.stringify(state));
    });

    for (const route of ['home', 'ai-recipes', 'recipes', 'settings', 'cook']) {
      await page.goto(`/#${route}`);
      await page.reload();
      if (route === 'recipes') {
        await page.locator('.catalog-recipe').first().evaluate((element) => {
          for (let i = 0; i < 18; i++) element.parentElement!.append(element.cloneNode(true));
        });
      }
      const title = page.locator(route === 'home' ? '.home-header' : route === 'cook' ? '.process-header' : '.root-header');
      if (route === 'cook') {
        await page.locator('.step-card.active .step-card-scroll').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      } else {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }
      expect((await title.boundingBox())!.y).toBe(0);
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const nested = Array.from(document.querySelectorAll<HTMLElement>('.app-content *')).filter((element) => {
          if (element.closest('[aria-hidden="true"]') || element.matches('textarea')) return false;
          const style = getComputedStyle(element);
          return /^(auto|scroll)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        });
        return {
          horizontalOverflow: root.scrollWidth > innerWidth,
          documentScrolls: root.scrollHeight > innerHeight + 1,
          nestedScrollers: nested.map((element) => element.className),
        };
      });
      expect(layout.horizontalOverflow, route).toBe(false);
      expect(layout.documentScrolls, route).toBe(route !== 'cook');
      expect(layout.nestedScrollers, route).toEqual(route === 'cook' ? ['step-card-scroll'] : []);
    }

    // A long dialog must scroll its content while the page underneath stays locked.
    await page.getByRole('button', { name: '查看全部步骤' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    const sheetTitle = await dialog.locator('.sheet-header').boundingBox();
    await dialog.locator('.sheet-content').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect((await dialog.locator('.sheet-header').boundingBox())!.y).toBe(sheetTitle!.y);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}
