import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { format } from 'prettier';

// Preserve source instructions and mixed/qualitative quantities. No model requests.
const source = await readFile(new URL('../docs/中外经典家常菜200道.md', import.meta.url), 'utf8');
const matches = [
  ...source.matchAll(/^#### ([CF]\d{3}) (.+)\r?\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm),
];
const catalog = [];
const culinaryHeat = /锅|热油|烧热|煮|蒸|烤|煎|炸|炒|焯|烫|炖|电饭煲|微波/;
function seconds(text) {
  const match = text.match(/(?:约)?(\d+)(?:[—–-](\d+))?(分钟|秒|小时)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[3] === '小时' ? 3600 : match[3] === '分钟' ? 60 : 1));
}
function ingredient(text, index, group) {
  const cleaned = text.trim().replace(/[。.]$/, '');
  const m = cleaned.match(
    /^(.+?)(\d+(?:\.\d+)?)(g|ml|克|毫升|个|根|瓣|片|只|条|张|颗|块|枚)([^\d]*)$/i,
  );
  if (m)
    return {
      id: `i${index}`,
      name: m[1],
      quantity: +m[2],
      unit: m[3],
      amountText: '',
      group,
      note: m[4],
    };
  const boundary = cleaned.search(/[\d半一两三四五六七八九十适少]/);
  return {
    id: `i${index}`,
    name: boundary > 0 ? cleaned.slice(0, boundary) : cleaned,
    quantity: null,
    unit: '',
    amountText: boundary > 0 ? cleaned.slice(boundary) : '见原资料用量',
    group,
    note: '',
  };
}
for (const [, number, title, body] of matches) {
  const time = body.match(/\*\*用时\*\*：([^\r\n]+)/)?.[1] ?? '30分钟';
  const material = body.match(/\*\*食材与调料\*\*：([^\r\n]+)/)?.[1];
  const rawSteps = [...body.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1].trim());
  const key = body.match(/\*\*要点\*\*：([^\r\n]+)/)?.[1];
  const url = body.match(/\*\*参考来源\*\*：[\s\S]*?\]\((https?:\/\/[^)]+)\)/)?.[1];
  if (!material || !rawSteps.length || !key || !url)
    throw new Error(`${number} missing source fields`);
  const ingredients = material
    .split('；')
    .flatMap((part, groupIndex) =>
      part.split('、').map((token) => ({ token, group: groupIndex === 0 ? '主料' : '调味' })),
    )
    .filter((x) => x.token.trim())
    .map((x, i) => ingredient(x.token, i, x.group));
  // Some source instructions include explicit water not listed in the ingredient line.
  const extraWater =
    rawSteps.join(' ').match(/(?:加|及|用|兑)(\d+)ml(?:的)?(?:温|热|凉|清)?水/g) ?? [];
  if (!ingredients.some((i) => /水$/.test(i.name)) && extraWater.length)
    ingredients.push({
      id: `i${ingredients.length}`,
      name: '步骤用水',
      quantity: null,
      unit: '',
      amountText: extraWater.join('；'),
      group: '调味',
      note: '按原文步骤分次使用；焯水与煮面水另备',
    });
  let firstHeat = rawSteps.findIndex((s) => culinaryHeat.test(s));
  if (firstHeat < 0) firstHeat = Math.max(1, rawSteps.length - 1);
  if (firstHeat === 0) firstHeat = 1;
  const prepare = rawSteps.slice(0, firstHeat);
  const cooking = rawSteps.slice(firstHeat);
  if (!cooking.length) throw new Error(`${number} no cooking action`);
  const makeAction = (action, i, kind) => ({
    id: `${kind}${i + 1}`,
    title: action.split(/[；，。]/)[0].slice(0, 18),
    action,
    uses: ingredients
      .filter((x) => action.includes(x.name))
      .map((x) => ({ ingredientId: x.id, fraction: 0 })),
    seconds: seconds(action),
  });
  const prep = prepare.map((a, i) => ({ ...makeAction(a, i, 'p'), parallel: '' }));
  const steps = cooking.map((a, i) => ({
    ...makeAction(a, i, 's'),
    heat: a.match(/大火|中小火|中火|小火|文火|中大火/)?.[0] ?? '',
    signal:
      a.match(/(?:至|直到|待)([^。；]+)[。；]?/)?.[1] ??
      (i === cooking.length - 1 ? key : '按本步动作观察食材变化；时间仅供参考。'),
    tip: i === cooking.length - 1 ? key : '',
    dependsOn: i ? [`s${i}`] : [],
  }));
  let cookware = !culinaryHeat.test(rawSteps.join(''))
    ? ['无需加热']
    : /烤箱|烤盘|预热.*度/.test(rawSteps.join(''))
      ? ['烤箱']
      : /蒸锅|蒸笼|隔水蒸/.test(rawSteps.join(''))
        ? ['蒸锅']
        : /电饭煲/.test(rawSteps.join(''))
          ? ['电饭煲']
          : /平底锅/.test(rawSteps.join(''))
            ? ['平底锅']
            : /炖|汤锅/.test(rawSteps.join('')) || /汤|羹/.test(title)
              ? ['汤锅']
              : ['炒锅'];
  const primaryTime = time.split('，')[0];
  const minutes = /小时/.test(primaryTime)
    ? (parseFloat(primaryTime.replace(/[^\d.]/g, '')) || 2) * 60
    : parseInt(primaryTime.replace(/[^\d]/g, '')) || 30;
  const content = {
    schemaVersion: 1,
    title,
    aliases: number === 'C001' ? ['番茄炒蛋', '番茄炒鸡蛋'] : [],
    cuisine: number.startsWith('C') ? '中式' : '西式与日式',
    minutes: Math.min(2880, minutes),
    difficulty: minutes > 45 ? '适中' : '简单',
    conditions: `原资料常规一份菜；${time.replace(/。$/, '')}`,
    cookware,
    keyPoints: [key],
    ingredients,
    prep,
    steps,
  };
  catalog.push({
    id: number.toLowerCase(),
    sourceNumber: number,
    sourceUrl: url,
    sourceText: `食材与调料：${material}\n${rawSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n要点：${key}`,
    contentVersion: 1,
    content,
  });
}
if (catalog.length !== 200 || new Set(catalog.map((c) => c.id)).size !== 200)
  throw new Error(`Expected 200 unique recipes, got ${catalog.length}`);
await mkdir(new URL('../src/assets/recipes/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../src/assets/recipes/catalog.json', import.meta.url),
  await format(JSON.stringify(catalog), { parser: 'json', printWidth: 100 }),
);
console.log(
  `Converted ${catalog.length} recipes; source instructions preserved. No AI tokens used.`,
);
