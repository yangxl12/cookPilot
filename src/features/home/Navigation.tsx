import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { historyGroup, isExpired } from '../../domain/rules';
import { Sheet } from '../../shared/Sheet';

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const conversations =
    useLiveQuery(() => db.conversations.orderBy('lastSentAt').reverse().toArray(), []) ?? [];
  return (
    <Sheet title="对话历史" onClose={onClose}>
      {!conversations.length && (
        <p className="empty-help">还没有对话。发送第一条消息后会保存在这里。</p>
      )}
      {['今天', '昨天', '近 7 天', '近 30 天'].map((group) => {
        const items = conversations.filter(
          (c) => !isExpired(c.lastSentAt) && historyGroup(c.lastSentAt) === group,
        );
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
                    {conversation.messages.filter((m) => m.role === 'user').length} 条提问 ·{' '}
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
