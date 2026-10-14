import { expect, it, vi } from 'vitest';
import { db, setSetting, setting } from '../../src/storage/db';
import { initialize, pageOwner, pruneHistory } from '../../src/storage/repository';

it('历史清理保持30天边界，只删除过期记录且空清理不写入', async () => {
  const now = Date.now();
  const boundary = now - 30 * 86400000;
  await db.conversations.bulkPut([
    { id: 'old', title: '过期', createdAt: boundary - 1, lastSentAt: boundary - 1, messages: [] },
    { id: 'boundary', title: '保留', createdAt: boundary, lastSentAt: boundary, messages: [] },
    { id: 'recent', title: '最新', createdAt: now, lastSentAt: now, messages: [] },
  ]);
  await setSetting('activeConversationId', 'old');
  await pruneHistory(now);
  expect(await db.conversations.toCollection().primaryKeys()).toEqual(['boundary', 'recent']);
  expect(await setting('activeConversationId', 'fallback')).toBe('fallback');
  const deleteSpy = vi.spyOn(db.conversations, 'bulkDelete');
  const putSpy = vi.spyOn(db.settings, 'put');
  try {
    await pruneHistory(now);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  } finally {
    deleteSpy.mockRestore();
    putSpy.mockRestore();
  }
});

it('启动不重写已完成对话，并清理废弃租约、保留活跃请求', async () => {
  const now = Date.now();
  await setSetting('localBootstrapDisabled', true);
  await setSetting('lease:stale', now - 60000);
  await setSetting('lease:live', now);
  await setSetting('lease:invalid', 'invalid');
  const model = { id: 'test', name: 'test', model: 'test', url: 'https://example.com' };
  await db.tasks.bulkPut([
    {
      id: 'stale-task',
      kind: 'recommend',
      contextId: 'stale-chat',
      status: 'pending',
      owner: 'stale',
      model,
      createdAt: now,
    },
    {
      id: 'live-task',
      kind: 'recommend',
      contextId: 'live-chat',
      status: 'pending',
      owner: 'live',
      model,
      createdAt: now,
    },
  ]);
  await db.conversations.bulkPut([
    { id: 'finished', title: '已完成', createdAt: now, lastSentAt: now, messages: [] },
    ...['stale', 'live'].map((owner) => ({
      id: `${owner}-chat`,
      title: owner,
      createdAt: now,
      lastSentAt: now,
      messages: [
        {
          id: owner,
          taskId: `${owner}-task`,
          role: 'assistant' as const,
          text: '等待中',
          status: 'pending' as const,
          createdAt: now,
        },
      ],
    })),
    {
      id: 'orphan',
      title: '孤立消息',
      createdAt: now,
      lastSentAt: now,
      messages: [
        { id: 'orphan', role: 'assistant', text: '等待中', status: 'pending', createdAt: now },
      ],
    },
  ]);
  const updated: string[] = [];
  const onUpdate = (_changes: unknown, id: unknown) => {
    updated.push(String(id));
  };
  db.conversations.hook('updating', onUpdate);
  try {
    await initialize();
    expect(updated).not.toContain('finished');
    expect(updated).not.toContain('live-chat');
    expect((await db.tasks.get('stale-task'))?.status).toBe('interrupted');
    expect((await db.tasks.get('live-task'))?.status).toBe('pending');
    expect((await db.conversations.get('orphan'))?.messages[0].status).toBe('interrupted');
    expect(await db.settings.get('lease:stale')).toBeUndefined();
    expect(await db.settings.get('lease:invalid')).toBeUndefined();
    expect((await db.settings.get('lease:live'))?.value).toBe(now);
    expect((await db.settings.get(`lease:${pageOwner}`))?.value).toBeGreaterThanOrEqual(now);
  } finally {
    db.conversations.hook('updating').unsubscribe(onUpdate);
  }
});
