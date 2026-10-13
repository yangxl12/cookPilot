import { useState } from 'react';
import { BookOpen, ChefHat, ChevronRight, History, Search, Settings2 } from 'lucide-react';
import { useApp, type Route } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { catalog } from '../../assets/recipes';
import { contentSearchText, historyGroup, isExpired } from '../../domain/rules';
import { openBuiltin } from '../../storage/repository';
import { Sheet } from '../../shared/Sheet';

export function MenuSheet({ onClose, onSearch }: { onClose: () => void; onSearch: () => void }) {
  const app = useApp();
  return (
    <Sheet title="CookPilot" drawer onClose={onClose}>
      <button className="menu-search" onClick={onSearch}>
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
  const conversations = app.data.conversations
    .filter((c) => !isExpired(c.lastSentAt))
    .sort((a, b) => b.lastSentAt - a.lastSentAt);
  return (
    <Sheet title="对话历史" onClose={onClose}>
      {!conversations.length && (
        <p className="empty-help">还没有对话。发送第一条消息后会保存在这里。</p>
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
type SearchResult = {
  id: string;
  title: string;
  body: string;
  group: string;
  route?: Route;
  builtinId?: string;
  conversationId?: string;
};
export function SearchSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [query, setQuery] = useState('');
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const all: SearchResult[] = [
    ...app.data.sessions
      .filter((s) => app.data.recipes.find((r) => r.id === s.recipeId)?.source === 'ai')
      .map((s) => {
        const v = app.data.versions.find((v) => v.id === s.versionId)!;
        return {
          id: s.id,
          title: v.content.title,
          body: `${contentSearchText(v.content)} ${s.note} ${app.data.versions
            .filter((v) => v.recipeId === s.recipeId)
            .map((v) => v.change)
            .join(' ')}`,
          group: 'AI 菜谱',
          route: { page: 'cook' as const, sessionId: s.id },
        };
      }),
    ...catalog.map((r) => ({
      id: r.id,
      title: r.content.title,
      body: `${r.sourceText} ${r.content.conditions} ${r.content.aliases.join(' ')}`,
      group: '菜谱大全',
      builtinId: r.id,
    })),
    ...app.data.conversations
      .filter((c) => !isExpired(c.lastSentAt))
      .map((c) => ({
        id: c.id,
        title: c.title,
        body: c.messages
          .map(
            (m) =>
              `${m.text} ${m.candidates?.map((r) => `${r.name} ${r.summary}`).join(' ') ?? ''}`,
          )
          .join(' '),
        group: '对话历史',
        conversationId: c.id,
      })),
  ];
  const matches = terms.length
    ? all.filter((r) => terms.every((term) => `${r.title} ${r.body}`.toLowerCase().includes(term)))
    : [];
  const snippet = (body: string) => {
    const lower = body.toLowerCase();
    const start = Math.max(
      0,
      Math.min(...terms.map((t) => lower.indexOf(t)).filter((n) => n >= 0)) - 18,
    );
    const clean = Number.isFinite(start) ? start : 0;
    return `${clean ? '…' : ''}${body.slice(clean, clean + 100).replace(/[{}[\]"]/g, ' ')}…`;
  };
  const open = async (result: SearchResult) => {
    if (result.conversationId) {
      await app.cancel();
      await setSetting('activeConversationId', result.conversationId);
      onClose();
      await app.navigate({ page: 'home' });
    } else if (result.builtinId) {
      const session = await openBuiltin(
        catalog.find((r) => r.id === result.builtinId)!,
        app.data.preferences,
      );
      onClose();
      await app.navigate({ page: 'cook', sessionId: session.id });
    } else if (result.route) {
      await db.sessions.update(result.route.sessionId!, { currentCard: 0 });
      onClose();
      await app.navigate(result.route);
    }
  };
  return (
    <Sheet title="全局搜索" onClose={onClose}>
      <div className="global-search">
        <label className="search-field">
          <Search size={18} />
          <input
            data-autofocus
            aria-label="全局搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="多个关键词用空格分隔"
          />
        </label>
        <div className="search-results">
          {terms.length > 0 && !matches.length && <p className="empty-help">没有匹配结果</p>}
          {['AI 菜谱', '菜谱大全', '对话历史'].map((group) => {
            const rows = matches.filter((r) => r.group === group);
            return rows.length ? (
              <section className="search-group" key={group}>
                <h3>
                  {group}
                  <span>{rows.length}</span>
                </h3>
                {rows.map((r) => (
                  <button
                    className="search-result"
                    key={r.id}
                    onClick={() => {
                      void app.safe(() => open(r));
                    }}
                  >
                    <strong>{r.title}</strong>
                    <p>{snippet(r.body)}</p>
                  </button>
                ))}
              </section>
            ) : null;
          })}
        </div>
      </div>
    </Sheet>
  );
}
