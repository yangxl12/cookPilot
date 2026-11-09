import Dexie from 'dexie';
import { db, type CookDatabase } from './db';
import { defaultPreferences } from '../domain/schema';

/** One readonly transaction is a consistent snapshot even across tabs. Only the
 * current record and encoded chunks survive each cursor callback. No full-table
 * object arrays or a second, full-size JSON string are retained. */
export async function exportSnapshot(database: CookDatabase = db): Promise<Blob> {
  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  let buffer = '';
  const write = (text: string) => {
    buffer += text;
    if (buffer.length >= 32768) {
      chunks.push(encoder.encode(buffer));
      buffer = '';
    }
  };
  await database.transaction(
    'r',
    database.tables.filter((t) =>
      [
        'recipes',
        'versions',
        'sessions',
        'timers',
        'conversations',
        'conversationMessages',
        'cookingMessages',
        'models',
        'settings',
      ].includes(t.name),
    ),
    async () => {
      write(`{"schemaVersion":1,"exportedAt":${JSON.stringify(new Date().toISOString())}`);
      for (const name of [
        'recipes',
        'versions',
        'sessions',
        'timers',
        'conversations',
        'cookingMessages',
        'models',
      ]) {
        write(`,${JSON.stringify(name)}:[`);
        let first = true;
        const comma = () => {
          if (!first) write(',');
          first = false;
        };
        if (name === 'conversations') {
          // Only keys are retained, never the full conversation corpus.
          for (const id of await database.conversations
            .where('lastSentAt')
            .aboveOrEqual(Date.now() - 30 * 86400000)
            .primaryKeys()) {
            const conversation = await database.conversations.get(id);
            if (!conversation) continue;
            comma();
            const {
              messages,
              messageCount: _count,
              requirements: _requirements,
              questionCount: _questions,
              ...metadata
            } = conversation;
            write(`${JSON.stringify(metadata).slice(0, -1)},"messages":[`);
            let firstMessage = true;
            const message = (value: unknown) => {
              if (!firstMessage) write(',');
              firstMessage = false;
              write(JSON.stringify(value));
            };
            if (messages?.length) messages.forEach(message);
            else
              await database.conversationMessages
                .where('[conversationId+sequence]')
                .between([id, Dexie.minKey], [id, Dexie.maxKey])
                .each(({ conversationId: _id, sequence: _sequence, ...row }) => message(row));
            write(']}');
          }
        } else
          await database.table(name).each((row) => {
            comma();
            if (name === 'recipes') {
              const { nameKeys: _keys, ...recipe } = row;
              write(JSON.stringify(recipe));
              return;
            }
            write(
              JSON.stringify(
                name === 'models'
                  ? { id: row.id, name: row.name, url: row.url, model: row.model, key: '[已隐藏]' }
                  : row,
              ),
            );
          });
        write(']');
      }
      write(
        `,"preferences":${JSON.stringify((await database.settings.get('preferences'))?.value ?? defaultPreferences())}`,
      );
      write(
        `,"activeModelId":${JSON.stringify((await database.settings.get('activeModelId'))?.value ?? '')}}`,
      );
    },
  );
  if (buffer) chunks.push(encoder.encode(buffer));
  return new Blob(chunks, { type: 'application/json' });
}
