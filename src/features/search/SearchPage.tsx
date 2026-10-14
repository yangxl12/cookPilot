import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChefHat, ChevronRight, History, Search, X } from 'lucide-react';
import { useApp, type Route } from '../../app/context';
import { catalog } from '../../assets/recipes';
import { contentSearchText, isExpired } from '../../domain/rules';
import { db, setSetting } from '../../storage/db';
import { openBuiltin } from '../../storage/repository';
import { PageHeader } from '../recipes/RecipePages';

const sources = [
  { id: 'ai', label: 'AI 菜谱', icon: ChefHat, description: '菜谱正文、制作心得与版本调整' },
  { id: 'catalog', label: '菜谱大全', icon: BookOpen, description: '200 道家常菜的食材与做法' },
  { id: 'conversations', label: '对话历史', icon: History, description: '近 30 天的提问与回答' },
] as const;
type Source = (typeof sources)[number]['id'];
type Scope = 'all' | Source;
type SearchResult = {
  id: string;
  title: string;
  body: string;
  source: Source;
  detail: string;
  route?: Route;
  builtinId?: string;
  conversationId?: string;
};

function initialSearch() {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  const scope = params.get('scope');
  return {
    query: params.get('q') ?? '',
    scope: sources.some((source) => source.id === scope) ? (scope as Source) : ('all' as const),
  };
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!pattern) return <>{text}</>;
  return text
    .split(new RegExp(`(${pattern})`, 'gi'))
    .map((part, index) =>
      terms.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : part,
    );
}

function snippet(body: string, terms: string[]) {
  const text = body.replace(/\s+/g, ' ').trim();
  const positions = terms.map((term) => text.toLowerCase().indexOf(term)).filter((n) => n >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 24) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + 110)}${text.length > start + 110 ? '…' : ''}`;
}

export function SearchPage() {
  const app = useApp();
  const { recipes, versions, sessions, conversations } = app.data;
  const [query, setQuery] = useState(() => initialSearch().query);
  const [scope, setScope] = useState<Scope>(() => initialSearch().scope);
  const input = useRef<HTMLInputElement>(null);
  const terms = [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))];

  useEffect(() => {
    input.current?.focus();
    const restore = () => {
      if (location.hash.split('?')[0] !== '#search') return;
      const search = initialSearch();
      setQuery(search.query);
      setScope(search.scope);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, []);

  useEffect(() => {
    // Replacing this entry keeps typing out of browser history and restores searches on return.
    if (location.hash.split('?')[0] !== '#search') return;
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (scope !== 'all') params.set('scope', scope);
    history.replaceState(history.state, '', `#search${params.size ? `?${params}` : ''}`);
    window.scrollTo(0, 0);
  }, [query, scope]);

  const all = useMemo<SearchResult[]>(
    () => [
      ...sessions
        .filter(
          (session) => recipes.find((recipe) => recipe.id === session.recipeId)?.source === 'ai',
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .flatMap((session): SearchResult[] => {
          const version = versions.find((item) => item.id === session.versionId);
          if (!version) return [];
          return [
            {
              id: session.id,
              title: version.content.title,
              body: `${contentSearchText(version.content)} ${session.note} ${versions
                .filter((item) => item.recipeId === session.recipeId)
                .map((item) => item.change)
                .join(' ')}`,
              source: 'ai',
              detail: `${version.content.minutes} 分钟 · v${version.number}${session.note ? ' · 有制作心得' : ''}`,
              route: { page: 'cook', sessionId: session.id },
            },
          ];
        }),
      ...catalog.map((recipe): SearchResult => ({
        id: recipe.id,
        title: recipe.content.title,
        body: `${recipe.sourceText} ${contentSearchText(recipe.content)}`,
        source: 'catalog',
        detail: `${recipe.content.cuisine} · ${recipe.content.minutes} 分钟 · ${recipe.content.difficulty}`,
        builtinId: recipe.id,
      })),
      ...conversations
        .filter((conversation) => !isExpired(conversation.lastSentAt))
        .sort((a, b) => b.lastSentAt - a.lastSentAt)
        .map((conversation): SearchResult => ({
          id: conversation.id,
          title: conversation.title,
          body: conversation.messages
            .map(
              (message) =>
                `${message.text} ${message.candidates?.map((recipe) => `${recipe.name} ${recipe.summary}`).join(' ') ?? ''}`,
            )
            .join(' '),
          source: 'conversations',
          detail: `${new Date(conversation.lastSentAt).toLocaleDateString('zh-CN')} · ${conversation.messages.filter((message) => message.role === 'user').length} 条提问`,
          conversationId: conversation.id,
        })),
    ],
    [recipes, versions, sessions, conversations],
  );

  const matches = terms.length
    ? all.filter((result) =>
        terms.every((term) => `${result.title} ${result.body}`.toLowerCase().includes(term)),
      )
    : [];
  const visible = matches.filter((result) => scope === 'all' || result.source === scope);
  const counts = terms.length ? matches : all;
  const chooseQuery = (value: string) => {
    setQuery(value);
    input.current?.focus();
  };
  const open = async (result: SearchResult) => {
    if (result.conversationId) {
      await app.cancel();
      await setSetting('activeConversationId', result.conversationId);
      await app.navigate({ page: 'home' });
    } else if (result.builtinId) {
      const session = await openBuiltin(
        catalog.find((recipe) => recipe.id === result.builtinId)!,
        app.data.preferences,
      );
      await app.navigate({ page: 'cook', sessionId: session.id });
    } else if (result.route) {
      await db.sessions.update(result.route.sessionId!, { currentCard: 0 });
      await app.navigate(result.route);
    }
  };

  return (
    <>
      <PageHeader title="全局搜索" />
      <main className="page global-search-page">
        <div className="search-controls">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              input.current?.blur();
            }}
          >
            <div className="search-field global-search-field">
              <Search size={20} aria-hidden="true" />
              <input
                ref={input}
                autoFocus
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                aria-label="全局搜索"
                aria-describedby="search-hint"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索菜谱、食材、心得或对话"
              />
              {query && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="清空搜索"
                  onClick={() => chooseQuery('')}
                >
                  <X size={17} />
                </button>
              )}
            </div>
          </form>
          <p className="search-hint" id="search-hint">
            多个关键词用空格分隔，一起查找更准确
          </p>
          <div className="search-filters" role="group" aria-label="搜索范围">
            {([{ id: 'all', label: '全部' }, ...sources] as const).map((source) => (
              <button
                key={source.id}
                aria-pressed={scope === source.id}
                onClick={() => setScope(source.id)}
              >
                {source.label}
                <span>
                  {source.id === 'all'
                    ? counts.length
                    : counts.filter((result) => result.source === source.id).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!terms.length ? (
          <div className="search-start">
            <div className="search-intro">
              <span className="search-illustration">
                <Search size={28} strokeWidth={1.5} />
              </span>
              <h2>找一道菜，也找回做菜的心得</h2>
              <p>从菜名或食材开始，查找菜谱和聊过的做法。</p>
            </div>
            <section className="search-suggestions" aria-label="关键词建议">
              <h3>试试这些关键词</h3>
              <div>
                {['鸡蛋', '土豆', '鸡肉', '番茄'].map((word) => (
                  <button key={word} onClick={() => chooseQuery(word)}>
                    {word}
                  </button>
                ))}
              </div>
            </section>
            <section className="search-coverage" aria-label="可搜索的内容">
              <h3>可以搜索哪些内容</h3>
              {sources
                .filter((source) => scope === 'all' || source.id === scope)
                .map((source) => (
                  <div className="search-source" key={source.id}>
                    <source.icon size={21} strokeWidth={1.5} />
                    <div>
                      <strong>{source.label}</strong>
                      <p>{source.description}</p>
                    </div>
                    <span>{all.filter((result) => result.source === source.id).length}</span>
                  </div>
                ))}
            </section>
          </div>
        ) : (
          <div className="search-results">
            <p className="search-summary" role="status">
              找到 {visible.length} 条结果
            </p>
            {!visible.length && (
              <div className="search-empty">
                <Search size={30} strokeWidth={1.4} />
                <h2>没有匹配结果</h2>
                <p>
                  {matches.length
                    ? '其他分类里有匹配内容，试试查看全部结果。'
                    : '试试更短的菜名、食材，或减少关键词。'}
                </p>
                <button
                  className="secondary"
                  onClick={() => (matches.length ? setScope('all') : chooseQuery(''))}
                >
                  {matches.length ? '查看全部结果' : '重新搜索'}
                </button>
              </div>
            )}
            {sources.map((source) => {
              const rows = visible.filter((result) => result.source === source.id);
              return rows.length ? (
                <section
                  className="search-group"
                  key={source.id}
                  aria-label={`${source.label}搜索结果`}
                >
                  <h2>
                    <source.icon size={16} />
                    {source.label}
                    <span>{rows.length}</span>
                  </h2>
                  {rows.map((result) => (
                    <button
                      className="search-result"
                      key={result.id}
                      onClick={() => void app.safe(() => open(result))}
                    >
                      <div className="search-result-copy">
                        <strong>
                          <Highlight text={result.title} terms={terms} />
                        </strong>
                        <small>{result.detail}</small>
                        <p>
                          <Highlight text={snippet(result.body, terms)} terms={terms} />
                        </p>
                      </div>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  ))}
                </section>
              ) : null;
            })}
          </div>
        )}
      </main>
    </>
  );
}
