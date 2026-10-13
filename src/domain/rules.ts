import {
  contentSchema,
  type Content,
  type Preferences,
  type ProposalPatch,
  type CookingSession,
  type Timer,
} from './schema';

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
const aliases = [
  ['西红柿炒鸡蛋', '番茄炒蛋', '番茄炒鸡蛋', '西红柿炒蛋'],
  ['宫保鸡丁', '宫爆鸡丁'],
];
export function identity(name: string): string {
  const normalized = normalizeName(name);
  const group = aliases.find((names) => names.some((n) => normalizeName(n) === normalized));
  return group ? normalizeName(group[0]) : normalized;
}
export function nameMatches(name: string, names: string[]): boolean {
  return names.some((n) => identity(n) === identity(name));
}
export function effectivePreferences(preferences: Preferences, userText: string): Preferences {
  const explicit: string[] = [];
  for (const match of userText.matchAll(
    /(?:不吃|不能吃|不放|不要|避免|忌口是|忌口[:：]?)[ \t]*([\u4e00-\u9fffA-Za-z]+(?:[、/][\u4e00-\u9fffA-Za-z]+)*)/g,
  ))
    explicit.push(match[1]);
  for (const clause of userText.split(/[，。；！\n,;!]/)) {
    const match = clause.match(/(?:对|有)?([\u4e00-\u9fffA-Za-z、/]+)过敏/);
    if (match) explicit.push(match[1].replace(/^(?:我对|我是|对|我)/, '').replace(/严重$/, ''));
  }
  return {
    ...preferences,
    avoidances: [preferences.avoidances, ...explicit].filter(Boolean).join('、'),
  };
}
export function restrictionConflict(content: Content, preferences: Preferences): string {
  const avoid = preferences.avoidances
    .replace(/不过敏|无过敏|没有过敏|无忌口|没有忌口/g, '')
    .trim();
  if (!avoid) return '';
  const families: Record<string, string[]> = {
    花生: ['花生', '花生油', '花生酱'],
    坚果: ['花生', '核桃', '腰果', '杏仁', '榛子', '坚果'],
    海鲜: ['虾', '蟹', '鱼', '贝', '蚝', '鱿鱼', '鱼露'],
    乳制品: ['牛奶', '奶油', '黄油', '奶酪', '酸奶'],
    鸡蛋: ['鸡蛋', '蛋液', '蛋白', '蛋黄'],
    蛋类: ['鸡蛋', '鸭蛋', '蛋液', '蛋黄'],
    麸质: ['面粉', '面条', '生抽', '酱油', '面包', '小麦'],
    辣: ['辣椒', '辣酱', '豆瓣酱', '咖喱'],
    牛奶: ['牛奶', '奶油', '黄油', '奶酪'],
    大豆: ['豆腐', '豆浆', '生抽', '酱油', '豆瓣酱', '味噌'],
  };
  const tokens = avoid
    .split(/[、,，;；\s/]+/)
    .map((s) =>
      s
        .replace(/^(?:我对|对|不吃|不能吃|忌口|避免|不要|不放|任何|所有)+/, '')
        .replace(/(?:严重)?过敏$/, ''),
    )
    .filter(Boolean);
  const hits = new Set<string>();
  for (const ingredient of content.ingredients) {
    for (const token of tokens) {
      const words = families[token] ?? [token];
      if (words.some((word) => ingredient.name.includes(word))) hits.add(ingredient.name);
    }
  }
  return hits.size ? `与当前忌口冲突：${[...hits].join('、')}。请选其他菜，或核对通用设置。` : '';
}
export function validateContent(input: unknown, preferences?: Preferences, strict = true): Content {
  const content = contentSchema.parse(input);
  const problems: string[] = [];
  const ingredients = new Map(content.ingredients.map((i) => [i.id, i]));
  if (ingredients.size !== content.ingredients.length) problems.push('食材 ID 重复');
  for (const list of [content.prep, content.steps])
    if (new Set(list.map((s) => s.id)).size !== list.length) problems.push('备菜或步骤 ID 重复');
  const consumed = new Map<string, number>();
  for (const action of [...content.prep, ...content.steps]) {
    if (new Set(action.uses.map((u) => u.ingredientId)).size !== action.uses.length)
      problems.push(`${action.id} 重复引用食材`);
    for (const use of action.uses) {
      if (!ingredients.has(use.ingredientId)) problems.push(`不存在的食材 ${use.ingredientId}`);
      consumed.set(use.ingredientId, (consumed.get(use.ingredientId) ?? 0) + use.fraction);
      if (strict && use.fraction > 0 && !action.action.includes(`{{${use.ingredientId}}}`))
        problems.push(`${action.id} 的用量必须通过 {{${use.ingredientId}}} 引用`);
    }
    for (const match of action.action.matchAll(/\{\{([^}]+)\}\}/g))
      if (!action.uses.some((u) => u.ingredientId === match[1]))
        problems.push(`${action.id} 的文字引用缺少用量表`);
    if (strict && /\d+(?:\.\d+)?\s*(?:g\b|ml\b|克|毫升|茶匙|汤匙)/i.test(action.action))
      problems.push(`${action.id} 不得硬编码食材用量，使用占位引用`);
  }
  if (strict)
    for (const ingredient of content.ingredients) {
      if (Math.abs((consumed.get(ingredient.id) ?? 0) - 1) > 0.001)
        problems.push(`${ingredient.name} 用量分配之和不等于 1`);
      if (ingredient.quantity === null && !ingredient.amountText)
        problems.push(`${ingredient.name} 缺少定性用量说明`);
    }
  const before = new Set<string>();
  for (const step of content.steps) {
    if (step.dependsOn.some((id) => !before.has(id)))
      problems.push(`${step.id} 依赖不存在或顺序错误`);
    before.add(step.id);
  }
  if (preferences) {
    const conflict = restrictionConflict(content, preferences);
    if (conflict) problems.push(conflict);
    if (
      preferences.cookware.length &&
      !content.cookware.every(
        (tool) =>
          /无需加热|无需锅具/.test(tool) ||
          preferences.cookware.some(
            (available) => tool.includes(available) || available.includes(tool),
          ),
      )
    )
      problems.push('所需锅具与现有锅具不匹配');
  }
  if (problems.length) throw new Error(problems.slice(0, 12).join('；'));
  return content;
}
export function validateRequestedAmounts(content: Content, userText: string): Content {
  const synonyms: Record<string, string[]> = {
    番茄: ['西红柿'],
    西红柿: ['番茄'],
    鸡蛋: ['鸡蛋'],
    鸡胸肉: ['鸡胸'],
  };
  const normalized = (quantity: number, unit: string) =>
    unit === 'kg' || unit === '千克'
      ? [quantity * 1000, 'g']
      : unit === '斤'
        ? [quantity * 500, 'g']
        : unit === '克'
          ? [quantity, 'g']
          : unit === '毫升'
            ? [quantity, 'ml']
            : [quantity, unit];
  for (const ingredient of content.ingredients.filter((i) => i.group === '主料')) {
    const names = [ingredient.name, ...(synonyms[ingredient.name] ?? [])]
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const unit = '(kg|千克|斤|g|克|ml|毫升|个|根|片|只|条|颗|块|枚)';
    const after = new RegExp(
      `(?:${names})\\s*(?:有|约|大约)?\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`,
      'gi',
    );
    const before = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*(?:的)?(?:${names})`, 'gi');
    const matches = [...userText.matchAll(after), ...userText.matchAll(before)].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const latest = matches.at(-1);
    if (!latest) continue;
    const [expected, expectedUnit] = normalized(Number(latest[1]), latest[2].toLowerCase());
    const [actual, actualUnit] = normalized(
      ingredient.quantity ?? NaN,
      ingredient.unit.toLowerCase(),
    );
    if (
      expectedUnit !== actualUnit ||
      Math.abs(Number(expected) - Number(actual)) > 0.01 ||
      !Number.isFinite(actual)
    )
      throw new Error(`${ingredient.name} 未遵守本次明确用量 ${latest[1]}${latest[2]}`);
  }
  return content;
}
export function ingredientAmount(
  content: Content,
  use: { ingredientId: string; fraction: number },
): string {
  const ingredient = content.ingredients.find((i) => i.id === use.ingredientId);
  if (!ingredient) return '';
  if (use.fraction === 0) return ingredient.name;
  const amount =
    ingredient.quantity === null
      ? ingredient.amountText
      : `${Math.round(ingredient.quantity * use.fraction * 100) / 100}${ingredient.unit}`;
  return `${ingredient.name} ${amount}`;
}
export function renderAction(
  content: Content,
  action: { action: string; uses: { ingredientId: string; fraction: number }[] },
): string {
  return action.action.replace(/\{\{([^}]+)\}\}/g, (_, id: string) =>
    ingredientAmount(
      content,
      action.uses.find((u) => u.ingredientId === id) ?? { ingredientId: id, fraction: 0 },
    ),
  );
}
export function contentSearchText(content: Content): string {
  return [
    content.title,
    ...content.aliases,
    content.conditions,
    ...content.cookware,
    ...content.keyPoints,
    ...content.ingredients.map(
      (i) => `${i.name} ${i.quantity === null ? i.amountText : `${i.quantity}${i.unit}`} ${i.note}`,
    ),
    ...content.prep.map((p) => `${p.title} ${renderAction(content, p)} ${p.parallel}`),
    ...content.steps.map(
      (s) => `${s.title} ${renderAction(content, s)} ${s.heat} ${s.signal} ${s.tip}`,
    ),
  ].join(' ');
}
export function applyPatch(
  content: Content,
  patch: ProposalPatch,
  session: CookingSession,
  strict = true,
): Content {
  if (!strict && patch.ingredients.length)
    throw new Error('原文菜谱的用量尚未拆分，不能直接调整总用量；可询问当前操作建议');
  const completed = new Set(session.execution.map((e) => `${e.targetType}:${e.targetId}`));
  for (const values of [patch.steps, patch.prep, patch.ingredients]) {
    if (new Set(values.map((v) => v.id)).size !== values.length)
      throw new Error('调整提案含有重复的目标 ID');
  }
  for (const [kind, replacements, originals] of [
    ['step', patch.steps, content.steps],
    ['prep', patch.prep, content.prep],
  ] as const) {
    for (const replacement of replacements) {
      if (!originals.some((s) => s.id === replacement.id))
        throw new Error('调整只能引用原有步骤 ID');
      if (completed.has(`${kind}:${replacement.id}`)) throw new Error('不能修改已明确执行的内容');
    }
  }
  const consumedIds = new Set(
    [
      ...content.prep.filter((p) => completed.has(`prep:${p.id}`)),
      ...content.steps.filter((p) => completed.has(`step:${p.id}`)),
    ].flatMap((p) => p.uses.filter((u) => u.fraction > 0).map((u) => u.ingredientId)),
  );
  for (const ingredient of patch.ingredients) {
    const original = content.ingredients.find((i) => i.id === ingredient.id);
    if (!original) throw new Error('首版调整不允许新增食材，请选择现有材料');
    if (consumedIds.has(ingredient.id) && JSON.stringify(original) !== JSON.stringify(ingredient))
      throw new Error('已经使用的食材用量不可改写');
  }
  if (
    !patch.steps.length &&
    !patch.prep.length &&
    !patch.ingredients.length &&
    !patch.keyPoints?.length
  )
    throw new Error('调整提案没有变更');
  return validateContent(
    {
      ...content,
      ingredients: content.ingredients.map(
        (i) => patch.ingredients.find((p) => p.id === i.id) ?? i,
      ),
      prep: content.prep.map((i) => patch.prep.find((p) => p.id === i.id) ?? i),
      steps: content.steps.map((i) => patch.steps.find((p) => p.id === i.id) ?? i),
      keyPoints: patch.keyPoints ?? content.keyPoints,
    },
    undefined,
    strict,
  );
}
export const timerRemaining = (timer: Timer, time = Date.now()) =>
  timer.status === 'running' && timer.deadline !== null
    ? Math.max(0, Math.ceil((timer.deadline - time) / 1000))
    : timer.status === 'done'
      ? 0
      : timer.remaining;
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.max(0, seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export const isExpired = (lastSentAt: number, time = Date.now()) =>
  time - lastSentAt > 30 * 24 * 60 * 60 * 1000;
export function historyGroup(time: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (time >= date.getTime()) return '今天';
  if (time >= date.getTime() - 86400000) return '昨天';
  return time >= Date.now() - 7 * 86400000 ? '近 7 天' : '近 30 天';
}
