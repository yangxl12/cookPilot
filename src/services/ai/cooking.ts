import { chat, ModelError, parseJson, type ChatMessage, type ModelSnapshot } from './client';
import {
  answerSchema,
  contentSchema,
  recommendationSchema,
  type Content,
  type Preferences,
  type Candidate,
  type CookingSession,
  type CookingMessage,
  type Timer,
} from '../../domain/schema';
import {
  validateContent,
  validateRequestedAmounts,
  applyPatch,
  identity,
} from '../../domain/rules';
import { ZodError } from 'zod';

const base =
  '你是 CookPilot 中文烹饪助手。只输出 JSON，不输出 Markdown。difficulty 只能是“简单”“适中”“有点挑战”之一。遵守用户过敏、忌口、锅具限制；明确本次要求优先于默认口味，但不能覆盖过敏限制。不要声称已经替用户完成操作，不生成图片或 HTML。份量默认为一份常规家常菜，不强制问人数。';
export const contentExample: Content = {
  schemaVersion: 1,
  title: '西红柿炒鸡蛋',
  aliases: ['番茄炒蛋'],
  cuisine: '中式',
  minutes: 15,
  difficulty: '简单',
  conditions: '常规一盘，番茄400g，鸡蛋3个',
  cookware: ['炒锅'],
  keyPoints: ['鸡蛋先炒后盛出，最后回锅。'],
  ingredients: [
    {
      id: 'tomato',
      name: '番茄',
      quantity: 400,
      unit: 'g',
      amountText: '',
      group: '主料',
      note: '',
    },
    { id: 'egg', name: '鸡蛋', quantity: 3, unit: '个', amountText: '', group: '主料', note: '' },
    {
      id: 'oil',
      name: '食用油',
      quantity: 15,
      unit: 'ml',
      amountText: '',
      group: '调味',
      note: '',
    },
    { id: 'salt', name: '盐', quantity: 2, unit: 'g', amountText: '', group: '调味', note: '' },
  ],
  prep: [
    {
      id: 'cut',
      title: '处理食材',
      action: '番茄洗净去蒂切块；将 {{egg}} 打散，加入 {{salt}} 搅匀。',
      uses: [
        { ingredientId: 'tomato', fraction: 0 },
        { ingredientId: 'egg', fraction: 0 },
        { ingredientId: 'salt', fraction: 0.5 },
      ],
      seconds: 0,
      parallel: '',
    },
  ],
  steps: [
    {
      id: 'eggs',
      title: '炒蛋盛出',
      action: '中火热锅，加入 {{oil}}，倒入 {{egg}}，轻推至凝固盛出。',
      uses: [
        { ingredientId: 'oil', fraction: 0.6666667 },
        { ingredientId: 'egg', fraction: 1 },
      ],
      heat: '中火',
      seconds: 60,
      signal: '蛋液凝固但保持柔嫩，无流动生蛋液。',
      tip: '',
      dependsOn: [],
    },
    {
      id: 'finish',
      title: '炒番茄与合炒',
      action: '锅中补 {{oil}}，下 {{tomato}} 和 {{salt}} 炒至出汁，倒回炒好的鸡蛋翻匀。',
      uses: [
        { ingredientId: 'oil', fraction: 0.3333333 },
        { ingredientId: 'tomato', fraction: 1 },
        { ingredientId: 'salt', fraction: 0.5 },
      ],
      heat: '中火',
      seconds: 240,
      signal: '番茄软化出汁，鸡蛋均匀裹汁。',
      tip: '根据番茄成熟度观察，计时仅作参考。',
      dependsOn: ['eggs'],
    },
  ],
};
const contentRules = `完整指南按此 JSON schema 示例输出，字段必须完整：${JSON.stringify(contentExample)}。
食材 id、备菜 id、步骤 id 各自唯一且只用英文字母数字下划线连字符。
数字食材用量只存 ingredients.quantity+unit；不确定用量 quantity=null，amountText="适量（具体判断依据）"。
prep/steps.uses 中 fraction 是本操作实际使用该食材总量的比例；只处理、观察或引用先前准备好的材料用 fraction=0。
洗净、切片、切段、拍碎等单纯处理不能分配用量；同一食材随后下锅时才分配。已经调好的碗汁、腌料后续只引用，不再次分配。
每种食材在全部 prep+steps 的 fraction 合计必须恰好=1（不可备菜分配一次，下锅再重复分配）。
操作 action 中实际分配的材料一律写 {{食材id}} 占位符，每个 fraction>0 的材料都必须出现占位符；不要在 action 中硬编码克、g、毫升、ml、匙的用量。
action 中每个占位符都必须在本操作 uses 中列出；仅引用已处理材料时 fraction=0。占位符前后不要再写“一半”“剩余”“全部”等比例词，渲染会自动给出本步实际用量。
备菜腌制和调碗汁用掉的调料在备菜中分配；后续倒入已经调好的碗汁用普通文字，不重复使用调料份额。
烹饪 steps 不包含备菜步骤。备菜默认在烹饪前完成；dependsOn 只能引用本步骤之前的烹饪步骤ID，不写备菜ID。完成 signal 与当前操作对应，包含可观察的熟度、颜色、质地。
cookware 只列必要的锅具，如炒锅/平底锅/汤锅/蒸锅/烤箱/电饭煲。无需加热的凉菜填 ["无需锅具"]，不要把碗、刀、砧板等备菜工具当作锅具限制。`;

function normalizeGeneratedContent(input: unknown): Content {
  const content = contentSchema.parse(input);
  const ingredients = new Set(content.ingredients.map((ingredient) => ingredient.id));
  const actions = [...content.prep, ...content.steps];
  const totals = new Map<string, number>();
  for (const action of actions)
    for (const use of action.uses)
      totals.set(use.ingredientId, (totals.get(use.ingredientId) ?? 0) + use.fraction);
  for (const action of actions) {
    action.action = action.action.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (reference, id: string) =>
      ingredients.has(id) ? `{{${id}}}` : reference,
    );
    // A fully allocated ingredient can be mentioned again without consuming more.
    // Never infer a positive allocation for a missing usage row.
    for (const [, id] of action.action.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (
        ingredients.has(id) &&
        Math.abs((totals.get(id) ?? 0) - 1) <= 0.001 &&
        !action.uses.some((use) => use.ingredientId === id)
      )
        action.uses.push({ ingredientId: id, fraction: 0 });
    }
    // Recover omitted quantity references from the model's explicit allocations.
    // Keep the instructions and fractions intact; validation still checks consistency.
    const missing = action.uses.filter(
      (use) =>
        use.fraction > 0 &&
        ingredients.has(use.ingredientId) &&
        !action.action.includes(`{{${use.ingredientId}}}`),
    );
    if (missing.length) {
      const references = missing.map((use) => `{{${use.ingredientId}}}`).join('、');
      action.action += `\n本步用量：${references}。`;
    }
  }
  // All prep precedes cooking. Its dependency edges are redundant in stored steps.
  // Keep ambiguous, unknown, self and forward step references for strict validation.
  const prepIds = new Set(content.prep.map((action) => action.id));
  const stepIds = new Set(content.steps.map((action) => action.id));
  for (const step of content.steps)
    step.dependsOn = step.dependsOn.filter((id) => !prepIds.has(id) || stepIds.has(id));
  return content;
}

function contentError(error: unknown): string {
  if (error instanceof ZodError)
    return error.issues
      .slice(0, 12)
      .map((issue) => {
        const detail =
          issue.code === 'invalid_value'
            ? `只能为 ${issue.values.join(' / ')}`
            : issue.code === 'invalid_type'
              ? `缺失或格式不正确，应为 ${issue.expected}`
              : issue.code === 'too_small'
                ? `不得小于 ${issue.minimum}`
                : issue.code === 'too_big'
                  ? `不得大于 ${issue.maximum}`
                  : '格式不正确';
        return `${issue.path.join('.')} ${detail}`;
      })
      .join('；');
  return error instanceof Error ? error.message : '内容不完整';
}

export async function recommend(
  snapshot: ModelSnapshot,
  history: ChatMessage[],
  preferences: Preferences,
  savedNames: string[],
  signal: AbortSignal,
) {
  const output = await chat(
    snapshot,
    [
      {
        role: 'system',
        content: `${base}
职责：首页对话与推荐。做菜相关通常推荐3道候选；明确菜名时应包括指定菜。无关做菜则正常聊天，candidates=[]；不明确时简短澄清。
候选只生成摘要，不生成完整菜谱。JSON格式：{"text":"简短回复","candidates":[{"name":"菜名","aliases":[],"minutes":20,"difficulty":"简单","summary":"特点与用料","blocked":"无法满足限制时说明，否则空字符串"}]}。
偏好：${JSON.stringify(preferences)}。用户已有AI菜谱：${JSON.stringify(savedNames)}。不要因共享食材视为相同菜。`,
      },
      ...history.slice(-20),
    ],
    { signal, json: true, maxTokens: 1600 },
  );
  const result = recommendationSchema.safeParse(parseJson(output));
  if (!result.success) throw new ModelError('模型返回的推荐内容不完整或格式不符合要求，请重新发送');
  return result.data;
}
export async function generate(
  snapshot: ModelSnapshot,
  candidate: Candidate,
  requirements: string,
  preferences: Preferences,
  signal: AbortSignal,
  explicitUserText = requirements,
): Promise<Content> {
  const messages: ChatMessage[] = [
    { role: 'system', content: `${base}\n${contentRules}` },
    {
      role: 'user',
      content: `只生成选中的一道菜：${candidate.name}。相关对话与本次要求：${requirements}。通用偏好：${JSON.stringify(preferences)}`,
    },
  ];
  let previous = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    previous = await chat(snapshot, messages, { signal, json: true, maxTokens: 6500 });
    signal.throwIfAborted();
    try {
      const content = normalizeGeneratedContent(parseJson(previous));
      const problems: string[] = [];
      for (const check of [
        () => validateContent(content, preferences),
        () => validateRequestedAmounts(content, explicitUserText),
      ]) {
        try {
          check();
        } catch (error) {
          problems.push(contentError(error));
        }
      }
      if (identity(content.title) !== identity(candidate.name))
        problems.push(`菜名必须为所选的“${candidate.name}”，不能改成“${content.title}”`);
      if (problems.length) throw new Error(problems.join('；'));
      return content;
    } catch (error) {
      const explanation = contentError(error);
      if (attempt === 2) throw new Error(`菜谱内容校验未通过，未保存：${explanation}`);
      messages.push(
        { role: 'assistant', content: previous },
        {
          role: 'user',
          content: `修复以下全部校验错误并重新返回完整 JSON（第${attempt + 1}次修复，最多2次）：${explanation}。
逐项核对所有食材的 prep+steps.uses：仅切配/处理用0，实际加入时分配，已经加入的材料再次引用用0。分配总和必须为1，不能修改食材总量来掩盖分配错误。
保留已经正确的字段，不要修改菜名、用户明确用量、忌口和锅具限制。返回前自行检查所有字段、用量、占位符和步骤依赖。`,
        },
      );
    }
  }
  throw new Error('生成失败');
}
export async function askCooking(
  snapshot: ModelSnapshot,
  question: string,
  context: {
    content: Content;
    session: CookingSession;
    messages: CookingMessage[];
    timers: Timer[];
    preferences: Preferences;
    strict: boolean;
  },
  signal: AbortSignal,
) {
  const { content, session } = context;
  const stage =
    session.currentCard === 0
      ? '备菜阶段'
      : `正在查看第${session.currentCard}步：${content.steps[session.currentCard - 1]?.title}（仅查看，不代表执行）`;
  const output = await chat(
    snapshot,
    [
      {
        role: 'system',
        content: `${base}
职责：当前制作问答。回答先给现在可以执行的操作、观察状态、后续影响。用户实际描述优先于查看位置。
返回 {"text":"回答","confirmations":[{"targetType":"prep或step","targetId":"原有ID","question":"是否已经...？"}],"proposal":null}。
如果用户要求修改流程，必须知道实际进度。未知时先提出最少的confirmations并让用户确认，不生成proposal。
已知进度且可以安全调整时，proposal 为 {"explanation":"变更原因与影响","steps":[仅替换受影响的原有完整步骤对象],"prep":[仅替换受影响的原有完整备菜对象],"ingredients":[需要变更的原有完整食材对象]}。
保留所有稳定 ID；禁止改已执行内容；禁止改已用食材的总用量；禁止新增食材或增删步骤。仅调整尚未执行的相关操作。没有修改则proposal=null。
严格用量规则：${contentRules}
当前阶段：${stage}。实际已确认执行记录：${JSON.stringify(session.execution)}。是否已明确确认进度：${JSON.stringify(session.progressKnown ?? false)}。
当前版本内容：${JSON.stringify(content)}。通用偏好：${JSON.stringify(context.preferences)}。计时状态：${JSON.stringify(context.timers.map((t) => ({ name: t.name, status: t.status, deadline: t.deadline, remaining: t.remaining })))}。
相关问答：${JSON.stringify(context.messages.slice(-10).map((m) => ({ role: m.role, text: m.text })))}。`,
      },
      { role: 'user', content: question },
    ],
    { signal, json: true, maxTokens: 4500 },
  );
  const answer = answerSchema.parse(parseJson(output));
  for (const confirmation of answer.confirmations) {
    const actions = confirmation.targetType === 'prep' ? content.prep : content.steps;
    if (!actions.some((a) => a.id === confirmation.targetId))
      throw new Error('AI 确认引用了不存在的步骤，请重试');
  }
  if (answer.proposal) {
    if (!session.progressKnown) {
      answer.proposal = null;
      answer.text += '\n请先确认实际执行状态，再请我调整做法。';
    } else applyPatch(content, answer.proposal, session, context.strict);
  }
  return answer;
}
