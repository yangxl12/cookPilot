import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useApp } from '../../app/context';
import { loadCatalog } from '../../assets/recipes';
import { db, setSetting } from '../../storage/db';
import { openBuiltin } from '../../storage/repository';
import { PageHeader } from '../../shared/PageHeader';
import { WindowList } from '../../shared/WindowList';

const sources = [
  { id: 'ai', label: 'AI 菜谱' },
  { id: 'catalog', label: '菜谱大全' },
  { id: 'conversations', label: '对话历史' },
] as const;
type Source = (typeof sources)[number]['id'];
type SearchResult = {
  id: string;
  title: string;
  source: Source;
  snippet: string;
};

function initialSearch() {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  return params.get('q') ?? '';
}

function patternFor(terms: string[]) {
  return new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
}

function Highlight({ text, terms, pattern }: { text: string; terms: string[]; pattern: RegExp }) {
  return text
    .split(pattern)
    .map((part, index) =>
      terms.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : part,
    );
}

export function SearchPage() {
  const app = useApp();
  const [query, setQuery] = useState(initialSearch);
  const input = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(
    () => [...new Set(deferredQuery.toLowerCase().trim().split(/\s+/).filter(Boolean))],
    [deferredQuery],
  );
  const active = terms.length > 0;
  const worker = useRef<Worker | null>(null);
  const revision = useRef(0);
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [indexError, setIndexError] = useState<Error>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!active) {
      setMatches([]);
      setLoaded(false);
      return;
    }
    const current = new Worker(new URL('../../storage/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = current;
    current.onmessage = ({
      data,
    }: MessageEvent<{
      revision: number;
      rows: SearchResult[];
      reads: Record<string, number>;
      error?: string;
    }>) => {
      if (data.error) {
        setIndexError(new Error(data.error));
        return;
      }
      if (data.revision === revision.current) {
        if (performance.getEntriesByName('cookpilot:search').length >= 100)
          performance.clearMeasures('cookpilot:search');
        performance.measure('cookpilot:search', {
          start: performance.now(),
          detail: { reads: data.reads, count: data.rows.length },
        });
        setMatches(data.rows);
        setLoaded(true);
      }
    };
    current.onerror = () => setIndexError(new Error('搜索加载失败，请重新打开搜索'));
    return () => {
      current.terminate();
      worker.current = null;
    };
  }, [active]);
  useEffect(() => {
    revision.current++;
    setLoaded(false);
    worker.current?.postMessage({ revision: revision.current, terms });
  }, [terms]);

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

  const chooseQuery = (value: string) => {
    setQuery(value);
    input.current?.focus();
  };
  const open = useCallback(
    async (result: SearchResult) => {
      if (result.source === 'conversations') {
        await app.cancel();
        await setSetting('activeConversationId', result.id);
        await app.navigate({ page: 'home' });
      } else if (result.source === 'catalog') {
        const builtin = (await loadCatalog()).find((recipe) => recipe.id === result.id);
        if (!builtin) throw new Error('菜谱不存在');
        const session = await openBuiltin(builtin, app.data.preferences);
        await app.navigate({ page: 'cook', sessionId: session.id });
      } else {
        await db.sessions.update(result.id, { currentCard: 0 });
        await app.navigate({ page: 'cook', sessionId: result.id });
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

  if (indexError) throw indexError;

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

        {active && loaded && <SearchResults matches={matches} terms={terms} onSelect={select} />}
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
  const pattern = useMemo(() => patternFor(terms), [terms]);
  return (
    <section className="search-group" aria-label={`${label}搜索结果`}>
      <h2>{label}</h2>
      <WindowList
        key={terms.join('\0')}
        items={rows}
        estimate={120}
        render={(result) => (
          <button className="search-result" key={result.id} onClick={() => onSelect(result)}>
            <strong>
              <Highlight text={result.title} terms={terms} pattern={pattern} />
            </strong>
            <p>
              <Highlight text={result.snippet} terms={terms} pattern={pattern} />
            </p>
          </button>
        )}
      />
    </section>
  );
}
