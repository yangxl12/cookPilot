import { expect, it } from 'vitest';
import { db, setSetting, setting } from '../../src/storage/db';
import { saveModel, updateDeepSeekModels } from '../../src/storage/repository';

const flash = {
  id: 'flash',
  name: 'DeepSeek Flash',
  url: 'https://api.deepseek.com',
  model: 'deepseek-flash',
};

it('清理已保存的官方旧模型与凭据，切换当前配置，保留第三方与菜谱数据', async () => {
  const retired = { ...flash, id: 'retired', model: 'deepseek-chat' };
  const reasoner = { ...flash, id: 'reasoner', model: 'deepseek-reasoner' };
  const custom = { ...retired, id: 'custom', url: 'https://example.com/v1' };
  await db.models.bulkPut([flash, retired, reasoner, custom]);
  await db.credentials.bulkPut([
    { modelId: flash.id, key: 'flash-private' },
    { modelId: retired.id, key: 'retired-private' },
    { modelId: reasoner.id, key: 'reasoner-private' },
    { modelId: custom.id, key: 'custom-private' },
  ]);
  await setSetting('activeModelId', retired.id);
  await setSetting('preferences', { taste: '清淡' });
  await db.conversations.put({
    id: 'chat',
    title: '原对话',
    createdAt: Date.now(),
    lastSentAt: Date.now(),
    messages: [],
  });
  await updateDeepSeekModels();
  expect((await db.models.toArray()).map((m) => m.id).sort()).toEqual(['custom', 'flash']);
  expect((await db.credentials.toArray()).map((c) => c.modelId).sort()).toEqual([
    'custom',
    'flash',
  ]);
  expect(await setting('activeModelId', '')).not.toBe(retired.id);
  expect(await db.models.get(await setting('activeModelId', ''))).toBeDefined();
  expect(await setting('preferences', {})).toEqual({ taste: '清淡' });
  expect(await db.conversations.count()).toBe(1);
  await updateDeepSeekModels();
  expect(await db.models.count()).toBe(2);
});

it('只剩停用模型时清空选中项，不自动补回配置', async () => {
  await db.models.put({ ...flash, model: 'deepseek-chat' });
  await setSetting('activeModelId', flash.id);
  await updateDeepSeekModels();
  expect(await db.models.count()).toBe(0);
  expect(await setting('activeModelId', 'missing')).toBe('');
});

it('旧 Flash 别名规范为最新名称并保留配置 ID、名称与 Key', async () => {
  await db.models.put({ ...flash, model: 'deepseek-v4-flash' });
  await db.credentials.put({ modelId: flash.id, key: 'private-key' });
  await updateDeepSeekModels();
  expect(await db.models.get(flash.id)).toEqual(flash);
  expect((await db.credentials.get(flash.id))?.key).toBe('private-key');
  await saveModel({ ...flash, model: 'deepseek-v4-flash-vision-exp' }, 'new-private-key');
  expect(await db.models.get(flash.id)).toEqual(flash);
});

it('禁止保存官方停用模型，第三方同名配置仍可保存', async () => {
  await expect(saveModel({ ...flash, model: 'deepseek-chat' }, 'key')).rejects.toThrow('已停用');
  expect(await db.models.count()).toBe(0);
  await saveModel({ ...flash, url: 'https://example.com/v1', model: 'deepseek-chat' }, 'key');
  expect(await db.models.count()).toBe(1);
});
