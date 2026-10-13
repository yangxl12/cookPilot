import { expect, it } from 'vitest';
import { db, setting } from '../../src/storage/db';
import { migrateLegacy } from '../../src/storage/migration';
import { contentExample } from '../../src/services/ai/cooking';
import { clearData } from '../../src/storage/repository';
import { renderAction } from '../../src/domain/rules';

function legacy() {
  const date = new Date().toISOString();
  const content = contentExample;
  return {
    activeId: 'old-session',
    activeConversationId: 'old-chat',
    modelId: 'old-model',
    guides: [
      {
        id: 'old-session',
        source: 'ai',
        version: 3,
        createdAt: date,
        checked: ['cut'],
        completed: ['eggs'],
        currentCard: 2,
        currentStep: 1,
        note: '原文心得\n不能改写',
        changes: ['盐少一点'],
        conditions: { servings: 2 },
        recipe: {
          id: 'eggs',
          title: content.title,
          minutes: 15,
          level: '简单',
          key: '先炒蛋',
          tools: ['炒锅'],
          ingredients: content.ingredients.map((i) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            group: i.group,
          })),
          prep: content.prep.map((p) => ({
            id: p.id,
            title: p.title,
            detail: renderAction(content, p),
            uses: p.uses.map((u) => u.ingredientId),
            seconds: p.seconds,
          })),
          steps: content.steps.map((s) => ({
            ...s,
            action: renderAction(content, s),
            uses: s.uses.map((u) => u.ingredientId),
          })),
        },
      },
    ],
    timers: [
      {
        id: 'old-timer',
        guideId: 'old-session',
        stepId: 'eggs',
        name: '炒蛋',
        total: 60,
        remaining: 30,
        endAt: null,
        notified: false,
      },
    ],
    models: [
      {
        id: 'old-model',
        name: '旧模型',
        url: 'https://api.deepseek.com/v1',
        key: 'old-private-key',
        model: 'deepseek-flash',
      },
    ],
    conversations: [
      {
        id: 'old-chat',
        title: '旧对话',
        createdAt: date,
        updatedAt: date,
        turns: [
          {
            id: 'turn',
            prompt: '怎么做番茄炒蛋',
            result: {
              kind: 'recipes',
              text: '先选一道菜',
              candidates: [{ recipe: { title: '西红柿炒鸡蛋', minutes: 15, level: '简单' } }],
            },
          },
        ],
      },
    ],
  };
}
it('迁移旧指南、心得、备菜、执行与计时ID、对话和凭据；保留原文备份', async () => {
  const input = JSON.stringify(legacy());
  localStorage.setItem('cookpilot.demo.v1', input);
  await migrateLegacy();
  expect(localStorage.getItem('cookpilot.legacy.backup')).toBe(input);
  const session = (await db.sessions.get('old-session'))!;
  expect(session.note).toBe('原文心得\n不能改写');
  expect(session.currentCard).toBe(2);
  expect(session.checked).toEqual(['cut']);
  expect(session.execution[0].targetId).toBe('eggs');
  expect((await db.versions.get(session.versionId))?.number).toBe(3);
  expect((await db.timers.get('old-timer'))?.targetId).toBe('eggs');
  expect((await db.timers.get('old-timer'))?.status).toBe('paused');
  expect((await db.conversations.get('old-chat'))?.messages[1].candidates?.[0].name).toBe(
    '西红柿炒鸡蛋',
  );
  expect(await setting('activeConversationId', '')).toBe('old-chat');
  expect((await db.credentials.toArray())[0].key).toBe('old-private-key');
  await migrateLegacy();
  expect(await db.sessions.count()).toBe(1);
});
it('迁移失败回滚全部新实体，原数据和备份原封保留', async () => {
  const value = legacy();
  value.timers[0].guideId = 'missing-session';
  const input = JSON.stringify(value);
  localStorage.setItem('cookpilot.demo.v1', input);
  await expect(migrateLegacy()).rejects.toThrow('迁移已回滚');
  expect(await db.sessions.count()).toBe(0);
  expect(await db.recipes.count()).toBe(0);
  expect(await db.versions.count()).toBe(0);
  expect(localStorage.getItem('cookpilot.demo.v1')).toBe(input);
  expect(localStorage.getItem('cookpilot.legacy.backup')).toBe(input);
});
it('清空本机数据也删除含敏感信息的旧数据备份，刷新不重新迁移', async () => {
  localStorage.setItem('cookpilot.demo.v1', JSON.stringify(legacy()));
  await migrateLegacy();
  await clearData();
  await migrateLegacy();
  expect(await db.sessions.count()).toBe(0);
  expect(await db.credentials.count()).toBe(0);
  expect(localStorage.getItem('cookpilot.legacy.backup')).toBe(null);
  expect(await setting('localBootstrapDisabled', false)).toBe(true);
});
it('旧 Demo 中的官方 deepseek-chat 不迁入正式版，其他数据正常迁移', async () => {
  const value = legacy();
  value.models[0].model = 'deepseek-chat';
  localStorage.setItem('cookpilot.demo.v1', JSON.stringify(value));
  await migrateLegacy();
  expect(await db.models.count()).toBe(0);
  expect(await db.credentials.count()).toBe(0);
  expect(await db.sessions.count()).toBe(1);
  expect(await setting('legacyMigrated', false)).toBe(true);
});
