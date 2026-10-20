import { useEffect, type Ref } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, ChefHat, ChevronRight, Search, Settings2, X } from 'lucide-react';
import { useApp } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { isExpired } from '../../domain/rules';

export function Drawer({
  open,
  hidden = false,
  onClose,
  ref,
}: {
  open: boolean;
  hidden?: boolean;
  onClose: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(
      () => document.getElementById('cookpilot-drawer')?.focus({ preventScroll: true }),
      340,
    );
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <aside
      className="drawer"
      id="cookpilot-drawer"
      ref={ref}
      aria-label="导航菜单"
      inert={!open}
      tabIndex={-1}
    >
      {!hidden && <DrawerBody onClose={onClose} />}
    </aside>
  );
}

function DrawerBody({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const conversations =
    useLiveQuery(() => db.conversations.orderBy('lastSentAt').reverse().limit(14).toArray(), []) ??
    [];
  const recent = conversations.filter((conversation) => !isExpired(conversation.lastSentAt));
  const go = (page: 'search' | 'recipes' | 'ai-recipes' | 'settings') => {
    onClose();
    void app.navigate({ page });
  };
  const resume = (id: string) =>
    void app.safe(async () => {
      await app.cancel();
      await setSetting('activeConversationId', id);
      onClose();
      await app.navigate({ page: 'home' });
    });
  const history = () => {
    onClose();
    app.showHistory();
  };
  return (
    <>
      <header className="drawer-head">
        <span className="brand">
          <ChefHat size={24} strokeWidth={1.7} />
          <span>CookPilot</span>
        </span>
        <button className="icon-button" aria-label="收起菜单" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <button className="menu-search" onClick={() => go('search')}>
        <Search size={17} />
        搜索菜谱、心得与对话
      </button>
      <div className="drawer-scroll">
        <div className="drawer-label">
          <span>最近对话</span>
          <button onClick={history}>
            全部
            <ChevronRight size={14} />
          </button>
        </div>
        {recent.map((conversation) => (
          <button
            key={conversation.id}
            className="drawer-conversation"
            aria-current={conversation.id === app.data.activeConversationId || undefined}
            onClick={() => resume(conversation.id)}
          >
            <span className="truncate">{conversation.title}</span>
            <small>
              {new Date(conversation.lastSentAt).toLocaleDateString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
              })}
            </small>
          </button>
        ))}
        {!recent.length && <p className="drawer-empty">还没有对话，说说想吃什么。</p>}
      </div>
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
            onClick={() => go(item.page)}
          >
            <item.icon size={20} strokeWidth={1.6} />
            {item.label}
            <ChevronRight size={15} />
          </button>
        ))}
      </nav>
    </>
  );
}
