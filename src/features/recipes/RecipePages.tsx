import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChefHat,
  ChevronRight,
  Clock3,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../app/context';
import { catalog } from '../../assets/recipes';
import { cookAgain, deleteSession, openBuiltin } from '../../storage/repository';
import { db } from '../../storage/db';
import { Sheet } from '../../shared/Sheet';

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const { back } = useApp();
  return (
    <header className="root-header">
      <button className="icon-button" aria-label="返回" onClick={back}>
        <ArrowLeft size={21} />
      </button>
      <h1>{title}</h1>
      <div>{children}</div>
    </header>
  );
}
export function RecipePages({ ai = false }: { ai?: boolean }) {
  const app = useApp();
  const { data } = app;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [deleting, setDeleting] = useState<string | null>(null);
  const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const builtins = catalog.filter(
    (r) =>
      (category === '全部' || r.content.cuisine === category) &&
      tokens.every((t) =>
        `${r.content.title} ${r.content.aliases.join(' ')} ${r.sourceText}`
          .toLowerCase()
          .includes(t),
      ),
  );
  const sessions = data.sessions
    .filter((s) => data.recipes.find((r) => r.id === s.recipeId)?.source === 'ai')
    .filter((s) => {
      const content = data.versions.find((v) => v.id === s.versionId)?.content;
      return (
        content &&
        tokens.every((t) =>
          `${content.title} ${content.aliases.join(' ')}`.toLowerCase().includes(t),
        )
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
      <PageHeader title={ai ? 'AI 菜谱' : '菜谱大全'} />
      <main className="page list-page">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="搜索菜名"
            placeholder="搜索菜名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!ai && (
          <>
            <div className="category-tabs">
              {['全部', '中式', '西式与日式'].map((c) => (
                <button
                  key={c}
                  className={category === c ? 'active' : ''}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="list-count">{builtins.length} 道家常菜</p>
            {builtins.map((recipe) => (
              <button
                className="catalog-row"
                key={recipe.id}
                onClick={() => {
                  void app.safe(async () => {
                    const session = await openBuiltin(recipe, data.preferences);
                    await app.navigate({ page: 'cook', sessionId: session.id });
                  });
                }}
              >
                <span className="recipe-placeholder">
                  <BookOpen size={22} strokeWidth={1.4} />
                </span>
                <span className="row-copy">
                  <strong>{recipe.content.title}</strong>
                  <span>
                    {recipe.content.cuisine} · {recipe.content.minutes} 分钟 ·{' '}
                    {recipe.content.difficulty}
                  </span>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </>
        )}
        {ai && (
          <>
            <p className="list-count">{sessions.length} 条制作记录</p>
            {sessions.map((session) => {
              const version = data.versions.find((v) => v.id === session.versionId)!;
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
                    <button
                      className="text-button"
                      onClick={() => {
                        void app.safe(async () => {
                          await db.sessions.update(session.id, { currentCard: 0 });
                          await app.navigate({ page: 'cook', sessionId: session.id });
                        });
                      }}
                    >
                      查看指南
                      <ChevronRight size={14} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        void app.safe(async () => {
                          const next = await cookAgain(session.id);
                          await app.navigate({ page: 'cook', sessionId: next.id });
                        });
                      }}
                    >
                      <RotateCcw size={14} />
                      再做一次
                    </button>
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
            })}
          </>
        )}
        {(ai ? !sessions.length : !builtins.length) && (
          <div className="empty-state">
            <BookOpen size={32} strokeWidth={1.3} />
            <p>{search ? '没有匹配的菜谱' : '还没有 AI 菜谱'}</p>
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
          <button
            className="danger wide"
            onClick={() => {
              void app.safe(async () => {
                await deleteSession(deleting);
                setDeleting(null);
              }, '已删除制作记录');
            }}
          >
            确认删除
          </button>
          <button className="secondary wide" onClick={() => setDeleting(null)}>
            取消
          </button>
        </Sheet>
      )}
    </>
  );
}
