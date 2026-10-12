export type RecipeId = 'chicken' | 'eggs' | 'beef' | 'pasta' | 'curry' | 'omelette';
export type View = 'home' | 'recipes' | 'overview' | 'cook' | 'finish' | 'library' | 'settings';
export type Conditions = {
  servings: number;
  amount: number;
  taste: string;
  allergies: string[];
  cookware: string;
  cookwares?: string[];
};
export type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  group: '主料' | '调味';
  note?: string;
};
export type Step = {
  id: string;
  title: string;
  action: string;
  uses: string[];
  heat?: string;
  seconds?: number;
  signal: string;
  tip: string;
  why: string;
};
export type Prep = {
  id: string;
  title: string;
  detail: string;
  uses: string[];
  parallel?: string;
  seconds?: number;
};
export type Recipe = {
  id: RecipeId;
  title: string;
  subtitle: string;
  cuisine?: string;
  image: string;
  minutes: number;
  level: string;
  tags: string[];
  main: string;
  mainAmount: number;
  ingredients: Ingredient[];
  tools: string[];
  key: string;
  prep: Prep[];
  steps: Step[];
  signals: { title: string; detail: string }[];
};
export type Guide = {
  id: string;
  recipe: Recipe;
  conditions: Conditions;
  checked: string[];
  currentStep: number;
  completed: string[];
  status: 'ready' | 'cooking' | 'finished';
  favorite: boolean;
  note: string;
  rating: number;
  createdAt: string;
  changes: string[];
  version: number;
};
export type Timer = {
  id: string;
  guideId: string;
  stepId: string;
  name: string;
  total: number;
  remaining: number;
  endAt: number | null;
  notified: boolean;
};
export type Model = { id: string; name: string; url: string; key: string; model: string };
export type State = {
  guides: Guide[];
  activeId: string | null;
  timers: Timer[];
  models: Model[];
  modelId: string;
  preferences: Preferences;
};
export type Preferences = { avoidances: string; taste: string; cookware: string[] };
export const defaultPreferences = (): Preferences => ({ avoidances: '', taste: '', cookware: [] });

const i = (
  id: string,
  name: string,
  quantity: number,
  unit: string,
  group: Ingredient['group'] = '调味',
  note?: string,
): Ingredient => ({ id, name, quantity, unit, group, note });

export const recipes: Recipe[] = [
  {
    id: 'chicken',
    title: '宫保鸡丁',
    subtitle: '鸡肉嫩、花生脆，刚刚好的小荔枝口',
    image: '/images/kung-pao.jpg',
    minutes: 25,
    level: '有点挑战',
    tags: ['经典下饭菜', '微辣', '两人食'],
    main: '鸡胸肉',
    mainAmount: 300,
    ingredients: [
      i('chicken', '鸡胸肉', 300, 'g', '主料'),
      i('peanuts', '熟花生', 40, 'g', '主料'),
      i('scallion', '大葱', 30, 'g', '主料'),
      i('chili', '干辣椒', 3, '个'),
      i('pepper', '花椒', 1, 'g'),
      i('ginger', '生姜', 10, 'g'),
      i('garlic', '蒜', 10, 'g'),
      i('soy', '生抽', 15, 'ml'),
      i('vinegar', '米醋', 15, 'ml'),
      i('sugar', '白糖', 12, 'g'),
      i('starch', '玉米淀粉', 8, 'g'),
      i('wine', '料酒', 10, 'ml'),
      i('water', '清水', 25, 'ml'),
      i('oil', '食用油', 25, 'ml', '调味', '使用非花生油'),
      i('salt', '盐', 1, 'g'),
    ],
    tools: ['炒锅 / 不粘锅', '锅铲', '砧板与刀', '两个小碗'],
    key: '先调好碗汁，炒鸡丁时不离开灶台。花生最后放，才能保持酥脆。',
    prep: [
      {
        id: 'cut',
        title: '切鸡丁与配料',
        detail: '鸡肉切成约 1.5 cm 的小丁；葱切小段，姜蒜切片，干辣椒剪段。生肉与熟食分开处理。',
        uses: ['chicken', 'scallion', 'ginger', 'garlic', 'chili'],
      },
      {
        id: 'marinate',
        title: '腌制鸡丁',
        detail: '鸡丁加入全部料酒、盐，以及 1/3 生抽、1/2 淀粉、1/5 食用油，抓匀腌制 10 分钟。',
        uses: ['wine', 'salt', 'soy', 'starch', 'oil'],
        seconds: 600,
        parallel: '等待腌制时，完成下面的调汁。',
      },
      {
        id: 'sauce',
        title: '调宫保汁',
        detail: '剩余生抽、淀粉与全部米醋、糖、清水混匀。下锅前再搅一次，防止淀粉沉底。',
        uses: ['soy', 'vinegar', 'sugar', 'starch', 'water'],
        parallel: '可与腌制同时进行',
      },
      {
        id: 'tools',
        title: '准备花生与餐具',
        detail: '熟花生单独放一碗，配料与碗汁摆在灶台旁；准备干净的盛菜盘。',
        uses: ['peanuts', 'pepper', 'oil'],
      },
    ],
    steps: [
      {
        id: 'heat',
        title: '热锅放油',
        action: '锅中倒入剩余 4/5 食用油，轻轻转动锅，让油均匀铺开。使用不粘锅时不要长时间空烧。',
        uses: ['oil'],
        heat: '中火',
        seconds: 30,
        signal: '油变得流动轻快，锅底有细小油纹，还没有明显冒烟。',
        tip: '油冒烟就太热了，先离火稍降温再下鸡丁。',
        why: '锅和油提前升温，能帮助鸡肉快速定形，减少粘锅和出水。',
      },
      {
        id: 'chicken',
        title: '滑炒鸡丁',
        action:
          '倒入腌好的鸡丁，铺开约 20 秒后再翻炒。炒至表面全部变白，先盛出备用，稍后还会回锅炒熟。',
        uses: ['chicken'],
        heat: '中大火',
        seconds: 90,
        signal: '鸡丁表面变白、颗粒分开；此时还未完全熟，不要试吃。',
        tip: '一次下锅过多会降温。锅小或超过 3 人份时，分两批炒。',
        why: '先炒后盛出，能避免鸡丁与配料一起长时间加热，口感更嫩。',
      },
      {
        id: 'aromatics',
        title: '小火炒香配料',
        action: '锅内留底油，放入干辣椒、花椒、姜蒜片，轻轻翻炒，再加入葱段炒出香味。',
        uses: ['chili', 'pepper', 'ginger', 'garlic', 'scallion'],
        heat: '小火',
        seconds: 30,
        signal: '闻到姜蒜和辣椒的香味，辣椒变深红但没有发黑。',
        tip: '辣椒容易糊。变黑或闻到苦味，取出后再继续。',
        why: '小火让香气慢慢释放，不会把辣椒和花椒炒苦。',
      },
      {
        id: 'sauce',
        title: '鸡丁回锅调味',
        action: '鸡丁倒回锅中，转中大火；搅匀碗汁，沿锅边淋入，快速翻炒，让酱汁均匀裹住鸡丁。',
        uses: ['chicken', 'soy', 'vinegar', 'sugar', 'starch', 'water'],
        heat: '中大火',
        seconds: 60,
        signal:
          '酱汁变亮、略微浓稠，切开最大一块鸡肉，中心不透明、没有粉红色；有温度计时确认中心达到 74°C。',
        tip: '汁收得太快时，每次加 5 ml 热水；鸡肉未熟时继续加热并复查。',
        why: '淀粉遇热后糊化，让碗汁形成薄薄的芡，挂在鸡丁上。',
      },
      {
        id: 'finish',
        title: '放花生，翻匀出锅',
        action: '加入熟花生，快速翻匀后立即关火装盘，趁热享用。',
        uses: ['peanuts'],
        heat: '关火前快速翻炒',
        seconds: 10,
        signal: '鸡丁均匀裹汁，盘底没有大量流动汤汁，花生仍然酥脆。',
        tip: '花生不要在酱汁里久煮，否则会失去脆口。',
        why: '花生吸水会变软，临出锅时加入能保留口感。',
      },
    ],
    signals: [
      {
        title: '鸡肉熟透',
        detail: '切开最大一块，中心不透明、没有粉红色；有食物温度计时，中心温度达到 74°C。',
      },
      { title: '酱汁均匀包裹', detail: '酱汁亮而薄，均匀挂在鸡丁上，盘底只有少量汁。' },
      { title: '鸡肉嫩、花生脆', detail: '鸡肉嫩、花生脆，入口咸鲜，随后有轻微酸甜与辣味。' },
    ],
  },
  {
    id: 'eggs',
    title: '番茄炒蛋',
    subtitle: '软嫩的蛋，裹上酸甜的番茄汁',
    image: '/images/tomato-eggs.jpg',
    minutes: 15,
    level: '新手友好',
    tags: ['快手家常', '不辣', '两人食'],
    main: '番茄',
    mainAmount: 300,
    ingredients: [
      i('tomato', '番茄', 300, 'g', '主料'),
      i('eggs', '鸡蛋', 3, '个', '主料'),
      i('scallion', '小葱', 5, 'g'),
      i('oil', '食用油', 20, 'ml'),
      i('salt', '盐', 2, 'g'),
      i('sugar', '白糖', 3, 'g'),
      i('water', '清水', 30, 'ml'),
    ],
    tools: ['炒锅 / 不粘锅', '锅铲', '砧板与刀', '打蛋碗'],
    key: '鸡蛋先炒后盛出；等番茄炒出汁，再让它们汇合。',
    prep: [
      {
        id: 'cut',
        title: '切番茄和小葱',
        detail: '番茄去蒂，切成约 2 cm 的块；小葱切成葱花。',
        uses: ['tomato', 'scallion'],
      },
      {
        id: 'eggs',
        title: '打散鸡蛋',
        detail: '鸡蛋打入碗中，加入 1/4 的盐，搅拌至没有明显蛋清条。',
        uses: ['eggs', 'salt'],
      },
      {
        id: 'tools',
        title: '准备调料与餐具',
        detail: '备好剩余盐、糖、清水与食用油，准备一个临时盛蛋的干净碗。',
        uses: ['salt', 'sugar', 'water', 'oil'],
      },
    ],
    steps: [
      {
        id: 'eggs',
        title: '炒鸡蛋',
        action: '中火热锅，倒入 3/5 食用油，油热后倒入蛋液。边缘凝固时轻推，炒成大块后盛出。',
        uses: ['eggs', 'oil'],
        heat: '中火',
        seconds: 45,
        signal: '鸡蛋成形但表面仍有光泽，没有流动的生蛋液。',
        tip: '鸡蛋还要回锅，不要炒到焦黄。',
        why: '蛋液受热会持续凝固，提前盛出可以避免口感过老。',
      },
      {
        id: 'tomato',
        title: '炒番茄',
        action: '锅中加入剩余 2/5 食用油，倒入番茄翻炒。加入剩余盐与全部糖，倒入清水，小火煮出汁。',
        uses: ['tomato', 'oil', 'salt', 'sugar', 'water'],
        heat: '中火转小火',
        seconds: 180,
        signal: '番茄边缘变软，锅底出现红色汤汁，仍保留一些块状。',
        tip: '番茄出汁少时，可以用锅铲轻压几块。',
        why: '盐能帮助番茄释放水分，让汤汁自然形成。',
      },
      {
        id: 'combine',
        title: '鸡蛋回锅翻匀',
        action: '把鸡蛋倒回锅中，轻轻翻拌，等每块鸡蛋都裹上番茄汁。',
        uses: ['eggs', 'tomato'],
        heat: '中小火',
        seconds: 45,
        signal: '鸡蛋与番茄整体热透，蛋块仍软嫩，汤汁稍浓。',
        tip: '轻推翻拌即可，不要把鸡蛋全部铲碎。',
        why: '短时间回锅既能吸收味道，也能保留鸡蛋蓬松的口感。',
      },
      {
        id: 'finish',
        title: '撒葱花出锅',
        action: '撒入葱花，翻匀后关火，盛入干净的盘中。',
        uses: ['scallion'],
        signal: '红黄相间，鸡蛋软嫩，番茄有汁但不是水汪汪的一盘。',
        tip: '如果偏酸，下次可以换更成熟的番茄。',
        why: '最后加葱，保留清新的葱香。',
      },
    ],
    signals: [
      { title: '鸡蛋软嫩且熟透', detail: '没有流动的生蛋液，切开蛋块质地均匀。' },
      { title: '番茄软且成块', detail: '有自然的红色汤汁，番茄没有完全煮成泥。' },
      { title: '汤汁裹住蛋块', detail: '蛋块吸收番茄汁，盘底保留少量可拌饭的浓汁。' },
    ],
  },
  {
    id: 'beef',
    title: '土豆炖牛肉',
    subtitle: '留一点时间，换一锅软糯入味',
    image: '/images/beef-potato.jpg',
    minutes: 95,
    level: '耐心慢炖',
    tags: ['暖心炖菜', '不辣', '两人食'],
    main: '牛腩',
    mainAmount: 400,
    ingredients: [
      i('beef', '牛腩', 400, 'g', '主料'),
      i('potato', '土豆', 250, 'g', '主料'),
      i('ginger', '生姜', 15, 'g'),
      i('scallion', '大葱', 20, 'g'),
      i('soy', '生抽', 20, 'ml'),
      i('darksoy', '老抽', 5, 'ml'),
      i('wine', '料酒', 15, 'ml'),
      i('sugar', '冰糖', 8, 'g'),
      i('oil', '食用油', 15, 'ml'),
      i('water', '热水', 800, 'ml'),
      i('anise', '八角', 1, '个'),
      i('salt', '盐', 1, 'g'),
    ],
    tools: ['带盖炒锅 / 炖锅', '锅铲', '砧板与刀', '滤网'],
    key: '牛肉先炖软，再放土豆。水量以刚没过食材为准，中途补热水。',
    prep: [
      {
        id: 'cut',
        title: '切牛腩与葱姜',
        detail: '牛腩切约 3 cm 块，清水冲洗；生姜切片，大葱切段。',
        uses: ['beef', 'ginger', 'scallion'],
      },
      {
        id: 'potato',
        title: '土豆去皮切块',
        detail: '土豆切成约 3 cm 块，泡入清水防止变色；下锅前沥干。',
        uses: ['potato'],
        parallel: '可在牛肉炖煮时完成',
      },
      {
        id: 'tools',
        title: '备好调味与热水',
        detail: '量好调味料，烧好热水，准备能盖严的锅盖。',
        uses: ['soy', 'darksoy', 'wine', 'sugar', 'oil', 'anise', 'salt', 'water'],
      },
    ],
    steps: [
      {
        id: 'blanch',
        title: '冷水焯牛肉',
        action:
          '牛肉冷水下锅，水没过牛肉。加入 1/3 姜片和全部料酒，煮开后撇去浮沫，捞出用温水冲净。焯水用水不计入炖煮用水。',
        uses: ['beef', 'ginger', 'wine'],
        heat: '大火煮开',
        seconds: 300,
        signal: '表面浮沫明显减少，牛肉表面变色。',
        tip: '焯水后用温水冲洗，避免牛肉骤冷。',
        why: '冷水开始加热，能帮助牛肉中的血水释放。',
      },
      {
        id: 'fry',
        title: '炒香配料与牛肉',
        action:
          '锅中加食用油，放剩余姜片、葱、八角炒香。倒入沥干的牛肉，加冰糖、生抽、老抽，翻炒均匀。',
        uses: ['oil', 'ginger', 'scallion', 'anise', 'beef', 'sugar', 'soy', 'darksoy'],
        heat: '中火',
        seconds: 120,
        signal: '牛肉表面均匀上色，闻到香料香气。',
        tip: '牛肉先沥干，避免热油飞溅。',
        why: '翻炒能让配料香气融入油中，后续炖煮更入味。',
      },
      {
        id: 'braise',
        title: '小火炖牛肉',
        action:
          '倒入热水至刚没过牛肉。大火烧开后转小火，盖盖炖约 60 分钟；每 20 分钟查看一次，水不足就补热水。',
        uses: ['water', 'beef'],
        heat: '大火烧开 → 小火',
        seconds: 3600,
        signal: '筷子能较容易插入牛肉，口感开始变软。未软就继续每 10 分钟检查。',
        tip: '保持轻微冒泡。计时只作参考，以牛肉软烂程度为准。',
        why: '温和且持续的加热，能让牛腩中的结缔组织逐渐软化。',
      },
      {
        id: 'potato',
        title: '加入土豆炖煮',
        action: '加入沥干的土豆和盐，轻轻推匀，继续加盖小火炖约 20 分钟。',
        uses: ['potato', 'salt'],
        heat: '小火',
        seconds: 1200,
        signal: '筷子轻松穿过土豆，边缘略松软但整体完整，牛肉已经软烂。',
        tip: '土豆还硬就继续炖，不要为了收汁提前出锅。',
        why: '土豆比牛肉更容易熟，后放能避免全部炖碎。',
      },
      {
        id: 'finish',
        title: '开盖收汁',
        action: '开盖转中火，轻推食材防止粘底。汤汁收浓后关火装盘，取出八角等大块香料。',
        uses: [],
        heat: '中火',
        seconds: 180,
        signal: '酱汁略浓，能挂在牛肉与土豆表面，盘中保留少量汤汁。',
        tip: '别收得过干，稍留汤汁更适合拌饭。',
        why: '开盖让水分蒸发，味道更集中。',
      },
    ],
    signals: [
      { title: '牛肉软烂', detail: '筷子可以较轻松插入，肉纤维软而不柴。' },
      { title: '土豆软且成块', detail: '没有硬芯，边缘稍松，但夹起时仍完整。' },
      { title: '汤汁浓稠', detail: '汁能挂在食材表面，锅底没有焦糊。' },
    ],
  },
];

recipes.push(
  {
    id: 'pasta',
    title: '番茄罗勒意面',
    subtitle: '',
    cuisine: '意式',
    image: '',
    minutes: 25,
    level: '简单',
    tags: ['意式', '酸甜'],
    main: '意大利面',
    mainAmount: 180,
    ingredients: [
      i('pasta', '意大利面', 180, 'g', '主料'),
      i('tomato', '番茄', 300, 'g', '主料'),
      i('garlic', '蒜', 10, 'g'),
      i('basil', '罗勒', 5, 'g'),
      i('oil', '橄榄油', 20, 'ml'),
      i('salt', '盐', 5, 'g'),
      i('cheese', '帕尔马干酪', 15, 'g'),
    ],
    tools: ['煮锅', '平底锅', '漏勺', '刀', '砧板'],
    key: '面条比包装时间少煮 1 分钟，留半碗面汤，最后在酱汁中拌熟。',
    prep: [
      {
        id: 'cut',
        title: '切番茄与蒜',
        detail: '番茄去蒂切丁，蒜切碎，罗勒洗净沥干。',
        uses: ['tomato', 'garlic', 'basil'],
      },
      {
        id: 'water',
        title: '准备煮面水',
        detail: '煮锅加入约 2 升水和 4 g 盐，剩余 1 g 盐留给酱汁。',
        uses: ['salt'],
      },
    ],
    steps: [
      {
        id: 'boil',
        title: '煮意面',
        action: '水沸后放入意面，按包装时间少煮 1 分钟。捞出前留半碗面汤。',
        uses: ['pasta'],
        heat: '中大火',
        seconds: 480,
        signal: '面条柔软，咬开中心还有一点硬芯。',
        tip: '包装建议时间优先，偶尔搅拌防粘。',
        why: '面条会在酱汁中继续吸水变熟。',
      },
      {
        id: 'sauce',
        title: '熬番茄酱',
        action: '平底锅加入橄榄油和蒜末，小火炒香后加入番茄丁和剩余盐，中火煮约 8 分钟。',
        uses: ['oil', 'garlic', 'tomato', 'salt'],
        heat: '小火 → 中火',
        seconds: 480,
        signal: '番茄软烂，酱汁稍浓。',
        tip: '蒜末微黄即可，避免炒焦。',
        why: '让番茄释放汁水，形成自然浓稠的酱汁。',
      },
      {
        id: 'combine',
        title: '拌面出锅',
        action: '加入意面和少量面汤，翻拌约 1 分钟。关火拌入罗勒，撒上干酪。',
        uses: ['basil', 'cheese'],
        heat: '中火',
        seconds: 60,
        signal: '面条无硬芯，每根均匀裹上酱汁。',
        tip: '面汤少量多次加，避免汤汁过多。',
        why: '面汤中的淀粉帮助酱汁附着在面条上。',
      },
    ],
    signals: [
      { title: '面条熟透', detail: '咬开没有硬芯，仍有弹性。' },
      { title: '酱汁均匀', detail: '酱汁包裹面条，盘底没有大量水分。' },
    ],
  },
  {
    id: 'curry',
    title: '日式咖喱鸡',
    subtitle: '',
    cuisine: '日式',
    image: '',
    minutes: 35,
    level: '简单',
    tags: ['日式', '浓郁'],
    main: '鸡腿肉',
    mainAmount: 300,
    ingredients: [
      i('curry', '鸡腿肉', 300, 'g', '主料'),
      i('potato', '土豆', 200, 'g', '主料'),
      i('carrot', '胡萝卜', 100, 'g', '主料'),
      i('onion', '洋葱', 150, 'g', '主料'),
      i('roux', '咖喱块', 40, 'g'),
      i('water', '清水', 450, 'ml'),
      i('oil', '食用油', 15, 'ml'),
    ],
    tools: ['带盖炖锅', '锅铲', '刀', '砧板'],
    key: '关火后再放咖喱块，搅匀后小火煮浓，避免粘底。',
    prep: [
      {
        id: 'cut',
        title: '切好食材',
        detail: '鸡腿肉切约 3 cm 块，土豆、胡萝卜切小块，洋葱切片。生肉与蔬菜分开处理。',
        uses: ['curry', 'potato', 'carrot', 'onion'],
      },
    ],
    steps: [
      {
        id: 'fry',
        title: '炒鸡肉与洋葱',
        action: '锅中放油，中火炒软洋葱，再加入鸡肉翻炒至表面变白。',
        uses: ['oil', 'onion', 'curry'],
        heat: '中火',
        seconds: 240,
        signal: '洋葱变软，鸡肉表面变白。',
        tip: '此时鸡肉还没熟透，继续炖煮。',
        why: '先炒香洋葱，让汤底更香甜。',
      },
      {
        id: 'simmer',
        title: '炖煮蔬菜',
        action: '加入土豆、胡萝卜与清水，煮开后转小火，盖盖炖约 18 分钟。',
        uses: ['potato', 'carrot', 'water'],
        heat: '大火烧开 → 小火',
        seconds: 1080,
        signal: '土豆可被筷子轻松穿过，鸡肉中心熟透。',
        tip: '水量以刚没过食材为准。',
        why: '先把食材炖熟，再加咖喱，避免浓汤长时间粘底。',
      },
      {
        id: 'finish',
        title: '加入咖喱煮浓',
        action: '关火，放入咖喱块搅匀至融化。再开小火煮约 5 分钟，持续轻推锅底。',
        uses: ['roux'],
        heat: '小火',
        seconds: 300,
        signal: '汤汁浓稠，能包裹食材。',
        tip: '咖喱块已有盐分，先尝味再决定是否加盐。',
        why: '小火搅拌使咖喱均匀融化，避免糊底。',
      },
    ],
    signals: [
      { title: '鸡肉熟透', detail: '最大一块切开，中心无生肉质感。' },
      { title: '蔬菜软糯', detail: '土豆和胡萝卜没有硬芯。' },
      { title: '咖喱浓稠', detail: '汤汁均匀，无结块和焦糊味。' },
    ],
  },
  {
    id: 'omelette',
    title: '法式蘑菇煎蛋',
    subtitle: '',
    cuisine: '法式',
    image: '',
    minutes: 15,
    level: '简单',
    tags: ['法式', '咸鲜'],
    main: '蘑菇',
    mainAmount: 150,
    ingredients: [
      i('omelette', '蘑菇', 150, 'g', '主料'),
      i('egg', '鸡蛋', 3, '个', '主料'),
      i('butter', '黄油', 15, 'g'),
      i('salt', '盐', 2, 'g'),
      i('peppercorn', '黑胡椒', 0.5, 'g'),
    ],
    tools: ['不粘平底锅', '锅铲', '搅拌碗', '刀', '砧板'],
    key: '蘑菇先炒干水分；倒入蛋液后用小火，凝固后及时折叠。',
    prep: [
      {
        id: 'cut',
        title: '切蘑菇、打蛋',
        detail: '蘑菇擦净切片。鸡蛋打散，加入盐和黑胡椒。',
        uses: ['omelette', 'egg', 'salt', 'peppercorn'],
      },
    ],
    steps: [
      {
        id: 'mushroom',
        title: '炒香蘑菇',
        action: '锅中融化一半黄油，加入蘑菇，中火炒约 4 分钟后盛出。',
        uses: ['butter', 'omelette'],
        heat: '中火',
        seconds: 240,
        signal: '蘑菇变软，析出的水分基本蒸发。',
        tip: '水分炒干，煎蛋才不会湿塌。',
        why: '蘑菇提前炒熟，避免蛋液凝固后蘑菇仍夹生。',
      },
      {
        id: 'egg',
        title: '小火煎蛋',
        action: '转小火融化剩余黄油，倒入蛋液。轻推凝固的边缘，让蛋液流向空隙。',
        uses: ['butter', 'egg'],
        heat: '小火',
        seconds: 120,
        signal: '蛋液基本凝固，表面没有流动蛋液。',
        tip: '不要开大火，底部容易焦硬。',
        why: '温和加热让蛋块细嫩、受热均匀。',
      },
      {
        id: 'fold',
        title: '放蘑菇、折叠',
        action: '把蘑菇放在蛋饼一侧，对折后小火加热约 30 秒，确认蛋液完全凝固后装盘。',
        uses: [],
        heat: '小火',
        seconds: 30,
        signal: '蛋饼可以整体滑动，内部没有流动蛋液。',
        tip: '用宽锅铲轻轻折叠。',
        why: '最后折叠能包住馅料，保留完整外形。',
      },
    ],
    signals: [
      { title: '蛋液凝固', detail: '内部没有流动的生蛋液。' },
      { title: '蘑菇鲜嫩', detail: '蘑菇熟软，盘底没有大量水分。' },
    ],
  },
);

export const defaultConditions = (r: Recipe): Conditions => ({
  servings: 2,
  amount: r.mainAmount,
  taste: r.id === 'chicken' ? '微辣' : '原味',
  allergies: [],
  cookware: r.id === 'beef' ? '带盖炖锅' : '不粘锅',
});
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const quantity = (item: Ingredient) => `${Number(item.quantity.toFixed(1))} ${item.unit}`;
export const formatTime = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, '0')}:${Math.max(0, seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export const timerRemaining = (t: Timer, now = Date.now()) =>
  t.endAt === null ? t.remaining : Math.max(0, Math.ceil((t.endAt - now) / 1000));

export function makeGuide(recipe: Recipe, conditions: Conditions): Guide {
  const r: Recipe = structuredClone(recipe);
  const factor = conditions.servings / 2;
  r.ingredients = r.ingredients.map((item) => ({
    ...item,
    quantity:
      item.id === r.id || (r.id === 'eggs' && item.id === 'tomato')
        ? conditions.amount
        : ['个'].includes(item.unit)
          ? Math.max(1, Math.round(item.quantity * factor))
          : Number((item.quantity * factor).toFixed(1)),
  }));
  if (/不辣|不吃辣|不要辣/.test(conditions.taste)) {
    r.ingredients = r.ingredients.filter((item) => !['chili', 'pepper'].includes(item.id));
    r.steps = r.steps.map((s) => ({
      ...s,
      action: s.action.replace('干辣椒、花椒、', '').replace('和辣椒', ''),
      signal: s.id === 'aromatics' ? '闻到姜蒜的香味，蒜片微微发黄但没有变黑。' : s.signal,
      tip: s.id === 'aromatics' ? '姜蒜炒香即可，避免炒焦。' : s.tip,
      why: s.why.replace('辣椒和花椒', '姜蒜'),
    }));
    r.prep[0].detail = r.prep[0].detail.replace('，干辣椒剪段', '');
    r.signals = r.signals.map((s) => ({ ...s, detail: s.detail.replace('与辣味', '') }));
  } else if (conditions.taste === '中辣' && r.id === 'chicken') {
    const chili = r.ingredients.find((item) => item.id === 'chili');
    if (chili) chili.quantity *= 2;
  }
  if (/清淡|少盐|不.*咸/.test(conditions.taste))
    r.ingredients = r.ingredients.map((item) =>
      ['salt', 'soy', 'darksoy'].includes(item.id)
        ? { ...item, quantity: Number((item.quantity * 0.7).toFixed(1)) }
        : item,
    );
  if (conditions.allergies.includes('花生')) {
    r.ingredients = r.ingredients.filter((item) => item.id !== 'peanuts');
    r.prep = r.prep.map((p) => ({
      ...p,
      title: r.id === 'chicken' && p.id === 'tools' ? '准备餐具' : p.title,
      detail: p.detail.replace('熟花生单独放一碗，', ''),
    }));
    r.steps = r.steps.map((s) =>
      s.id === 'finish' && r.id === 'chicken'
        ? {
            ...s,
            title: '翻匀出锅',
            action:
              '确认鸡肉已熟透，酱汁均匀裹住鸡丁，关火装盘。此版本不使用花生，也不使用花生油。',
            uses: [],
            tip: '使用干净的工具与盘子，避免接触花生。',
            signal: '鸡丁均匀裹汁，盘底没有大量流动汤汁。',
            why: '去掉花生不会影响鸡肉的炒制流程。',
          }
        : s,
    );
    r.key = r.key.replace(
      '花生最后放，才能保持酥脆。',
      '全程不使用花生及花生油，留意调料标签与工具交叉接触。',
    );
    r.subtitle = '不加花生，也有酸甜咸鲜的好滋味';
    r.signals = r.signals.map((s) => ({
      ...s,
      title: s.title === '鸡肉嫩、花生脆' ? '鸡肉鲜嫩' : s.title,
      detail: s.detail.replace('、花生脆', ''),
    }));
  }
  if (conditions.allergies.some((text) => /小葱|葱花|^葱$/.test(text))) {
    r.ingredients = r.ingredients.filter((item) => item.id !== 'scallion');
    r.prep = r.prep.map((p) => ({
      ...p,
      title: p.title.replace('和小葱', '').replace('与葱姜', '与姜'),
      detail: p.detail
        .replace('；小葱切成葱花。', '。')
        .replace('葱切小段，', '')
        .replace('，大葱切段', ''),
    }));
    r.steps = r.steps.map((s) => ({
      ...s,
      title: s.title.replace('撒葱花出锅', '翻匀出锅'),
      action: s.action
        .replace('撒入葱花，', '')
        .replace('，再加入葱段炒出香味', '')
        .replace('姜片、葱、八角', '姜片、八角'),
      why: s.why.replace('最后加葱，保留清新的葱香。', '及时关火，保持鸡蛋鲜嫩。'),
    }));
  }
  const ids = new Set(r.ingredients.map((item) => item.id));
  r.prep = r.prep.map((p) => ({ ...p, uses: p.uses.filter((id) => ids.has(id)) }));
  r.steps = r.steps.map((s) => ({ ...s, uses: s.uses.filter((id) => ids.has(id)) }));
  const amount = (id: string, portion = 1) => {
    const item = r.ingredients.find((item) => item.id === id);
    return item ? `${Number((item.quantity * portion).toFixed(1))} ${item.unit}` : '';
  };
  if (r.id === 'chicken') {
    r.prep = r.prep.map((p) =>
      p.id === 'marinate'
        ? {
            ...p,
            detail: `鸡丁加入料酒 ${amount('wine')}、盐 ${amount('salt')}、生抽 ${amount('soy', 1 / 3)}、玉米淀粉 ${amount('starch', 0.5)}、食用油 ${amount('oil', 0.2)}，抓匀腌制 10 分钟。`,
          }
        : p.id === 'sauce'
          ? {
              ...p,
              detail: `生抽 ${amount('soy', 2 / 3)}、米醋 ${amount('vinegar')}、白糖 ${amount('sugar')}、玉米淀粉 ${amount('starch', 0.5)}、清水 ${amount('water')} 混匀。下锅前再搅一次，防止淀粉沉底。`,
            }
          : p,
    );
    r.steps = r.steps.map((s) =>
      s.id === 'heat'
        ? { ...s, action: s.action.replace('剩余 4/5 食用油', `剩余食用油 ${amount('oil', 0.8)}`) }
        : s,
    );
  }
  if (r.id === 'eggs') {
    r.prep = r.prep.map((p) =>
      p.id === 'eggs'
        ? { ...p, detail: `鸡蛋打入碗中，加入盐 ${amount('salt', 0.25)}，搅拌至没有明显蛋清条。` }
        : p,
    );
    r.steps = r.steps.map((s) =>
      s.id === 'eggs'
        ? { ...s, action: s.action.replace('3/5 食用油', `食用油 ${amount('oil', 0.6)}`) }
        : s.id === 'tomato'
          ? {
              ...s,
              action: s.action
                .replace('剩余 2/5 食用油', `剩余食用油 ${amount('oil', 0.4)}`)
                .replace(
                  '剩余盐与全部糖',
                  `剩余盐 ${amount('salt', 0.75)} 与白糖 ${amount('sugar')}`,
                ),
            }
          : s,
    );
  }
  if (conditions.cookwares?.length)
    r.tools = [
      ...new Set([...conditions.cookwares, ...r.tools.filter((tool) => !/锅/.test(tool))]),
    ];
  r.tags = [
    `${conditions.servings} 人份`,
    conditions.taste,
    ...(conditions.allergies.includes('花生') ? ['无花生'] : []),
  ];
  return {
    id: uid(),
    recipe: r,
    conditions: structuredClone(conditions),
    checked: [],
    currentStep: 0,
    completed: [],
    status: 'ready',
    favorite: false,
    note: '',
    rating: 0,
    createdAt: new Date().toISOString(),
    changes: [],
    version: 1,
  };
}

export const STORAGE_KEY = 'cookpilot.demo.v1';
export function initialState(): State {
  const chicken = makeGuide(recipes[0], defaultConditions(recipes[0]));
  chicken.favorite = true;
  const eggs = makeGuide(recipes[1], defaultConditions(recipes[1]));
  eggs.status = 'finished';
  eggs.completed = eggs.recipe.steps.map((s) => s.id);
  eggs.checked = eggs.recipe.prep.map((p) => p.id);
  eggs.rating = 5;
  eggs.note = '番茄炒久一点，汤汁拌饭刚刚好。';
  eggs.favorite = true;
  return {
    guides: [chicken, eggs],
    activeId: null,
    timers: [],
    models: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/v1',
        key: '',
        model: 'deepseek-chat',
      },
      {
        id: 'qwen',
        name: '通义千问',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        key: '',
        model: 'qwen-plus',
      },
    ],
    modelId: 'deepseek',
    preferences: defaultPreferences(),
  };
}
// Keep saved progress and adjusted instructions while shortening legacy labels.
const conciseLabels: Record<string, string> = {
  切好鸡丁与配料: '切鸡丁与配料',
  给鸡丁一点腌制时间: '腌制鸡丁',
  提前调好一碗宫保汁: '调宫保汁',
  把最后要用的材料放手边: '准备花生与餐具',
  '热锅，让油铺满锅底': '热锅放油',
  '滑炒鸡丁，先锁住鲜嫩': '滑炒鸡丁',
  '小火煸香，香味慢慢出来': '小火炒香配料',
  '鸡丁回锅，淋汁快速翻匀': '鸡丁回锅调味',
  '最后放花生，翻匀就出锅': '放花生，翻匀出锅',
  '鸡肉熟透，吃着才安心': '鸡肉熟透',
  '薄芡裹身，不是一盘汤': '酱汁均匀包裹',
  '香味到位，口感有层次': '鸡肉嫩、花生脆',
  切好番茄和小葱: '切番茄和小葱',
  调味料与盛菜盘放手边: '准备调料与餐具',
  把鸡蛋炒得蓬松一些: '炒鸡蛋',
  '炒番茄，等它释放酸甜': '炒番茄',
  让鸡蛋裹满番茄汁: '鸡蛋回锅翻匀',
  '撒葱花，热乎乎地上桌': '撒葱花出锅',
  '番茄变软，仍能看见形状': '番茄软且成块',
  '酸甜适口，汤汁裹住蛋块': '汤汁裹住蛋块',
  '牛腩切块，葱姜备好': '切牛腩与葱姜',
  '冷水焯牛肉，去掉浮沫': '冷水焯牛肉',
  '炒香配料，给牛肉上色': '炒香配料与牛肉',
  '小火慢炖，把时间交给锅': '小火炖牛肉',
  '再放土豆，一起炖到软糯': '加入土豆炖煮',
  '开盖收汁，留住一口浓香': '开盖收汁',
  '牛肉软烂、不费力': '牛肉软烂',
  '土豆软糯、保持块状': '土豆软且成块',
  '汤汁浓香、留有余地': '汤汁浓稠',
  '翻匀出锅，趁热享用': '翻匀出锅',
  把出锅要用的工具放手边: '准备餐具',
};
const conciseLabel = (label: string) => conciseLabels[label] ?? label;

export function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw);
      if (Array.isArray(value.guides) && Array.isArray(value.models) && Array.isArray(value.timers))
        return {
          ...value,
          preferences: { ...defaultPreferences(), ...value.preferences },
          guides: value.guides.map((g: Guide) => ({
            ...g,
            recipe: {
              ...g.recipe,
              prep: g.recipe.prep.map((p) => ({
                ...p,
                title:
                  g.recipe.id === 'chicken' &&
                  p.id === 'tools' &&
                  g.conditions.allergies.includes('花生')
                    ? '准备餐具'
                    : conciseLabel(p.title),
              })),
              steps: g.recipe.steps.map((s) => ({ ...s, title: conciseLabel(s.title) })),
              signals: g.recipe.signals.map((s) => ({
                ...s,
                title:
                  g.recipe.id === 'chicken' &&
                  g.conditions.allergies.includes('花生') &&
                  conciseLabel(s.title) === '鸡肉嫩、花生脆'
                    ? '鸡肉鲜嫩'
                    : conciseLabel(s.title),
              })),
            },
          })),
          timers: value.timers.map((t: Timer) => {
            const recipe = value.guides.find((g: Guide) => g.id === t.guideId)?.recipe as
              | Recipe
              | undefined;
            const source = [...(recipe?.prep ?? []), ...(recipe?.steps ?? [])].find(
              (step) => step.id === t.stepId && step.title === t.name,
            );
            return source ? { ...t, name: conciseLabel(t.name) } : t;
          }),
        };
    }
  } catch {
    /* Storage may be unavailable; continue with a fresh demo. */
  }
  return initialState();
}
