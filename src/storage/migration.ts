import { z } from 'zod';
import { db, setting, setSetting } from './db';
import {
  contentSchema,
  defaultPreferences,
  preferencesSchema,
  uid,
  type Content,
  type CookingSession,
} from '../domain/schema';
import { identity, isExpired } from '../domain/rules';
import { saveModel } from './repository';
import { isRetiredDeepSeek } from '../services/ai/providers';

// One-time same-origin migration only. The untouched original is backed up first.
const legacyRecipe = z.object({
  id: z.string(),
  title: z.string(),
  cuisine: z.string().optional(),
  minutes: z.number(),
  level: z.string(),
  key: z.string(),
  tools: z.array(z.string()),
  ingredients: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      group: z.enum(['主料', '调味']),
      note: z.string().optional(),
    }),
  ),
  prep: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      uses: z.array(z.string()),
      seconds: z.number().optional(),
      parallel: z.string().optional(),
    }),
  ),
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      action: z.string(),
      uses: z.array(z.string()),
      heat: z.string().optional(),
      seconds: z.number().optional(),
      signal: z.string(),
      tip: z.string(),
      why: z.string().optional(),
    }),
  ),
});
const legacyGuide = z.object({
  id: z.string(),
  recipe: legacyRecipe,
  conditions: z.unknown(),
  checked: z.array(z.string()),
  completed: z.array(z.string()),
  currentCard: z.number().optional(),
  currentStep: z.number(),
  note: z.string(),
  source: z.enum(['ai', 'catalog']),
  createdAt: z.string(),
  version: z.number(),
  changes: z.array(z.string()),
});
const legacyCandidate = z.object({
  recipe: z.object({ title: z.string(), minutes: z.number(), level: z.string() }),
  blocked: z.string().optional(),
});
const legacySchema = z.object({
  guides: z.array(legacyGuide),
  activeId: z.string().nullable(),
  activeConversationId: z.string().nullable().optional(),
  modelId: z.string().optional(),
  models: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        key: z.string(),
        model: z.string(),
      }),
    )
    .optional(),
  preferences: preferencesSchema.optional(),
  timers: z
    .array(
      z.object({
        id: z.string(),
        guideId: z.string(),
        stepId: z.string(),
        name: z.string(),
        total: z.number(),
        remaining: z.number(),
        endAt: z.number().nullable(),
        notified: z.boolean(),
      }),
    )
    .optional(),
  conversations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        turns: z.array(
          z.object({
            id: z.string(),
            prompt: z.string(),
            result: z
              .object({ text: z.string(), candidates: z.array(legacyCandidate).optional() })
              .nullish(),
          }),
        ),
      }),
    )
    .optional(),
});
export async function migrateLegacy(): Promise<void> {
  const raw = localStorage.getItem('cookpilot.demo.v1');
  if (
    !raw ||
    (await setting('legacyMigrated', false)) ||
    (await setting('localBootstrapDisabled', false))
  )
    return;
  localStorage.setItem('cookpilot.legacy.backup', raw);
  const parsed = legacySchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      '旧 Demo 数据格式无法完整识别；原文已备份至 cookpilot.legacy.backup，请先保留备份再修复',
    );
  const legacy = parsed.data;
  await db.transaction('rw', db.tables, async () => {
    for (const guide of legacy.guides) {
      const r = guide.recipe;
      const recipeId = `legacy-${guide.source}-${r.id}`;
      const versionId = `legacy-version-${guide.id}`;
      // Legacy snapshots contain no canonical allocation; preserve their exact actions.
      const content: Content = contentSchema.parse({
        schemaVersion: 1,
        title: r.title,
        aliases: [],
        cuisine: /西式|日式/.test(r.cuisine ?? '') ? '西式与日式' : '中式',
        minutes: r.minutes,
        difficulty: r.level === '有点挑战' ? '有点挑战' : '简单',
        conditions:
          typeof guide.conditions === 'string'
            ? guide.conditions
            : JSON.stringify(guide.conditions),
        cookware: r.tools.length ? [r.tools[0]] : ['炒锅'],
        keyPoints: [r.key],
        ingredients: r.ingredients.map((i) => ({ ...i, amountText: '', note: i.note ?? '' })),
        prep: r.prep.map((p) => ({
          ...p,
          action: p.detail,
          uses: p.uses.map((ingredientId) => ({ ingredientId, fraction: 0 })),
        })),
        steps: r.steps.map((s) => ({
          ...s,
          dependsOn: [],
          uses: s.uses.map((ingredientId) => ({ ingredientId, fraction: 0 })),
        })),
      });
      const createdAt = Date.parse(guide.createdAt);
      if (!Number.isFinite(createdAt)) throw new Error('旧制作日期无效，迁移已回滚');
      if (!(await db.recipes.get(recipeId)))
        await db.recipes.add({
          id: recipeId,
          identity: identity(r.title),
          name: r.title,
          aliases: [],
          source: guide.source,
          createdAt,
        });
      const existingVersions = await db.versions.where('recipeId').equals(recipeId).toArray();
      const number = Math.max(guide.version, 1, ...existingVersions.map((v) => v.number + 1));
      await db.versions.add({
        id: versionId,
        recipeId,
        number,
        parentId: null,
        content,
        change: `旧 Demo v${guide.version} 当前快照迁移；${guide.changes.join('；')}`,
        createdAt,
      });
      const session: CookingSession = {
        id: guide.id,
        recipeId,
        versionId,
        checked: guide.checked,
        currentCard: guide.currentCard ?? guide.currentStep + 1,
        execution: guide.completed.map((targetId) => ({
          targetType: 'step',
          targetId,
          confirmedAt: createdAt,
        })),
        progressKnown: false,
        revision: 0,
        note: guide.note,
        createdAt,
      };
      await db.sessions.add(session);
    }
    for (const timer of legacy.timers ?? []) {
      if (!(await db.sessions.get(timer.guideId)))
        throw new Error('旧计时缺少制作记录，迁移已回滚');
      const guide = legacy.guides.find((g) => g.id === timer.guideId)!;
      const targetType = guide.recipe.prep.some((p) => p.id === timer.stepId)
        ? 'prep'
        : guide.recipe.steps.some((s) => s.id === timer.stepId)
          ? 'step'
          : 'custom';
      await db.timers.add({
        id: timer.id,
        sessionId: timer.guideId,
        targetType,
        targetId: timer.stepId,
        name: timer.name,
        total: timer.total,
        remaining: timer.remaining,
        deadline: timer.endAt,
        status: timer.endAt !== null ? 'running' : timer.remaining > 0 ? 'paused' : 'done',
        notified: timer.notified,
        createdAt: Date.now(),
      });
    }
    for (const model of legacy.models ?? []) {
      if (isRetiredDeepSeek(model)) continue;
      const id = uid();
      await saveModel({ id, name: model.name, url: model.url, model: model.model }, model.key);
      if (model.id === legacy.modelId) await setSetting('activeModelId', id);
    }
    for (const conversation of legacy.conversations ?? []) {
      const lastSentAt = Date.parse(conversation.updatedAt);
      const createdAt = Date.parse(conversation.createdAt);
      if (!Number.isFinite(lastSentAt) || !Number.isFinite(createdAt))
        throw new Error('旧对话日期无效，迁移已回滚');
      if (isExpired(lastSentAt)) continue;
      await db.conversations.add({
        id: conversation.id,
        title: conversation.title,
        createdAt,
        lastSentAt,
        messages: conversation.turns.flatMap((turn) => [
          { id: `${turn.id}-user`, role: 'user' as const, text: turn.prompt, createdAt },
          {
            id: `${turn.id}-assistant`,
            role: 'assistant' as const,
            text: turn.result?.text ?? '旧请求已中断，可重新发送。',
            status: turn.result ? ('done' as const) : ('interrupted' as const),
            createdAt,
            candidates: turn.result?.candidates?.map((c) => ({
              name: c.recipe.title,
              aliases: [],
              minutes: c.recipe.minutes,
              difficulty: c.recipe.level === '有点挑战' ? ('有点挑战' as const) : ('简单' as const),
              summary: '',
              blocked: c.blocked ?? '',
            })),
          },
        ]),
      });
    }
    if (legacy.activeConversationId && (await db.conversations.get(legacy.activeConversationId)))
      await setSetting('activeConversationId', legacy.activeConversationId);
    await setSetting('preferences', legacy.preferences ?? defaultPreferences());
    await setSetting('legacyMigrated', true);
  });
  if (legacy.activeId) localStorage.setItem('cookpilot-current', legacy.activeId);
}
