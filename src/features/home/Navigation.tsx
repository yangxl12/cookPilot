import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, ChefHat, ChevronRight, History, Search, Settings2 } from 'lucide-react';
import { useApp } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { historyGroup, isExpired } from '../../domain/rules';
import { Sheet } from '../../shared/Sheet';

export function MenuSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  return (
    <Sheet title="CookPilot" drawer onClose={onClose}>
      <button className="menu-search" onClick={() => void app.navigate({ page: 'search' })}>
        <Search size={18} />
        搜索菜谱、心得与对话
      </button>
      <nav className="menu-links">
        {(
          [
            { page: 'ai-recipes', label: 'AI 菜谱', icon: ChefHat },
            { page: 'recipes', label: '菜谱大全', icon: BookOpen },
            { page: 'settings', label: '我的厨房', icon: Settings2 },
          ] as const
        ).map((item) => (
          <button
            key={item.page}
            aria-current={app.route.page === item.page ? 'page' : undefined}
            onClick={() => {
              onClose();
              void app.navigate({ page: item.page });
            }}
          >
            <item.icon size={21} strokeWidth={1.6} />
            {item.label}
            <ChevronRight size={16} />
          </button>
        ))}
        <button onClick={app.showHistory}>
          <History size={21} strokeWidth={1.6} />
          对话历史
          <ChevronRight size={16} />
        </button>
      </nav>
    </Sheet>
  );
}
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
