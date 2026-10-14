import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useApp, type Route } from '../../app/context';
import { catalog } from '../../assets/recipes';
import { contentSearchText, isExpired } from '../../domain/rules';
import { db, setSetting } from '../../storage/db';
import { openBuiltin } from '../../storage/repository';
import { PageHeader } from '../../shared/PageHeader';
import { usePagedItems } from '../../shared/usePagedItems';

const sources = [
  { id: 'ai', label: 'AI 菜谱' },
  { id: 'catalog', label: '菜谱大全' },
  { id: 'conversations', label: '对话历史' },
] as const;
type Source = (typeof sources)[number]['id'];
type SearchResult = {
  id: string;
  title: string;
  body: string;
  source: Source;
  route?: Route;
  builtinId?: string;
  conversationId?: string;
  searchText: string;
};

function initialSearch() {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  return params.get('q') ?? '';
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
  const lower = text.toLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((n) => n >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 24) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + 110)}${text.length > start + 110 ? '…' : ''}`;
}

export function SearchPage() {
  const app = useApp();
  const { recipes, sessions } = app.data;
  const versions = useLiveQuery(() => db.versions.toArray(), []);
  const conversations = useLiveQuery(() => db.conversations.toArray(), []);
  const [query, setQuery] = useState(initialSearch);
  const input = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(
    () => [...new Set(deferredQuery.toLowerCase().trim().split(/\s+/).filter(Boolean))],
    [deferredQuery],
  );

  useEffect(() => {
    input.current?.focus();
    const restore = () => {
      if (location.hash.split('?')[0] !== '#search') return;
      setQuery(initialSearch());
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
    history.replaceState(history.state, '', `#search${params.size ? `?${params}` : ''}`);
    window.scrollTo(0, 0);
  }, [query]);

  const all = useMemo<SearchResult[]>(() => {
    const aiIds = new Set(
      recipes.filter((recipe) => recipe.source === 'ai').map((recipe) => recipe.id),
    );
    const byId = new Map(versions?.map((version) => [version.id, version]));
    const changes = new Map<string, string[]>();
    const contentText = new Map<string, string>();
    for (const version of versions ?? []) {
      const list = changes.get(version.recipeId) ?? [];
      list.push(version.change);
      changes.set(version.recipeId, list);
    }
    const results: Omit<SearchResult, 'searchText'>[] = [
      ...sessions
        .filter((session) => aiIds.has(session.recipeId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .flatMap((session): Omit<SearchResult, 'searchText'>[] => {
          const version = byId.get(session.versionId);
          if (!version) return [];
          if (!contentText.has(version.id))
            contentText.set(version.id, contentSearchText(version.content));
          return [
            {
              id: session.id,
              title: version.content.title,
              body: `${contentText.get(version.id)} ${session.note} ${changes.get(session.recipeId)?.join(' ') ?? ''}`,
              source: 'ai',
              route: { page: 'cook', sessionId: session.id },
            },
          ];
        }),
      ...catalog.map((recipe) => ({
        id: recipe.id,
        title: recipe.content.title,
        body: `${recipe.sourceText} ${contentSearchText(recipe.content)}`,
        source: 'catalog' as const,
        builtinId: recipe.id,
      })),
      ...(conversations ?? [])
        .filter((conversation) => !isExpired(conversation.lastSentAt))
        .sort((a, b) => b.lastSentAt - a.lastSentAt)
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          body: conversation.messages
            .map(
              (message) =>
                `${message.text} ${message.candidates?.map((recipe) => `${recipe.name} ${recipe.summary}`).join(' ') ?? ''}`,
            )
            .join(' '),
          source: 'conversations' as const,
          conversationId: conversation.id,
        })),
    ];
    return results.map((result) => ({
      ...result,
      searchText: `${result.title} ${result.body}`.toLowerCase(),
    }));
  }, [recipes, versions, sessions, conversations]);

  const matches = useMemo(
    () =>
      terms.length
        ? all.filter((result) => terms.every((term) => result.searchText.includes(term)))
        : [],
    [all, terms],
  );
  const chooseQuery = (value: string) => {
    setQuery(value);
    input.current?.focus();
  };
  const open = useCallback(
    async (result: SearchResult) => {
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
    },
    [app],
  );
  const select = useCallback(
    (result: SearchResult) => {
      void app.safe(() => open(result));
    },
    [app.safe, open],
  );

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
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索菜谱、心得、对话"
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
        </div>

        {terms.length > 0 && <SearchResults matches={matches} terms={terms} onSelect={select} />}
      </main>
    </>
  );
}

const SearchResults = memo(function SearchResults({
  matches,
  terms,
  onSelect,
}: {
  matches: SearchResult[];
  terms: string[];
  onSelect: (result: SearchResult) => void;
}) {
  return (
    <div className="search-results">
      {!matches.length && (
        <p className="search-empty" role="status">
          没有匹配结果
        </p>
      )}
      {sources.map((source) => {
        const rows = matches.filter((result) => result.source === source.id);
        return rows.length ? (
          <SearchGroup
            key={source.id}
            label={source.label}
            rows={rows}
            terms={terms}
            onSelect={onSelect}
          />
        ) : null;
      })}
    </div>
  );
});

function SearchGroup({
  label,
  rows,
  terms,
  onSelect,
}: {
  label: string;
  rows: SearchResult[];
  terms: string[];
  onSelect: (result: SearchResult) => void;
}) {
  const { visible, sentinel, hasMore } = usePagedItems(rows, terms.join('\0'));
  return (
    <section className="search-group" aria-label={`${label}搜索结果`}>
      <h2>{label}</h2>
      {visible.map((result) => (
        <button className="search-result" key={result.id} onClick={() => onSelect(result)}>
          <strong>
            <Highlight text={result.title} terms={terms} />
          </strong>
          <p>
            <Highlight text={snippet(result.body, terms)} terms={terms} />
          </p>
        </button>
      ))}
      {hasMore && <div className="list-sentinel" ref={sentinel} aria-hidden="true" />}
    </section>
  );
}
