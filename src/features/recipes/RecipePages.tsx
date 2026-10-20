import { useLiveQuery } from 'dexie-react-hooks';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChefHat,
  ChevronRight,
  Clock3,
  LoaderCircle,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../app/context';
import { useSessions } from '../../app/data';
import { useCatalog } from '../../shared/useCatalog';
import { usePagedItems } from '../../shared/usePagedItems';
import { cookAgain, deleteSession, openBuiltin } from '../../storage/repository';
import { db } from '../../storage/db';
import { PageHeader } from '../../shared/PageHeader';
import { Sheet } from '../../shared/Sheet';
import { ActionButton } from '../../shared/ActionButton';

export function RecipePages({ ai = false }: { ai?: boolean }) {
  const app = useApp();
  const { data } = app;
  const allSessions = useSessions() ?? [];
  const catalog = useCatalog(!ai);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [deleting, setDeleting] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search);
  const tokens = useMemo(
    () => deferredSearch.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [deferredSearch],
  );
  const recipeIds = useMemo(
    () => new Set(data.recipes.filter((r) => r.source === 'ai').map((r) => r.id)),
    [data.recipes],
  );
  const aiSessions = useMemo(
    () =>
      ai
        ? allSessions
            .filter((s) => recipeIds.has(s.recipeId))
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [ai, allSessions, recipeIds],
  );
  const versionIds = useMemo(() => [...new Set(aiSessions.map((s) => s.versionId))], [aiSessions]);
  const versions = useLiveQuery(
    async () =>
      new Map(
        (await db.versions.bulkGet(versionIds))
          .filter((v) => v !== undefined)
          .map((v) => [v.id, v]),
      ),
    [versionIds],
  );
  const builtinIndex = useMemo(
    () =>
      ai
        ? []
        : (catalog ?? []).map((r) => ({
            recipe: r,
            text: `${r.content.title} ${r.content.aliases.join(' ')} ${r.sourceText}`.toLowerCase(),
          })),
    [ai, catalog],
  );
  const builtins = useMemo(
    () =>
      builtinIndex
        .filter(
          ({ recipe, text }) =>
            (category === '全部' || recipe.content.cuisine === category) &&
            tokens.every((t) => text.includes(t)),
        )
        .map((item) => item.recipe),
    [builtinIndex, category, tokens],
  );
  const sessions = useMemo(
    () =>
      aiSessions.filter((s) => {
        const content = versions?.get(s.versionId)?.content;
        return (
          content &&
          tokens.every((t) =>
            `${content.title} ${content.aliases.join(' ')}`.toLowerCase().includes(t),
          )
        );
      }),
    [aiSessions, versions, tokens],
  );
  const builtinPage = usePagedItems(builtins, `${category}:${deferredSearch}`);
  const savedPage = usePagedItems(sessions, deferredSearch);
  const builtinRows = useMemo(
    () =>
      builtinPage.visible.map((recipe) => (
        <ActionButton
          className="catalog-row"
          key={recipe.id}
          pendingLabel="正在打开菜谱…"
          action={async () => {
            const session = await openBuiltin(recipe, data.preferences);
            await app.navigate({ page: 'cook', sessionId: session.id });
          }}
        >
          <span className="recipe-placeholder">
            <BookOpen size={22} strokeWidth={1.4} />
          </span>
          <span className="row-copy">
            <strong>{recipe.content.title}</strong>
            <span>
              {recipe.content.cuisine} · {recipe.content.minutes} 分钟 · {recipe.content.difficulty}
            </span>
          </span>
          <ChevronRight size={17} />
        </ActionButton>
      )),
    [builtinPage.visible, data.preferences, app.safe, app.navigate],
  );
  const savedRows = useMemo(
    () =>
      savedPage.visible.map((session) => {
        const version = versions!.get(session.versionId)!;
        return (
          <article className="saved-recipe" key={session.id}>
            <div className="saved-recipe-heading">
              <span className="recipe-placeholder">
                <ChefHat size={25} strokeWidth={1.4} />
              </span>
              <div className="row-copy">
                <h2>{version.content.title}</h2>
                <span>
                  <Clock3 size={12} /> {version.content.minutes} 分钟 · v{version.number} ·{' '}
                  {new Date(session.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
            <p className="muted small">{version.content.conditions}</p>
            {session.note && <p className="note-preview">{session.note}</p>}
            <div className="row-actions">
              <ActionButton
                className="secondary"
                pendingLabel="正在打开…"
                action={async () => {
                  await db.sessions.update(session.id, { currentCard: 0 });
                  await app.navigate({ page: 'cook', sessionId: session.id });
                }}
              >
                查看指南
                <ChevronRight size={14} />
              </ActionButton>
              <ActionButton
                className="text-button"
                pendingLabel="正在准备…"
                action={async () => {
                  const next = await cookAgain(session.id);
                  await app.navigate({ page: 'cook', sessionId: next.id });
                }}
              >
                <RotateCcw size={14} />
                再做一次
              </ActionButton>
              <button
                className="icon-button muted"
                aria-label={`删除${version.content.title}制作记录`}
                onClick={() => setDeleting(session.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        );
      }),
    [savedPage.visible, versions, app.safe, app.navigate],
  );
  if (ai ? !versions : !catalog)
    return (
      <div className="boot" role="status">
        <LoaderCircle className="spin" size={24} />
        正在打开菜谱…
      </div>
    );
  return (
    <>
      <PageHeader title={ai ? 'AI 菜谱' : '菜谱大全'} />
      <main className="page list-page">
        <div className="list-controls">
          <div className="search-field">
            <Search size={18} />
            <input
              ref={searchInput}
              aria-label="搜索菜名"
              placeholder="搜索菜名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="清空搜索"
                onClick={() => {
                  setSearch('');
                  searchInput.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            )}
          </div>
          {!ai && (
            <div className="category-tabs">
              {['全部', '中式', '西式与日式'].map((c) => (
                <button
                  key={c}
                  className={category === c ? 'active' : ''}
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        {!ai && (
          <>
            <p className="list-count">{builtins.length} 道家常菜</p>
            {builtinRows}
            {builtinPage.hasMore && (
              <div className="list-sentinel" ref={builtinPage.sentinel} aria-hidden="true" />
            )}
          </>
        )}
        {ai && (
          <>
            <p className="list-count">{sessions.length} 条制作记录</p>
            {savedRows}
            {savedPage.hasMore && (
              <div className="list-sentinel" ref={savedPage.sentinel} aria-hidden="true" />
            )}
          </>
        )}
        {(ai ? !sessions.length : !builtins.length) && (
          <div className="empty-state">
            <BookOpen size={32} strokeWidth={1.3} />
            <p>{search ? '没有匹配的菜谱' : '还没有 AI 菜谱'}</p>
            {search && (
              <button
                className="secondary"
                onClick={() => {
                  setSearch('');
                  setCategory('全部');
                  searchInput.current?.focus();
                }}
              >
                重置筛选
              </button>
            )}
            {!search && (
              <button
                className="primary"
                onClick={() => {
                  void app.navigate({ page: 'home' });
                }}
              >
                去选一道菜
              </button>
            )}
          </div>
        )}
      </main>
      {deleting && (
        <Sheet title="删除制作记录？" onClose={() => setDeleting(null)}>
          <p>此记录的心得、问答与计时也会删除。其他制作记录会保留。</p>
          <ActionButton
            className="danger wide"
            pendingLabel="正在删除…"
            success="已删除制作记录"
            action={async () => {
              await deleteSession(deleting);
              setDeleting(null);
            }}
          >
            确认删除
          </ActionButton>
          <button className="secondary wide" onClick={() => setDeleting(null)}>
            取消
          </button>
        </Sheet>
      )}
    </>
  );
}
