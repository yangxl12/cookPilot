import { recipes } from './data';
import type { Guide, Preferences, Recipe, RecipeId } from './data';

export type Recommendation = { recipe: Recipe; savedId?: string; reason: string; blocked?: string };
export type DiscoveryResult =
  | { kind: 'chat'; text: string }
  | { kind: 'recipes'; text: string; candidates: Recommendation[] };
export type DiscoveryTurn = { id: string; prompt: string; result?: DiscoveryResult };

const aliases: Record<RecipeId, string[]> = {
  chicken: ['宫保鸡丁', '宫爆鸡丁', '鸡丁', '鸡胸', '鸡肉'],
  eggs: ['番茄炒蛋', '西红柿炒鸡蛋', '西红柿炒蛋', '番茄', '西红柿', '鸡蛋'],
  beef: ['土豆炖牛肉', '土豆烧牛肉', '牛腩', '牛肉', '土豆'],
  pasta: ['番茄罗勒意面', '意大利面', '意面', '番茄', '西红柿'],
  curry: ['日式咖喱鸡', '咖喱鸡', '咖喱', '鸡肉', '土豆', '胡萝卜'],
  omelette: ['法式蘑菇煎蛋', '蘑菇煎蛋', '煎蛋', '蘑菇', '鸡蛋'],
};

export function findSavedRecipe(recipe: Recipe, guides: Guide[]) {
  return guides.find((g) => g.source === 'ai' && g.recipe.id === recipe.id);
}

export function parseAvoidances(text: string) {
  return text.split(/[，,、；;\n]/).map((value) => value.trim()
    .replace(/^(?:不吃|不要|不放|忌口[:：]?)/, '').replace(/过敏$/, '')).filter(Boolean);
}

export function recipeConflict(recipe: Recipe, preferences: Preferences, prompt: string, saved = false) {
  const avoidances = parseAvoidances(preferences.avoidances);
  // This is deliberately a small local fixture, not a general allergy classifier.
  for (const name of ['花生', '鸡蛋', '牛肉', '鸡肉', '蘑菇', '小葱', '番茄', '土豆']) {
    if (new RegExp(`${name}.{0,3}过敏|(?:不吃|不要|不放)${name}`).test(prompt)) avoidances.push(name);
  }
  const conflict = recipe.ingredients.find((item) => avoidances.some((avoid) => item.name.includes(avoid))
    && (saved || !['peanuts', 'scallion'].includes(item.id)));
  return conflict ? `这道菜含${conflict.name}，与当前忌口冲突，请选择其他菜谱` : undefined;
}

function chatReply(prompt: string) {
  if (/你好|您好|hello|hi\b/i.test(prompt)) return '你好！今天有什么想聊的？';
  if (/谢谢/.test(prompt)) return '不客气，有问题可以继续聊。';
  if (/天气|下雨|气温/.test(prompt)) return '我没有实时天气数据，无法判断今天是否下雨。可以查看天气应用中的逐小时预报，出门前再确认一下。';
  if (/周末|旅行|旅游/.test(prompt)) return '周末可以安排半天户外散步、半天看展或阅读，留一点时间休息。你更想放松，还是去探索一个新地方？';
  if (/编程|代码|前端|网页|页面|界面|javascript|python/i.test(prompt)) return '做一个网页可以先确定用途和主要内容，再用 HTML 组织结构、CSS 调整样式、JavaScript 添加交互。你想做什么类型的页面？';
  if (/月亮|月球/.test(prompt)) return '月亮本身不发光，我们看到的是它反射的太阳光。随着月球绕地球运行，从地球上看到的受光部分改变，就形成了月相。';
  if (/^(\d+)\s*([+＋\-×*])\s*(\d+)[？?=\s]*$/.test(prompt)) {
    const [, a, op, b] = prompt.match(/^(\d+)\s*([+＋\-×*])\s*(\d+)/)!;
    return `${a} ${op} ${b} = ${['+', '＋'].includes(op) ? Number(a) + Number(b) : op === '-' ? Number(a) - Number(b) : Number(a) * Number(b)}。`;
  }
  return '你想了解哪一方面？可以补充具体问题或使用场景，我接着和你聊。';
}

/** Local demo routing and recommendations. No model or network calls. */
export function discover(prompt: string, guides: Guide[], preferences: Preferences): DiscoveryResult {
  const text = prompt.trim();
  const unrelatedTopic = /股票|股市|炒股|编程|代码|前端|网页|页面|界面|python|javascript/i.test(text)
    && !/做菜|做饭|菜谱|食材|下厨/.test(text);
  const isCooking = !unrelatedTopic && (
    /菜|食材|做饭|下厨|吃|饿|餐|饭|炒|炖|煮|煎|烤|口味|清淡|快手|下饭|冰箱|减脂|肉|蛋|番茄|西红柿|土豆|蘑菇|意面|面条|咖喱|宫保|宫爆|辣|葱|豆腐|白菜|黄瓜|虾|鱼|茄子/.test(text)
    || Object.values(aliases).flat().some((alias) => text.includes(alias))
  );
  if (!isCooking) return { kind: 'chat', text: chatReply(text) };

  const ranked = recipes.map((recipe, index) => {
    const saved = findSavedRecipe(recipe, guides);
    const exact = aliases[recipe.id].slice(0, 2).some((alias) => text.includes(alias) && alias.length >= 4);
    const matched = aliases[recipe.id].filter((alias) => text.includes(alias));
    let score = exact ? 100 : matched.length * 10;
    if (/快|简单|懒|没时间/.test(text)) score += recipe.minutes <= 20 ? 8 : 0;
    if (/清淡|不辣/.test(text)) score += recipe.tags.includes('不辣') ? 6 : 0;
    const blocked = recipeConflict(saved?.recipe || recipe, preferences, text, !!saved);
    return { recipe: saved?.recipe || recipe, savedId: saved?.id, blocked, score, index,
      reason: exact ? '符合你想做的菜' : matched.length ? `用得上${matched.filter((word) => word.length <= 3).join('、') || matched[0]}`
        : recipe.minutes <= 20 ? '步骤简单，适合快手做一餐' : '换个口味的家常选择' };
  }).sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.score - a.score || a.index - b.index);

  // Keep an explicitly requested conflicting dish visible with a reason, but never selectable.
  const explicitBlocked = ranked.find((item) => item.blocked && item.score >= 100);
  const candidates = explicitBlocked ? [explicitBlocked, ...ranked.filter((item) => !item.blocked).slice(0, 2)]
    : ranked.filter((item) => !item.blocked).slice(0, 3);
  const matched = ranked.some((item) => item.score >= 10);
  return { kind: 'recipes', text: !candidates.length ? '这几道示例菜都与当前忌口冲突。可以换些食材再试试。'
    : explicitBlocked ? '你想做的菜与当前忌口冲突，也为你列出其他选择。'
    : matched ? '根据你的想法，选了这几道菜。选一道，再展开完整做法。'
    : '先给你几道家常菜找找灵感。Demo 使用示例推荐，可继续补充食材或口味。', candidates };
}
