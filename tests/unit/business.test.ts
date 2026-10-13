import { describe, expect, it } from 'vitest';
import { db, setSetting } from '../../src/storage/db';
import {
  commitGeneration,
  createTask,
  cancelTask,
  cookAgain,
  deleteSession,
  exportData,
  newSession,
  openBuiltin,
  pruneHistory,
  saveModel,
  saveProposal,
  startTimer,
  toggleTimer,
} from '../../src/storage/repository';
import {
  applyPatch,
  effectivePreferences,
  identity,
  isExpired,
  renderAction,
  restrictionConflict,
  timerRemaining,
  validateContent,
  validateRequestedAmounts,
} from '../../src/domain/rules';
import { defaultPreferences, uid, type Candidate } from '../../src/domain/schema';
import { contentExample } from '../../src/services/ai/cooking';
import { endpoint } from '../../src/services/ai/client';
import { catalog } from '../../src/assets/recipes';

const model = {
  id: 'model',
  name: 'test',
  url: 'https://api.deepseek.com',
  model: 'deepseek-flash',
};
const candidate: Candidate = {
  name: '西红柿炒鸡蛋',
  aliases: [],
  minutes: 15,
  difficulty: '简单',
  summary: '简单家常菜',
  blocked: '',
};
const prefs = defaultPreferences();
const create = async () => {
  const task = await createTask('generate', 'conversation', model);
  const session = await commitGeneration(
    task.id,
    structuredClone(contentExample),
    candidate,
    prefs,
  );
  return { task, session };
};

describe('正式数据不变量', () => {
  it('同一任务提交两次只保存一个菜谱、版本和制作记录', async () => {
    const { task, session } = await create();
    expect((await commitGeneration(task.id, contentExample, candidate, prefs)).id).toBe(session.id);
    expect(await db.recipes.count()).toBe(1);
    expect(await db.versions.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
  });
  it('两个任务并发按已知别名查重，不信任模型别名合并', async () => {
    const tasks = await Promise.all([
      createTask('generate', 'c1', model),
      createTask('generate', 'c2', model),
    ]);
    const results = await Promise.all(
      tasks.map((task, i) =>
        commitGeneration(
          task.id,
          { ...contentExample, title: i ? '番茄炒蛋' : contentExample.title },
          { ...candidate, name: i ? '番茄炒蛋' : candidate.name },
          prefs,
        ),
      ),
    );
    expect(results[0].id).toBe(results[1].id);
    expect(await db.recipes.count()).toBe(1);
    expect(identity('西红柿炒鸡蛋')).toBe(identity('番茄炒蛋'));
    expect(identity('番茄鸡蛋汤')).not.toBe(identity('番茄炒蛋'));
  });
  it('取消后禁止旧结果入库', async () => {
    const task = await createTask('generate', 'c', model);
    await cancelTask(task.id);
    await expect(commitGeneration(task.id, contentExample, candidate, prefs)).rejects.toThrow(
      '已取消',
    );
    expect(await db.recipes.count()).toBe(0);
  });
  it('保存中途出错原子回滚，并允许使用原生成结果重试', async () => {
    const task = await createTask('generate', 'c', model);
    const fail = () => {
      throw new Error('磁盘已满');
    };
    db.sessions.hook('creating', fail);
    try {
      await expect(commitGeneration(task.id, contentExample, candidate, prefs)).rejects.toThrow(
        '磁盘已满',
      );
    } finally {
      db.sessions.hook('creating').unsubscribe(fail);
    }
    expect(await db.recipes.count()).toBe(0);
    expect(await db.versions.count()).toBe(0);
    expect((await db.tasks.get(task.id))?.status).toBe('pending');
    await commitGeneration(task.id, contentExample, candidate, prefs);
    expect(await db.sessions.count()).toBe(1);
  });
  it('再次制作沿用版本，心得备菜进度和计时独立', async () => {
    const { session } = await create();
    await db.sessions.update(session.id, { note: '多炒一会', checked: ['cut'], currentCard: 2 });
    await startTimer(session.id, 'step', 'eggs', '炒蛋', 60);
    const next = await cookAgain(session.id);
    expect(next.versionId).toBe(session.versionId);
    expect(next.note).toBe('');
    expect(next.checked).toEqual([]);
    expect(next.execution).toEqual([]);
    expect(await db.timers.where('sessionId').equals(next.id).count()).toBe(0);
    expect((await db.sessions.get(session.id))?.note).toBe('多炒一会');
  });
  it('翻卡、计时到点、心得不会写入执行状态', async () => {
    const { session } = await create();
    await db.sessions.update(session.id, { currentCard: 2, note: '好吃' });
    await startTimer(session.id, 'step', 'eggs', '炒蛋', 1);
    expect((await db.sessions.get(session.id))?.execution).toEqual([]);
    expect((await db.sessions.get(session.id))?.progressKnown).toBe(false);
  });
  it('删除一个记录保留其他引用；最后一个引用删除才回收版本链', async () => {
    const { session } = await create();
    const next = await cookAgain(session.id);
    await startTimer(session.id, 'step', 'eggs', '炒蛋', 60);
    await db.cookingMessages.add({
      id: uid(),
      sessionId: session.id,
      role: 'user',
      text: '测试',
      createdAt: Date.now(),
    });
    await deleteSession(session.id);
    expect(await db.versions.count()).toBe(1);
    expect(await db.timers.count()).toBe(0);
    expect(await db.cookingMessages.count()).toBe(0);
    expect(await db.sessions.get(next.id)).toBeDefined();
    await deleteSession(next.id);
    expect(await db.recipes.count()).toBe(0);
    expect(await db.versions.count()).toBe(0);
  });
  it('确认调整建立新版本，只更新本次制作，重复确认不可二次应用', async () => {
    const { session } = await create();
    const other = await cookAgain(session.id);
    await db.sessions.update(session.id, { progressKnown: true });
    const messageId = uid();
    await db.cookingMessages.add({
      id: messageId,
      sessionId: session.id,
      role: 'assistant',
      text: '少盐',
      createdAt: Date.now(),
      baseVersionId: session.versionId,
      baseRevision: 0,
      proposalStatus: 'pending',
      answer: {
        text: '少盐',
        confirmations: [],
        proposal: {
          explanation: '盐减半',
          ingredients: [{ ...contentExample.ingredients[3], quantity: 1 }],
          prep: [],
          steps: [],
        },
      },
    });
    await saveProposal(messageId);
    const current = await db.sessions.get(session.id);
    expect(current?.versionId).not.toBe(session.versionId);
    expect((await db.sessions.get(other.id))?.versionId).toBe(session.versionId);
    expect((await db.versions.get(session.versionId))?.content.ingredients[3].quantity).toBe(2);
    expect(await db.versions.count()).toBe(2);
    await expect(saveProposal(messageId)).rejects.toThrow('已处理');
  });
  it('等待期间实际进度改变，旧提案不能应用', async () => {
    const { session } = await create();
    await db.sessions.update(session.id, { revision: 1, progressKnown: true });
    const id = uid();
    await db.cookingMessages.add({
      id,
      sessionId: session.id,
      role: 'assistant',
      text: '建议',
      createdAt: Date.now(),
      baseVersionId: session.versionId,
      baseRevision: 0,
      proposalStatus: 'pending',
      answer: {
        text: '建议',
        confirmations: [],
        proposal: { explanation: '修改', steps: [], prep: [], ingredients: [] },
      },
    });
    await expect(saveProposal(id)).rejects.toThrow('已经改变');
    expect(await db.versions.count()).toBe(1);
  });
  it('预置不进入AI来源，反复打开复用快照，制作记录独立', async () => {
    await openBuiltin(catalog[0], prefs);
    await openBuiltin(catalog[0], prefs);
    expect(await db.versions.count()).toBe(1);
    expect(await db.sessions.count()).toBe(2);
    expect(await db.recipes.where('source').equals('ai').count()).toBe(0);
  });
  it('计时目标区分备菜和步骤，同一目标误触不重复启动', async () => {
    const { session } = await create();
    const a = await startTimer(session.id, 'prep', 'same', '准备', 60);
    const b = await startTimer(session.id, 'step', 'same', '烹饪', 60);
    expect(a).not.toBe(b);
    expect(await startTimer(session.id, 'prep', 'same', '准备', 60)).toBe(a);
    expect(await db.timers.count()).toBe(2);
  });
  it('计时通过截止时间恢复，暂停冻结剩余时长', async () => {
    const { session } = await create();
    const id = await startTimer(session.id, 'step', 'eggs', '炒蛋', 60);
    const timer = (await db.timers.get(id))!;
    expect(timerRemaining(timer, timer.deadline! - 12500)).toBe(13);
    expect(timerRemaining(timer, timer.deadline! + 500)).toBe(0);
    await toggleTimer(id);
    const paused = (await db.timers.get(id))!;
    expect(paused.deadline).toBe(null);
    expect(timerRemaining(paused, Date.now() + 500000)).toBe(paused.remaining);
    await toggleTimer(id);
    expect((await db.timers.get(id))?.deadline).toBeGreaterThan(Date.now());
  });
  it('恰好30天保留，超过一毫秒清理；查看不续期', async () => {
    const time = Date.now();
    const exact = time - 30 * 86400000;
    expect(isExpired(exact, time)).toBe(false);
    await db.conversations.bulkAdd([
      { id: 'keep', title: '保留', createdAt: exact, lastSentAt: exact, messages: [] },
      { id: 'remove', title: '清理', createdAt: exact - 1, lastSentAt: exact - 1, messages: [] },
    ]);
    await setSetting('activeConversationId', 'remove');
    await pruneHistory(time);
    expect(await db.conversations.get('keep')).toBeDefined();
    expect(await db.conversations.get('remove')).toBeUndefined();
  });
  it('导出剔除凭据与任务，包含心得和脱敏模型', async () => {
    const { session } = await create();
    await db.sessions.update(session.id, { note: '私房做法' });
    await saveModel(model, 'private-test-secret');
    const output = await exportData();
    expect(output).not.toContain('private-test-secret');
    expect(output).toContain('私房做法');
    expect(JSON.parse(output).credentials).toBeUndefined();
    expect(JSON.parse(output).tasks).toBeUndefined();
    expect(JSON.parse(output).models[0].key).toBe('[已隐藏]');
  });
});

describe('模型内容与本地资料', () => {
  it('严格校验完整用量，备菜和下锅不能重复消费调味', () => {
    expect(validateContent(contentExample)).toEqual(contentExample);
    const broken = structuredClone(contentExample);
    broken.steps[1].uses.find((u) => u.ingredientId === 'salt')!.fraction = 1;
    expect(() => validateContent(broken)).toThrow('用量分配');
  });
  it('拒绝不存在引用、先后依赖错误和硬编码用量', () => {
    const content = structuredClone(contentExample);
    content.steps[0].dependsOn = ['finish'];
    expect(() => validateContent(content)).toThrow('依赖');
    content.steps[0].dependsOn = [];
    content.steps[0].action += '加10ml油';
    expect(() => validateContent(content)).toThrow('硬编码');
  });
  it('数字只从统一来源渲染，调整数量后文字与表格一致', () => {
    const content = structuredClone(contentExample);
    content.ingredients[2].quantity = 30;
    expect(renderAction(content, content.steps[0])).toContain('20ml');
  });
  it('校验用户明确的主料数量和单位，后来明确的数量优先', () => {
    expect(validateRequestedAmounts(contentExample, '400克西红柿，鸡蛋3个')).toEqual(
      contentExample,
    );
    expect(validateRequestedAmounts(contentExample, '先说番茄200g，改为番茄400g')).toEqual(
      contentExample,
    );
    expect(() => validateRequestedAmounts(contentExample, '番茄800g，鸡蛋3个')).toThrow('明确用量');
  });
  it('所有必需锅具都要满足，不能只匹配其中一个', () => {
    const content = { ...contentExample, cookware: ['炒锅', '烤箱'] };
    expect(() => validateContent(content, { ...prefs, cookware: ['炒锅'] })).toThrow('锅具');
  });
  it('保护已经执行的内容和已用材料', () => {
    const session = newSession('r', 'v');
    session.execution = [{ targetType: 'prep', targetId: 'cut', confirmedAt: Date.now() }];
    expect(() =>
      applyPatch(
        contentExample,
        {
          explanation: '改盐',
          steps: [],
          prep: [],
          ingredients: [{ ...contentExample.ingredients[3], quantity: 1 }],
        },
        session,
      ),
    ).toThrow('已经使用');
    expect(() =>
      applyPatch(
        contentExample,
        {
          explanation: '改备菜',
          steps: [],
          ingredients: [],
          prep: [{ ...contentExample.prep[0], action: '重新处理' }],
        },
        session,
      ),
    ).toThrow('已明确执行');
  });
  it('忌口检查包括常见同类材料', () => {
    const content = structuredClone(contentExample);
    content.ingredients[2].name = '花生油';
    expect(restrictionConflict(content, { ...prefs, avoidances: '花生过敏' })).toContain('花生油');
    expect(() => validateContent(content, { ...prefs, avoidances: '花生过敏' })).toThrow(
      '忌口冲突',
    );
  });
  it('本次明确忌口与通用过敏限制合并，不能由模型绕过', () => {
    const merged = effectivePreferences(
      { ...prefs, avoidances: '花生过敏' },
      '我对鸡蛋过敏，不放辣椒',
    );
    expect(merged.avoidances).toContain('花生');
    expect(restrictionConflict(contentExample, merged)).toContain('鸡蛋');
  });
  it('兼容根路径、v1与完整chat端点', () => {
    expect(endpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions');
    expect(endpoint('https://example.com/v1')).toBe('https://example.com/v1/chat/completions');
    expect(endpoint('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    );
  });
  it('200道资料ID、引用与结构完整，来源和原文均保留', () => {
    expect(catalog).toHaveLength(200);
    for (const recipe of catalog) {
      expect(() => validateContent(recipe.content, undefined, false), recipe.id).not.toThrow();
      expect(recipe.sourceUrl).toMatch(/^https:\/\//);
      expect(recipe.sourceText).toContain('食材与调料');
    }
  });
});
