import { afterEach, expect, it, vi } from 'vitest';
import { chat, parseJson } from '../../src/services/ai/client';
import { generate, recommend, contentExample } from '../../src/services/ai/cooking';
import { defaultPreferences, difficultySchema } from '../../src/domain/schema';
import { renderAction, validateContent, validateRequestedAmounts } from '../../src/domain/rules';
import realContent from '../fixtures/deepseek-flash-guide.json';
import realRecommendation from '../fixtures/deepseek-flash-recommendation.json';

const model = {
  id: 'test',
  name: 'test',
  model: 'deepseek-flash',
  url: 'https://api.deepseek.com',
  key: 'private-test-key',
};
const result = (content: string, finish_reason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }), {
    status: 200,
  });
afterEach(() => vi.unstubAllGlobals());
it('用户提供的辣椒炒牛肉响应保留全部三道候选，中等统一为适中，且不重新请求', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(realRecommendation)));
  vi.stubGlobal('fetch', fetcher);
  const response = await recommend(
    model,
    [{ role: 'user', content: '辣椒炒牛肉' }],
    defaultPreferences(),
    [],
    new AbortController().signal,
  );
  expect(response.candidates.map((c) => c.name)).toEqual(['辣椒炒牛肉', '青椒牛肉丝', '杭椒牛柳']);
  expect(response.candidates[2].difficulty).toBe('适中');
  expect(response.candidates[0].aliases).toEqual(['小炒黄牛肉']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const request = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(request.response_format).toEqual({ type: 'json_object' });
  expect(request.thinking).toEqual({ type: 'disabled' });
  expect(request.messages[0].content).toContain('difficulty 只能是');
});
it.each([
  ['容易', '简单'],
  [' 中等 ', '适中'],
  ['困难', '有点挑战'],
])('难度 %s 归一为 %s，完整菜谱也能通过校验', (input, expected) => {
  expect(difficultySchema.parse(input)).toBe(expected);
  expect(
    validateContent({ ...contentExample, difficulty: input }, defaultPreferences()).difficulty,
  ).toBe(expected);
});
it('未知难度和无效字段仍拒绝，推荐错误显示可读提示', async () => {
  expect(difficultySchema.safeParse('未知').success).toBe(false);
  expect(difficultySchema.safeParse(null).success).toBe(false);
  const invalid = JSON.parse(realRecommendation.choices[0].message.content);
  invalid.candidates[2].minutes = -1;
  const fetcher = vi.fn().mockResolvedValue(result(JSON.stringify(invalid)));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    recommend(model, [], defaultPreferences(), [], new AbortController().signal),
  ).rejects.toThrow('推荐内容不完整或格式不符合要求');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['deepseek-flash', 'deepseek-v4-pro'])(
  '官方 %s 使用当前 JSON 与非思考参数',
  async (name) => {
    const fetcher = vi.fn().mockResolvedValue(result('{"text":"ok"}'));
    vi.stubGlobal('fetch', fetcher);
    await chat({ ...model, model: name }, [{ role: 'user', content: '输出 JSON' }], { json: true });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.model).toBe(name);
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request).not.toHaveProperty('reasoning_effort');
  },
);
it('第三方接口不附加 DeepSeek 参数；官方停用名称在发请求前拒绝', async () => {
  const fetcher = vi.fn().mockResolvedValue(result('ok'));
  vi.stubGlobal('fetch', fetcher);
  await chat({ ...model, url: 'https://example.com/v1', model: 'deepseek-chat' }, []);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('thinking');
  await expect(chat({ ...model, model: 'deepseek-chat' }, [])).rejects.toThrow('已停用');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['aborted', 'insufficient_system_resource', 'content_filter'])(
  '未完成的 %s 响应不保存局部内容',
  async (reason) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result('{"text":"partial"}', reason)));
    await expect(chat(model, [])).rejects.toThrow('未完整生成');
  },
);
it('认证错误与服务错误不自动重试，不回显包含凭据的上游错误体', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: { message: model.key } }), { status: 401 }),
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(chat(model, [{ role: 'user', content: '连接' }])).rejects.toThrow('API Key 无效');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('空响应与截断内容不伪装成功', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(result(''))
    .mockResolvedValueOnce(result('{"incomplete":', 'length'));
  vi.stubGlobal('fetch', fetcher);
  await expect(chat(model, [])).rejects.toThrow('空内容');
  await expect(chat(model, [], { json: true })).rejects.toThrow('截断');
  expect(() => parseJson('{bad')).toThrow('无法解析');
});
it('最多一次内容修复，仍无效则失败', async () => {
  const fetcher = vi.fn().mockImplementation(async () => result('{}'));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    generate(
      model,
      {
        name: '西红柿炒鸡蛋',
        aliases: [],
        minutes: 15,
        difficulty: '简单',
        summary: '',
        blocked: '',
      },
      '鸡蛋3个',
      defaultPreferences(),
      new AbortController().signal,
    ),
  ).rejects.toThrow('校验未通过');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const request = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(request.thinking.type).toBe('disabled');
  expect(request.max_tokens).toBe(6500);
  expect(request.messages.some((m: { content: string }) => m.content.includes(model.key))).toBe(
    false,
  );
});
it('修复明确数量冲突后才能返回完整内容', async () => {
  const wrong = structuredClone(contentExample);
  wrong.ingredients[0].quantity = 200;
  const repaired = structuredClone(contentExample);
  repaired.steps[1].action = repaired.steps[1].action.replace('{{oil}}', '食用油');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(result(JSON.stringify(wrong)))
    .mockResolvedValueOnce(result(JSON.stringify(repaired)));
  vi.stubGlobal('fetch', fetcher);
  const content = await generate(
    model,
    {
      name: '西红柿炒鸡蛋',
      aliases: [],
      minutes: 15,
      difficulty: '简单',
      summary: '',
      blocked: '',
    },
    '番茄400g，鸡蛋3个',
    defaultPreferences(),
    new AbortController().signal,
  );
  expect(content.ingredients[0].quantity).toBe(400);
  expect(renderAction(content, content.steps[1])).toContain('食用油 5ml');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
const candidate = {
  name: '西红柿炒鸡蛋',
  aliases: [],
  minutes: 15,
  difficulty: '简单' as const,
  summary: '',
  blocked: '',
};
it('生成时补齐备菜及 sear/combine 漏写的用量引用，按分配渲染且不请求模型修复', async () => {
  const guide = structuredClone(contentExample);
  guide.prep[0].action = guide.prep[0].action.replace('{{salt}}', '盐');
  guide.steps[0].id = 'sear';
  guide.steps[1].id = 'combine';
  guide.steps[1].dependsOn = ['sear'];
  for (const step of guide.steps) step.action = step.action.replace('{{oil}}', '食用油');
  expect(() => validateContent(guide)).toThrow('combine 的用量必须通过 {{oil}} 引用');
  const fetcher = vi.fn().mockResolvedValue(result(JSON.stringify(guide)));
  vi.stubGlobal('fetch', fetcher);
  const content = await generate(
    model,
    candidate,
    '番茄400g，鸡蛋3个',
    defaultPreferences(),
    new AbortController().signal,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(validateContent(content)).toEqual(content);
  expect(content.ingredients).toEqual(guide.ingredients);
  expect(content.prep[0].uses).toEqual(guide.prep[0].uses);
  expect(content.prep[0].action).toBe(`${guide.prep[0].action}\n本步用量：{{salt}}。`);
  expect(renderAction(content, content.prep[0])).toContain('本步用量：盐 1g。');
  expect(renderAction(content, content.steps[0])).toContain('本步用量：食用油 10ml。');
  expect(renderAction(content, content.steps[1])).toContain('本步用量：食用油 5ml。');
  expect(content.steps.map((step) => step.uses)).toEqual(guide.steps.map((step) => step.uses));
  content.ingredients[2].quantity = 30;
  expect(renderAction(content, content.steps[1])).toContain('食用油 10ml');
});
it('完整引用和零比例的处理操作保持原样，定性用量也可补齐', async () => {
  const qualitative = structuredClone(contentExample);
  qualitative.ingredients[2].quantity = null;
  qualitative.ingredients[2].amountText = '适量（薄薄覆盖锅底）';
  qualitative.steps[0].action = qualitative.steps[0].action.replace('{{oil}}', '油');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(result(JSON.stringify(contentExample)))
    .mockResolvedValueOnce(result(JSON.stringify(qualitative)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await generate(model, candidate, '', defaultPreferences(), new AbortController().signal),
  ).toEqual(contentExample);
  const content = await generate(
    model,
    candidate,
    '',
    defaultPreferences(),
    new AbortController().signal,
  );
  expect(renderAction(content, content.steps[0])).toContain('食用油 适量（薄薄覆盖锅底）');
  expect(content.prep).toEqual(qualitative.prep);
  expect(content.steps[1]).toEqual(qualitative.steps[1]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['total', 'unknown', 'reference', 'hardcoded', 'restriction'])(
  '补齐引用仍拒绝不一致内容：%s',
  async (problem) => {
    const guide = structuredClone(contentExample);
    guide.steps[1].action = guide.steps[1].action.replace('{{oil}}', '食用油');
    const preferences = defaultPreferences();
    let expected: string;
    switch (problem) {
      case 'total':
        guide.steps[1].uses[0].fraction = 1;
        expected = '用量分配之和不等于 1';
        break;
      case 'unknown':
        guide.steps[1].uses.push({ ingredientId: 'missing', fraction: 1 });
        expected = '不存在的食材';
        break;
      case 'reference':
        guide.steps[1].action += '{{egg}}';
        expected = '文字引用缺少用量表';
        break;
      case 'hardcoded':
        guide.steps[1].action += '再加入10ml油';
        expected = '不得硬编码食材用量';
        break;
      default:
        preferences.avoidances = '鸡蛋';
        expected = '忌口冲突';
    }
    const fetcher = vi.fn().mockImplementation(async () => result(JSON.stringify(guide)));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      generate(model, candidate, '', preferences, new AbortController().signal),
    ).rejects.toThrow(expected);
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it('真实 deepseek-flash 返回样本通过当前严格规则，回归测试不再调用模型', () => {
  const content = validateContent(realContent, { ...defaultPreferences(), avoidances: '辣椒' });
  expect(validateRequestedAmounts(content, '番茄400g、鸡蛋3个')).toEqual(content);
  expect(content.steps.length).toBeGreaterThan(0);
});
