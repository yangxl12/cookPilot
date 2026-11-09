import type { ConversationMessage, CookingMessage } from '../domain/schema';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { MESSAGE_PAGE_SIZE } from './MessageHistory';

/** A stable numeric window over indexed messages; equal timestamps use message IDs. */
type MessagePage<T> = { messages: T[]; controls: ReactNode; ready: boolean; latest: () => void };
export function useMessagePage(kind: 'conversation', id: string): MessagePage<ConversationMessage>;
export function useMessagePage(kind: 'cooking', id: string): MessagePage<CookingMessage>;
export function useMessagePage(
  kind: 'conversation' | 'cooking',
  id: string,
): MessagePage<ConversationMessage | CookingMessage> {
  const [position, setPosition] = useState<{ id: string; end: number | null }>({ id, end: null });
  const before = position.id === id ? position.end : null;
  const navigation = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const snapshot = useLiveQuery(async () => {
    if (!id) return { id, before, rows: [], total: 0 };
    const table = kind === 'conversation' ? db.conversationMessages : db.cookingMessages;
    const collection = table
      .where(kind === 'conversation' ? 'conversationId' : 'sessionId')
      .equals(id);
    const total = await collection.count();
    const end = Math.min(before ?? total, total);
    const start = Math.max(0, end - MESSAGE_PAGE_SIZE);
    const rows =
      kind === 'conversation'
        ? await db.conversationMessages
            .where('[conversationId+sequence]')
            .between([id, start], [id, end], true, false)
            .toArray()
        : (
            await db.cookingMessages
              .where('[sessionId+createdAt+id]')
              .between([id, -Infinity, ''], [id, Infinity, '\uffff'])
              .reverse()
              .offset(Math.max(0, total - end))
              .limit(MESSAGE_PAGE_SIZE)
              .toArray()
          ).reverse();
    return { id, before, rows, total };
  }, [kind, id, before]);
  const ready = snapshot !== undefined && snapshot.id === id && snapshot.before === before;
  const total = ready ? snapshot.total : 0;
  const end = Math.min(before ?? total, total);
  const move = useCallback(
    (end: number | null) => {
      moved.current = true;
      setPosition({ id, end });
    },
    [id],
  );
  useLayoutEffect(() => {
    if (!ready || !moved.current) return;
    navigation.current?.focus({ preventScroll: true });
    navigation.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    moved.current = false;
  }, [ready, before]);
  const controls = useMemo(
    () =>
      total > MESSAGE_PAGE_SIZE ? (
        <div
          className="message-pagination"
          role="group"
          aria-label="对话分页"
          tabIndex={-1}
          ref={navigation}
        >
          <button
            className="text-button"
            disabled={!ready || end <= MESSAGE_PAGE_SIZE}
            onClick={() => move(Math.max(MESSAGE_PAGE_SIZE, end - MESSAGE_PAGE_SIZE))}
          >
            更早消息
          </button>
          <button
            className="text-button"
            disabled={!ready || end >= total}
            onClick={() => move(end + MESSAGE_PAGE_SIZE >= total ? null : end + MESSAGE_PAGE_SIZE)}
          >
            较新消息
          </button>
          {before !== null && (
            <button className="text-button" onClick={() => move(null)}>
              回到最新
            </button>
          )}
        </div>
      ) : null,
    [total, end, before, ready, move],
  );
  return { messages: ready ? snapshot.rows : [], controls, ready, latest: () => move(null) };
}
