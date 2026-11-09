import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../../app/context';
import { setSetting } from '../../storage/db';
import { historyGroup } from '../../domain/rules';
import {
  prepareSearchIndex,
  readConversationHistory,
  type HistoryCursor,
} from '../../storage/searchIndex';
import { Sheet } from '../../shared/Sheet';

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [cursors, setCursors] = useState<HistoryCursor[]>([]);
  const before = cursors.at(-1);
  const snapshot = useLiveQuery(
    async () => ({ before, rows: await readConversationHistory(25, before) }),
    [before],
  );
  const rows = snapshot?.before === before ? snapshot?.rows : undefined;
  const ready = rows !== undefined;
  const conversations = rows?.slice(0, 24) ?? [];
  const navigation = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    void app.safe(() => prepareSearchIndex('conversation'));
  }, [app.safe]);
  useLayoutEffect(() => {
    if (!ready || !moved.current) return;
    if (document.activeElement === document.body)
      navigation.current?.focus({ preventScroll: true });
    navigation.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    moved.current = false;
  }, [ready, before]);
  return (
    <Sheet title="对话历史" onClose={onClose}>
      {ready && !conversations.length && !cursors.length && (
        <p className="empty-help">还没有对话。发送第一条消息后会保存在这里。</p>
      )}
      {(cursors.length > 0 || (rows?.length ?? 0) > 24) && (
        <div
          ref={navigation}
          className="message-pagination"
          role="group"
          tabIndex={-1}
          aria-label="历史分页"
        >
          {cursors.length > 0 && (
            <button
              className="text-button"
              disabled={!ready}
              onClick={() => {
                moved.current = true;
                setCursors((previous) => previous.slice(0, -1));
              }}
            >
              较新对话
            </button>
          )}
          {ready && rows.length > 24 && (
            <button
              className="text-button"
              onClick={() => {
                moved.current = true;
                const { id, lastSentAt } = conversations.at(-1)!;
                setCursors((previous) => [...previous, { id, lastSentAt }]);
              }}
            >
              更早对话
            </button>
          )}
        </div>
      )}
      {['今天', '昨天', '近 7 天', '近 30 天'].map((group) => {
        const items = conversations.filter((c) => historyGroup(c.lastSentAt) === group);
        return items.length ? (
          <section className="history-group" key={group}>
            <h3>{group}</h3>
            {items.map((conversation) => (
              <button
                className="history-row"
                key={conversation.id}
                onClick={() => {
                  void app.safe(async () => {
                    await app.cancel();
                    await setSetting('activeConversationId', conversation.id);
                    onClose();
                    await app.navigate({ page: 'home' });
                  });
                }}
              >
                <span>
                  <strong>{conversation.title}</strong>
                  <small>
                    {conversation.questionCount} 条提问 ·{' '}
                    {new Date(conversation.lastSentAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
        ) : null;
      })}
    </Sheet>
  );
}
