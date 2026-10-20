import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(4000);
// Normalize common model wording while keeping one canonical value in storage/UI.
export const difficultySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const aliases: Record<string, string> = {
      容易: '简单',
      中等: '适中',
      困难: '有点挑战',
    };
    const clean = value.trim();
    return Object.hasOwn(aliases, clean) ? aliases[clean] : clean;
  },
  z.enum(['简单', '适中', '有点挑战']),
);
export const usageSchema = z.object({ ingredientId: id, fraction: z.number().min(0).max(1) });
// 模型会写「川菜」「西餐」「日料」这类更细的菜系：归一到两个分类，别为格式细节整份重生成。
export const cuisineSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const clean = value.trim();
    if (clean === '中式' || clean === '西式与日式') return clean;
    return /西|日|法|意|欧|美式|韩|泰|东南亚|融合/.test(clean) ? '西式与日式' : '中式';
  },
  z.enum(['中式', '西式与日式']),
);
// 同理，「辅料」「腌料」「酱料」都属于「调味」。
const groupAlias: Record<string, '主料' | '调味'> = {
  主料: '主料',
  主材: '主料',
  主要食材: '主料',
  食材: '主料',
  调味: '调味',
  调料: '调味',
  辅料: '调味',
  配料: '调味',
  佐料: '调味',
  腌料: '调味',
  酱料: '调味',
  香料: '调味',
  蘸料: '调味',
};
export const groupSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const clean = value.trim();
    return groupAlias[clean] ?? (/调|辅|佐|腌|酱|香料|蘸/.test(clean) ? '调味' : '主料');
  },
  z.enum(['主料', '调味']),
);
export const ingredientSchema = z.object({
  id,
  name: text,
  quantity: z.number().positive().max(100000).nullable(),
  unit: z.string().max(30),
  amountText: z.string().max(150).default(''),
  group: groupSchema,
  note: z.string().max(500).default(''),
});
export const prepSchema = z.object({
  id,
  title: text,
  action: text,
  uses: z.array(usageSchema).max(40),
  seconds: z.number().int().min(0).max(604800).default(0),
  parallel: z.string().max(500).default(''),
});
export const stepSchema = z.object({
  id,
  title: text,
  action: text,
  uses: z.array(usageSchema).max(40),
  heat: z.string().max(150).default(''),
  seconds: z.number().int().min(0).max(604800).default(0),
  signal: text,
  tip: z.string().max(1000).default(''),
  dependsOn: z.array(id).max(30).default([]),
});
export const contentSchema = z.object({
  schemaVersion: z.literal(1),
  title: text,
  aliases: z.array(z.string().min(1).max(100)).max(15).default([]),
  cuisine: cuisineSchema,
  minutes: z.number().int().positive().max(2880),
  difficulty: difficultySchema,
  conditions: text,
  cookware: z.array(text).min(1).max(15),
  keyPoints: z.array(text).min(1).max(10),
  ingredients: z.array(ingredientSchema).min(1).max(40),
  prep: z.array(prepSchema).min(1).max(30),
  steps: z.array(stepSchema).min(1).max(30),
});
export type Content = z.infer<typeof contentSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Prep = z.infer<typeof prepSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type Usage = z.infer<typeof usageSchema>;
export const preferencesSchema = z.object({
  avoidances: z.string().max(1000),
  taste: z.string().max(1000),
  cookware: z.array(z.string().max(100)).max(15),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = (): Preferences => ({ avoidances: '', taste: '', cookware: [] });
export const candidateSchema = z.object({
  name: z.string().min(1).max(100),
  aliases: z.array(z.string().max(100)).max(10).default([]),
  minutes: z.number().int().positive().max(2880),
  difficulty: difficultySchema,
  summary: z.string().max(1000),
  blocked: z.string().max(1000).default(''),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const recommendationSchema = z.object({
  text: z.string().min(1).max(6000),
  candidates: z.array(candidateSchema).max(5),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
export const proposalSchema = z.object({
  explanation: text,
  // A patch may only touch existing, unexecuted targets. No whole-recipe replacement.
  steps: z.array(stepSchema).max(30).default([]),
  prep: z.array(prepSchema).max(30).default([]),
  ingredients: z.array(ingredientSchema).max(40).default([]),
  keyPoints: z.array(text).max(10).optional(),
});
export type ProposalPatch = z.infer<typeof proposalSchema>;
export const answerSchema = z.object({
  text: z.string().min(1).max(8000),
  confirmations: z
    .array(z.object({ targetType: z.enum(['prep', 'step']), targetId: id, question: text }))
    .max(5)
    .default([]),
  proposal: proposalSchema.nullable().default(null),
});
export type Answer = z.infer<typeof answerSchema>;

export type Recipe = {
  id: string;
  identity: string;
  name: string;
  aliases: string[];
  source: 'ai' | 'catalog';
  createdAt: number;
};
export type RecipeVersion = {
  id: string;
  recipeId: string;
  number: number;
  parentId: string | null;
  content: Content;
  preferences?: Preferences;
  change: string;
  createdAt: number;
};
export type Execution = { targetType: 'prep' | 'step'; targetId: string; confirmedAt: number };
export type CookingSession = {
  id: string;
  recipeId: string;
  versionId: string;
  checked: string[];
  currentCard: number;
  execution: Execution[];
  progressKnown: boolean;
  revision: number;
  note: string;
  createdAt: number;
};
export type Timer = {
  id: string;
  sessionId: string;
  targetType: 'prep' | 'step' | 'custom';
  targetId: string;
  name: string;
  total: number;
  remaining: number;
  deadline: number | null;
  status: 'running' | 'paused' | 'done';
  notified: boolean;
  createdAt: number;
};
export type Message = {
  id: string;
  taskId?: string;
  role: 'user' | 'assistant';
  text: string;
  candidates?: Candidate[];
  status?: 'pending' | 'done' | 'failed' | 'interrupted';
  createdAt: number;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  lastSentAt: number;
};
export type CookingMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  answer?: Answer;
  baseVersionId?: string;
  baseRevision?: number;
  proposalStatus?: 'pending' | 'applied' | 'cancelled';
};
export type ModelConfig = { id: string; name: string; url: string; model: string };
export type Credential = { modelId: string; key: string };
export type Task = {
  id: string;
  kind: 'recommend' | 'generate' | 'question';
  contextId: string;
  model: ModelConfig;
  status: 'pending' | 'done' | 'cancelled' | 'interrupted' | 'failed';
  createdAt: number;
  owner: string;
  resultSessionId?: string;
  resultContent?: Content;
  candidate?: Candidate;
};
export type Setting = { id: string; value: unknown };
export type BuiltinRecipe = {
  id: string;
  sourceNumber: string;
  sourceUrl: string;
  sourceText: string;
  contentVersion: number;
  content: Content;
};
export const uid = () => crypto.randomUUID();
export const now = () => Date.now();
