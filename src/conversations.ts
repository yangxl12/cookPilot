import type { DiscoveryTurn } from './discovery';

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: DiscoveryTurn[];
};

export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Expired records are removed from storage as well as the menu. */
export function retainConversations(conversations: Conversation[], now = Date.now()) {
  return conversations.filter((conversation) =>
    Date.parse(conversation.updatedAt) >= now - HISTORY_RETENTION_MS,
  );
}

export function createDemoConversations(now = Date.now()): Conversation[] {
  return [
    { days: 0, title: '冰箱里有番茄和鸡蛋', text: '可以做番茄炒蛋。番茄先炒出汁，再倒入炒好的鸡蛋，最后调味。想尝试别的做法，也可以继续告诉我。' },
    { days: 1, title: '今晚想吃点快手的', text: '可以试试法式蘑菇煎蛋，或者番茄罗勒意面。告诉我手边的食材，我帮你选一道。' },
    { days: 7, title: '宫保鸡丁怎么做更嫩？', text: '鸡丁切匀，先用淀粉和少量油抓匀腌制；炒到表面变白先盛出，最后回锅与碗汁快速翻匀。' },
    { days: 26, title: '周末想做土豆炖牛肉', text: '可以先把牛肉炖到软，再加入土豆，避免土豆过早煮散。你准备了多少牛肉？' },
  ].map(({ days, title, text }, index) => {
    const date = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    return {
      id: `demo-conversation-${index}`,
      title,
      createdAt: date,
      updatedAt: date,
      turns: [{ id: `demo-turn-${index}`, prompt: title, result: { kind: 'chat', text } }],
    };
  });
}

export function historyGroup(updatedAt: string, now = Date.now()) {
  const date = new Date(updatedAt);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return now - date.getTime() < 7 * 24 * 60 * 60 * 1000 ? '近 7 天' : '近 30 天';
}
