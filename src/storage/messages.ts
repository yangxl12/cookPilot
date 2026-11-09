import Dexie from 'dexie';
import { db } from './db';
import type { Conversation, ConversationMessage, Message, MessageSearch } from '../domain/schema';
import { summarizeRequirements } from '../services/ai/contextBudget';

export const messageTables = [
  db.conversations,
  db.conversationMessages,
  db.messageSearch,
  db.conversationSummaries,
  db.conversationSearch,
];
export function indexMessage(message: ConversationMessage): MessageSearch {
  const body = `${message.text} ${message.candidates?.map((c) => `${c.name} ${c.summary}`).join(' ') ?? ''}`;
  return {
    id: message.id,
    conversationId: message.conversationId,
    body,
    searchText: body.toLowerCase(),
  };
}

async function putMetadata(conversation: Conversation, questionCount: number) {
  await db.conversations.put({ ...conversation, questionCount });
  const { messages: _messages, requirements: _requirements, ...metadata } = conversation;
  await db.conversationSummaries.put({ ...metadata, questionCount });
  await db.conversationSearch.put({
    id: conversation.id,
    title: conversation.title,
    lastSentAt: conversation.lastSentAt,
    body: '',
    searchText: '',
  });
}

/** Legacy arrays are copied in resumable batches. The array is retained until the
 * final batch commits, so an interruption never exposes a partial conversation. */
export async function migrateConversation(id: string) {
  const conversation = await db.conversations.get(id);
  if (!conversation || !conversation.messages?.length) return;
  let complete = false;
  while (!complete) {
    complete = await db.transaction('rw', [...messageTables, db.settings], async () => {
      const summary = await db.conversationSummaries.get(id);
      if (
        summary?.messageCount !== undefined ||
        !(await db.conversations.where(':id').equals(id).count())
      )
        return true;
      const key = `messagesAfter-v5:${id}`;
      const start = ((await db.settings.get(key))?.value as number) ?? 0;
      const batch = conversation.messages.slice(start, start + 32).map((message, i) => ({
        ...message,
        conversationId: id,
        sequence: start + i,
      }));
      await db.conversationMessages.bulkPut(batch);
      await db.messageSearch.bulkPut(batch.map(indexMessage));
      if (start + batch.length < conversation.messages.length) {
        await db.settings.put({ id: key, value: start + batch.length });
        return false;
      }
      const users = conversation.messages.filter((m) => m.role === 'user');
      // Preserve legacy constraints verbatim if they exceed today's request budget.
      let requirements: string;
      try {
        requirements = summarizeRequirements('', users.map((m) => m.text).join('\n'));
      } catch {
        requirements = users.map((m) => m.text).join('\n');
      }
      await putMetadata(
        { ...conversation, messages: [], messageCount: conversation.messages.length, requirements },
        users.length,
      );
      await db.settings.delete(key);
      return true;
    });
    if (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function appendMessages(
  metadata: Omit<Conversation, 'messages'>,
  messages: Message[],
) {
  await migrateConversation(metadata.id);
  return db.transaction('rw', messageTables, async () => {
    const current = await db.conversations.get(metadata.id);
    const count = current?.messageCount ?? 0;
    let requirements = current?.requirements ?? '';
    for (const message of messages)
      if (message.role === 'user') requirements = summarizeRequirements(requirements, message.text);
    const rows = messages.map((m, i) => ({
      ...m,
      conversationId: metadata.id,
      sequence: count + i,
    }));
    await db.conversationMessages.bulkAdd(rows);
    await db.messageSearch.bulkPut(rows.map(indexMessage));
    const summary = await db.conversationSummaries.get(metadata.id);
    await putMetadata(
      {
        ...metadata,
        ...current,
        lastSentAt: metadata.lastSentAt,
        messages: [],
        messageCount: count + rows.length,
        requirements,
      },
      (summary?.questionCount ?? 0) + messages.filter((m) => m.role === 'user').length,
    );
  });
}

export function updateMessage(id: string, changes: Partial<Message>) {
  return db.transaction('rw', messageTables, async () => {
    const message = await db.conversationMessages.get(id);
    if (!message) return;
    const next = { ...message, ...changes, id: message.id };
    await db.conversationMessages.put(next);
    await db.messageSearch.put(indexMessage(next));
  });
}

export async function recentMessages(id: string, limit = 20) {
  return (
    await db.conversationMessages
      .where('[conversationId+sequence]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
  ).reverse();
}

export async function readConversation(id: string) {
  const conversation = await db.conversations.get(id);
  if (!conversation) return;
  if (conversation.messages?.length) return conversation;
  return {
    ...conversation,
    messages: await db.conversationMessages
      .where('[conversationId+sequence]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  };
}
