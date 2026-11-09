import type { ChatMessage } from './client';

// Character budgets are deliberately conservative for Chinese text. They bound the
// actual serialized input, independently of the provider's output token limit.
export const INPUT_CHAR_BUDGET = 48000;
export const REQUIREMENT_CHAR_BUDGET = 6000;
const critical =
  /\d|[零一二两三四五六七八九十百半]+\s*(克|斤|勺|个|毫升)|过敏|忌|不吃|不要|不能|不放|不加|少盐|少油|清淡|素食|纯素|只吃|避免|禁|只用|锅|烤箱|电饭煲|微波|改成|换成|必须/;

export function summarizeRequirements(previous: string, text: string): string {
  const clauses = text
    .split(/[\n。；;]+/)
    .map((s) => s.trim())
    .filter((s) => critical.test(s));
  const ordered = new Set<string>();
  for (const clause of [...previous.split('\n').filter(Boolean), ...clauses]) {
    ordered.delete(clause);
    ordered.add(clause);
  }
  const summary = [...ordered].join('\n');
  if (summary.length > REQUIREMENT_CHAR_BUDGET)
    throw new Error('本次明确用量与限制过多，请新建对话并整理本次要求');
  return summary;
}

export function recentContext(history: ChatMessage[], budget = 8000): ChatMessage[] {
  const result: ChatMessage[] = [];
  let remaining = budget;
  for (const message of history.slice(-20).reverse()) {
    if (message.content.length > remaining) {
      if (!result.length) throw new Error('最新消息过长，请简化后重试；明确要求未被截断');
      break;
    }
    result.unshift(message);
    remaining -= message.content.length;
  }
  return result;
}

export function checkInputBudget(messages: ChatMessage[]) {
  if (JSON.stringify(messages).length > INPUT_CHAR_BUDGET)
    throw new Error('本次内容超出输入预算，请简化要求后重试；明确用量与限制未被截断');
}
