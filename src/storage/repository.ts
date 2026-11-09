import { migrateConversation, updateMessage, messageTables } from './messages';
import Dexie from 'dexie';
import { addVersion } from './recipeList';
import { conversationTables } from './searchIndex';
import { db, setting, setSetting } from './db';
import {
  isRetiredDeepSeek,
  normalizeModelConfig,
  retiredModelMessage,
} from '../services/ai/providers';
import {
  uid,
  defaultPreferences,
  type Recipe,
  type RecipeVersion,
  type CookingSession,
  type Content,
  type Candidate,
  type Preferences,
  type ModelConfig,
  type Task,
  type Timer,
  type BuiltinRecipe,
  type CookingMessage,
} from '../domain/schema';
import {
  identity,
  validateContent,
  applyPatch,
  restrictionConflict,
  timerRemaining,
} from '../domain/rules';

export const pageOwner = uid();
const previousReloadOwner =
  typeof sessionStorage !== 'undefined' &&
  typeof performance !== 'undefined' &&
  (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
    ?.type === 'reload'
    ? sessionStorage.getItem('cookpilot-owner')
    : null;
export const newSession = (
  recipeId: string,
  versionId: string,
  source: Recipe['source'] = 'ai',
): CookingSession => ({
  id: uid(),
  recipeId,
  versionId,
  source,
  checked: [],
  currentCard: 0,
  execution: [],
  progressKnown: false,
  revision: 0,
  note: '',
  createdAt: Date.now(),
});
export function latestVersion(recipeId: string) {
  return db.versions
    .where('[recipeId+number]')
    .between([recipeId, Dexie.minKey], [recipeId, Dexie.maxKey])
    .last();
}
export async function findExisting(
  name: string,
): Promise<{ recipe: Recipe; version: RecipeVersion; session?: CookingSession } | undefined> {
  // Only application-maintained known aliases identify a dish. Model-proposed aliases never merge entities.
  const exact = await db.recipes
    .where('[source+identity]')
    .equals(['ai', identity(name)])
    .first();
  const recipe =
    exact ??
    (await db.recipes
      .where('nameKeys')
      .equals(identity(name))
      .filter((r) => r.source === 'ai')
      .first());
  if (!recipe) return;
  const version = await latestVersion(recipe.id);
  if (!version) return;
  const session = await db.sessions
    .where('[versionId+createdAt+id]')
    .between([version.id, Dexie.minKey], [version.id, Dexie.maxKey])
    .last();
  return { recipe, version, session };
}
export async function reuseRecipe(
  name: string,
  preferences: Preferences,
): Promise<CookingSession | undefined> {
  return db.transaction(
    'rw',
    [db.recipes, db.versions, db.versionSummaries, db.versionSearch, db.sessions],
    async () => {
      const existing = await findExisting(name);
      if (!existing) return;
      const conflict = restrictionConflict(existing.version.content, preferences);
      if (conflict) throw new Error(conflict);
      const session = existing.session ?? newSession(existing.recipe.id, existing.version.id);
      await db.sessions.put({ ...session, currentCard: 0 });
      return { ...session, currentCard: 0 };
    },
  );
}
export async function commitGeneration(
  taskId: string,
  input: Content,
  candidate: Candidate,
  preferences: Preferences,
): Promise<CookingSession> {
  const content = validateContent(input, preferences);
  if (identity(content.title) !== identity(candidate.name))
    throw new Error('生成的菜名与所选菜品不一致，请重试');
  return db.transaction(
    'rw',
    [db.tasks, db.recipes, db.versions, db.versionSummaries, db.versionSearch, db.sessions],
    async () => {
      const task = await db.tasks.get(taskId);
      if (task?.status === 'done' && task.resultSessionId) {
        const result = await db.sessions.get(task.resultSessionId);
        if (!result) throw new Error('制作记录已被删除');
        return result;
      }
      if (!task || !['pending', 'failed'].includes(task.status))
        throw new Error('生成任务已取消或中断，结果未保存');
      const existing = await findExisting(candidate.name);
      let session: CookingSession;
      if (existing) {
        const conflict = restrictionConflict(existing.version.content, preferences);
        if (conflict) throw new Error(conflict);
        session = existing.session ?? newSession(existing.recipe.id, existing.version.id);
        await db.sessions.put(session);
      } else {
        const recipe: Recipe = {
          id: uid(),
          identity: identity(candidate.name),
          name: content.title,
          aliases: [],
          source: 'ai',
          createdAt: Date.now(),
        };
        const version: RecipeVersion = {
          id: uid(),
          recipeId: recipe.id,
          number: 1,
          parentId: null,
          content,
          preferences: structuredClone(preferences),
          change: '首次生成',
          createdAt: Date.now(),
        };
        session = newSession(recipe.id, version.id);
        await db.recipes.add(recipe);
        await addVersion(version);
        await db.sessions.add(session);
      }
      await db.tasks.update(taskId, {
        status: 'done',
        resultSessionId: session.id,
        resultContent: undefined,
      });
      return session;
    },
  );
}
export async function openBuiltin(
  builtin: BuiltinRecipe,
  preferences: Preferences,
): Promise<CookingSession> {
  const content = validateContent(builtin.content, preferences, false);
  return db.transaction(
    'rw',
    [db.recipes, db.versions, db.versionSummaries, db.versionSearch, db.sessions],
    async () => {
      const recipeId = `catalog-${builtin.id}`;
      const versionId = `${recipeId}-v${builtin.contentVersion}`;
      if (!(await db.recipes.get(recipeId)))
        await db.recipes.add({
          id: recipeId,
          identity: identity(content.title),
          name: content.title,
          aliases: content.aliases,
          source: 'catalog',
          createdAt: Date.now(),
        });
      if (!(await db.versions.get(versionId)))
        await addVersion({
          id: versionId,
          recipeId,
          number: builtin.contentVersion,
          parentId: null,
          content,
          change: `预置资料 ${builtin.sourceNumber}`,
          createdAt: Date.now(),
        });
      const session = newSession(recipeId, versionId, 'catalog');
      await db.sessions.add(session);
      return session;
    },
  );
}
export async function cookAgain(id: string): Promise<CookingSession> {
  return db.transaction('rw', [db.sessions, db.recipes], async () => {
    const previous = await db.sessions.get(id);
    if (!previous) throw new Error('原制作记录不存在');
    const source = previous.source ?? (await db.recipes.get(previous.recipeId))?.source;
    if (!source) throw new Error('原菜谱不存在');
    const session = newSession(previous.recipeId, previous.versionId, source);
    await db.sessions.add(session);
    return session;
  });
}
export async function deleteSession(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.sessions,
      db.timers,
      db.cookingMessages,
      db.recipes,
      db.versions,
      db.versionSummaries,
      db.versionSearch,
      db.tasks,
    ],
    async () => {
      const session = await db.sessions.get(id);
      if (!session) return;
      await db.sessions.delete(id);
      await db.timers.where('sessionId').equals(id).delete();
      await db.cookingMessages.where('sessionId').equals(id).delete();
      await db.tasks
        .where('contextId')
        .equals(id)
        .modify((t) => {
          if (t.status === 'pending') t.status = 'cancelled';
        });
      // Retain the entire parent chain while any session references this recipe.
      if (!(await db.sessions.where('recipeId').equals(session.recipeId).count())) {
        await db.versions.where('recipeId').equals(session.recipeId).delete();
        await db.versionSummaries.where('recipeId').equals(session.recipeId).delete();
        await db.versionSearch.where('recipeId').equals(session.recipeId).delete();
        await db.recipes.delete(session.recipeId);
      }
    },
  );
}
export async function saveProposal(messageId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.cookingMessages,
      db.sessions,
      db.versions,
      db.versionSummaries,
      db.versionSearch,
      db.recipes,
      db.settings,
    ],
    async () => {
      const message = await db.cookingMessages.get(messageId);
      if (!message || message.proposalStatus !== 'pending' || !message.answer?.proposal)
        throw new Error('提案已处理');
      const session = await db.sessions.get(message.sessionId);
      if (
        !session ||
        session.versionId !== message.baseVersionId ||
        session.revision !== message.baseRevision
      )
        throw new Error('实际执行状态或版本已经改变，请重新询问 AI');
      const previous = await db.versions.get(session.versionId);
      const recipe = await db.recipes.get(session.recipeId);
      if (!previous || !recipe) throw new Error('菜谱不存在');
      if (!session.progressKnown) throw new Error('请先在问答中确认实际执行状态，再应用调整');
      const content = applyPatch(
        previous.content,
        message.answer.proposal,
        session,
        recipe.source === 'ai' && !previous.id.startsWith('legacy-'),
      );
      const currentPreferences = await setting('preferences', defaultPreferences());
      const preferences = {
        ...currentPreferences,
        avoidances: [previous.preferences?.avoidances, currentPreferences.avoidances]
          .filter(Boolean)
          .join('、'),
      };
      const conflict = restrictionConflict(content, preferences);
      if (conflict) throw new Error(conflict);
      const latest = await latestVersion(session.recipeId);
      const version: RecipeVersion = {
        id: uid(),
        recipeId: session.recipeId,
        number: (latest?.number ?? previous.number) + 1,
        parentId: previous.id,
        content,
        preferences,
        change: message.answer.proposal.explanation,
        createdAt: Date.now(),
      };
      await addVersion(version);
      await db.sessions.update(session.id, {
        versionId: version.id,
        revision: session.revision + 1,
      });
      await db.cookingMessages.update(message.id, { proposalStatus: 'applied' });
    },
  );
}
export async function confirmExecution(
  sessionId: string,
  targetType: 'prep' | 'step',
  targetId: string,
  done: boolean,
): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error('制作记录不存在');
    const execution = session.execution.filter(
      (e) => !(e.targetType === targetType && e.targetId === targetId),
    );
    if (done) execution.push({ targetType, targetId, confirmedAt: Date.now() });
    await db.sessions.update(sessionId, {
      execution,
      progressKnown: true,
      revision: session.revision + 1,
    });
  });
}
export async function startTimer(
  sessionId: string,
  targetType: Timer['targetType'],
  targetId: string,
  name: string,
  seconds: number,
): Promise<string> {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 604800)
    throw new Error('计时范围为 1 秒到 7 天');
  return db.transaction('rw', [db.timers, db.sessions], async () => {
    if (!(await db.sessions.get(sessionId))) throw new Error('制作记录不存在');
    const existing = await db.timers
      .where('[sessionId+targetType+targetId]')
      .equals([sessionId, targetType, targetId])
      .first();
    if (existing) return existing.id;
    const timer: Timer = {
      id: uid(),
      sessionId,
      targetType,
      targetId,
      name,
      total: seconds,
      remaining: seconds,
      deadline: Date.now() + seconds * 1000,
      status: 'running',
      notified: false,
      createdAt: Date.now(),
    };
    await db.timers.add(timer);
    return timer.id;
  });
}
export async function toggleTimer(id: string): Promise<void> {
  await db.transaction('rw', db.timers, async () => {
    const timer = await db.timers.get(id);
    if (!timer || timer.status === 'done') return;
    const remaining = timerRemaining(timer);
    await db.timers.update(
      id,
      timer.status === 'running'
        ? { status: remaining ? 'paused' : 'done', remaining, deadline: null }
        : { status: 'running', deadline: Date.now() + remaining * 1000 },
    );
  });
}
export async function pruneHistory(time = Date.now()): Promise<void> {
  await db.transaction('rw', [...conversationTables, db.settings], async () => {
    const expired = await db.conversations
      .where('lastSentAt')
      .below(time - 30 * 86400000)
      .limit(32)
      .primaryKeys();
    if (!expired.length) return;
    for (const id of expired) {
      await db.conversationMessages.where('conversationId').equals(id).delete();
      await db.messageSearch.where('conversationId').equals(id).delete();
      await db.settings.delete(`messagesAfter-v5:${id}`);
    }
    await db.conversations.bulkDelete(expired);
    await db.conversationSummaries.bulkDelete(expired);
    await db.conversationSearch.bulkDelete(expired);
    const active = await setting<string | null>('activeConversationId', null);
    if (active !== null && expired.includes(active)) await setSetting('activeConversationId', null);
  });
  await pruneTasks(time);
}

export async function pruneTasks(time = Date.now()) {
  for (const status of ['done', 'cancelled', 'interrupted', 'failed'] as const) {
    await db.transaction('rw', [db.tasks, db.conversationMessages, db.settings], async () => {
      const key = `tasksCleanupCursor-v5:${status}`;
      const cursor = await setting<{ createdAt: number; id: string } | undefined>(key, undefined);
      const tasks = await db.tasks
        .where('[status+createdAt+id]')
        .between(
          cursor ? [status, cursor.createdAt, cursor.id] : [status, Dexie.minKey],
          [status, time - 30 * 86400000, Dexie.minKey],
          false,
          false,
        )
        .limit(32)
        .toArray();
      for (const task of tasks) {
        if (
          task.resultContent ||
          (await db.conversationMessages.where('taskId').equals(task.id).count())
        )
          continue;
        await db.tasks.delete(task.id);
      }
      if (tasks.length === 32) {
        const last = tasks.at(-1)!;
        await setSetting(key, { createdAt: last.createdAt, id: last.id });
      } else if (cursor) await db.settings.delete(key);
    });
  }
}
export async function saveModel(config: ModelConfig, key: string): Promise<void> {
  if (isRetiredDeepSeek(config)) throw new Error(retiredModelMessage);
  config = normalizeModelConfig(config);
  if (!config.name.trim() || !config.model.trim()) throw new Error('名称和模型名称必填');
  const url = new URL(config.url);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请输入不含凭据与查询参数的 HTTP(S) 接口地址');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('远程接口地址须使用 HTTPS');
  await db.transaction('rw', [db.models, db.credentials, db.settings], async () => {
    await db.models.put({
      ...config,
      name: config.name.trim(),
      model: config.model.trim(),
      url: config.url.trim().replace(/\/$/, ''),
    });
    await db.credentials.put({ modelId: config.id, key: key.trim() });
    if (!(await setting('activeModelId', ''))) await setSetting('activeModelId', config.id);
  });
}
export async function deleteModel(id: string) {
  await db.transaction('rw', [db.models, db.credentials, db.settings], async () => {
    await db.models.delete(id);
    await db.credentials.delete(id);
    if ((await setting('activeModelId', '')) === id)
      await setSetting('activeModelId', (await db.models.toArray())[0]?.id ?? '');
  });
}
export async function exportData(): Promise<string> {
  await pruneHistory();
  const { exportSnapshot } = await import('./exportSnapshot');
  return (await exportSnapshot()).text();
}
export async function clearData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await setSetting('localBootstrapDisabled', true);
  });
  localStorage.removeItem('cookpilot-current');
  localStorage.removeItem('cookpilot.demo.v1');
  localStorage.removeItem('cookpilot.legacy.backup');
}
export async function initialize(): Promise<void> {
  await db.open();
  await prepareRecipeNames();
  // Independent maintenance: run it together instead of one round trip after another.
  await Promise.all([updateDeepSeekModels(), pruneHistory(), repairInterruptedTasks()]);
  await pruneLeases();
  // Optional developer convenience; never allowed to hold up the first paint.
  if (import.meta.env.DEV) void bootstrapLocalModel();
  await setSetting(`lease:${pageOwner}`, Date.now());
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('cookpilot-owner', pageOwner);
}
async function prepareRecipeNames() {
  while (!(await setting('recipeNamesReady-v5', false))) {
    const complete = await db.transaction('rw', [db.recipes, db.settings], async () => {
      if (await setting('recipeNamesReady-v5', false)) return true;
      const after = await setting<string | undefined>('recipeNamesAfter-v5', undefined);
      const rows = await (after ? db.recipes.where(':id').above(after) : db.recipes.toCollection())
        .limit(32)
        .toArray();
      for (const recipe of rows)
        await db.recipes.update(recipe.id, {
          nameKeys: [...new Set([recipe.name, ...recipe.aliases].map(identity))],
        });
      if (rows.length < 32) {
        await setSetting('recipeNamesReady-v5', true);
        await db.settings.delete('recipeNamesAfter-v5');
        return true;
      }
      await setSetting('recipeNamesAfter-v5', rows.at(-1)!.id);
      return false;
    });
    if (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
const staleBefore = () => Date.now() - 45000;
// Pending requests in other live tabs remain valid. A stale document lease is interrupted.
async function repairInterruptedTasks(): Promise<void> {
  const pending = await db.tasks.where('status').equals('pending').toArray();
  for (const task of pending) {
    const heartbeat = await setting<number>(`lease:${task.owner}`, 0);
    if (task.owner !== previousReloadOwner && heartbeat >= staleBefore()) continue;
    if (task.kind === 'recommend') await migrateConversation(task.contextId);
    await db.transaction('rw', [db.tasks, ...messageTables], async () => {
      const fresh = await db.tasks.get(task.id);
      if (fresh?.status !== 'pending') return;
      await db.tasks.update(task.id, { status: 'interrupted' });
      for (const message of await db.conversationMessages.where('taskId').equals(task.id).toArray())
        if (message.status === 'pending')
          await updateMessage(message.id, {
            status: 'interrupted',
            text: '请求已中断，请重新发送。',
          });
      // Old versions did not always attach a task ID to placeholders.
      for (const message of await db.conversationMessages
        .where('status')
        .equals('pending')
        .filter((m) => m.conversationId === task.contextId)
        .toArray())
        if (message.status === 'pending' && !message.taskId)
          await updateMessage(message.id, {
            status: 'interrupted',
            text: '请求已中断，请重新发送。',
          });
    });
  }
  // Legacy orphan placeholders have no message-table index. Scan only once during
  // the upgrade, without rewriting finished or live conversations.
  if (!(await setting('messagesRecoveryReady-v5', false))) {
    const orphans = await db.conversations
      .filter((c) => c.messages?.some((m) => m.status === 'pending' && !m.taskId) ?? false)
      .primaryKeys();
    for (const id of orphans) await migrateConversation(String(id));
    await setSetting('messagesRecoveryReady-v5', true);
  }
  const active = new Set(await db.tasks.where('status').equals('pending').primaryKeys());
  for (const message of await db.conversationMessages.where('status').equals('pending').toArray())
    if (!message.taskId || !active.has(message.taskId))
      await updateMessage(message.id, { status: 'interrupted', text: '请求已中断，请重新发送。' });
}
async function pruneLeases(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const expiredLeases = (await db.settings.where('id').startsWith('lease:').toArray())
      .filter((lease) => typeof lease.value !== 'number' || lease.value < staleBefore())
      .map((lease) => lease.id);
    if (expiredLeases.length) await db.settings.bulkDelete(expiredLeases);
  });
}
async function bootstrapLocalModel(): Promise<void> {
  if (
    (await db.models.count()) ||
    (await setting('localBootstrapDisabled', false)) ||
    (await setting('localBootstrapCompleted', false))
  )
    return;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}__local-model`, {
      signal: AbortSignal.timeout(2500),
      headers: { 'X-CookPilot-Local': '1' },
      cache: 'no-store',
    });
    if (response.ok) {
      const config = await response.json();
      await saveModel(
        { id: uid(), name: config.name, url: config.url, model: config.model },
        config.key,
      );
      await setSetting('localBootstrapCompleted', true);
    }
  } catch {
    /* Optional private developer configuration. UI remains usable without it. */
  }
}
export async function updateDeepSeekModels(): Promise<void> {
  await db.transaction('rw', [db.models, db.credentials, db.settings], async () => {
    for (const config of await db.models.toArray()) {
      if (isRetiredDeepSeek(config)) {
        await db.models.delete(config.id);
        await db.credentials.delete(config.id);
      } else {
        const normalized = normalizeModelConfig(config);
        if (normalized.model !== config.model) await db.models.put(normalized);
      }
    }
    const active = await setting('activeModelId', '');
    if (active && !(await db.models.get(active)))
      await setSetting('activeModelId', (await db.models.toArray())[0]?.id ?? '');
  });
}
export async function createTask(
  kind: Task['kind'],
  contextId: string,
  model: ModelConfig,
  candidate?: Candidate,
): Promise<Task> {
  const task: Task = {
    id: uid(),
    kind,
    contextId,
    model: { ...model },
    status: 'pending',
    createdAt: Date.now(),
    owner: pageOwner,
    candidate,
  };
  await db.tasks.add(task);
  return task;
}
export async function cancelTask(id: string) {
  const previous = await db.tasks.get(id);
  if (previous?.kind === 'recommend') await migrateConversation(previous.contextId);
  await db.transaction('rw', [db.tasks, ...messageTables], async () => {
    const task = await db.tasks.get(id);
    if (!task || !['pending', 'failed'].includes(task.status)) return;
    await db.tasks.update(id, { status: 'cancelled', resultContent: undefined });
    if (task.kind !== 'recommend') return;
    const rows = await db.conversationMessages
      .where('status')
      .equals('pending')
      .filter((m) => m.conversationId === task.contextId)
      .toArray();
    for (const message of rows)
      if (message.status === 'pending' && (!message.taskId || message.taskId === id))
        await updateMessage(message.id, {
          status: 'interrupted',
          text: '请求已取消，可继续发送。',
        });
  });
}
export async function commitCookingMessage(taskId: string, message: CookingMessage) {
  await db.transaction('rw', [db.tasks, db.cookingMessages, db.sessions], async () => {
    const task = await db.tasks.get(taskId);
    const session = await db.sessions.get(message.sessionId);
    if (
      task?.status !== 'pending' ||
      !session ||
      session.versionId !== message.baseVersionId ||
      session.revision !== message.baseRevision
    )
      throw new Error('当前版本或执行状态已变化，请重新询问');
    await db.cookingMessages.add(message);
    await db.tasks.update(taskId, { status: 'done' });
  });
}
