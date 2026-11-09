import { liveQuery, type Table } from 'dexie';
import { db } from './db';
import { prepareSearchIndex, type StoredSearchResult } from './searchIndex';

type Row = { id: string };
const data = new Map<string, Map<string, any>>();
let query = { revision: 0, terms: [] as string[] };
let initialized = false;
const reads: Record<string, number> = {};
for (const table of db.tables)
  table.hook('reading', (row) => {
    reads[table.name] = (reads[table.name] ?? 0) + 1;
    return row;
  });
let scheduled: ReturnType<typeof setTimeout> | undefined;
let catalog: (Omit<StoredSearchResult, 'source'> & { source: 'catalog' })[] = [];

// Each 32-key subscription reloads only its affected block. Additions/deletions
// rebuild that table's key subscriptions; unrelated version/message bodies stay cached.
function observe(
  table: Table<Row>,
  keysQuery = () => table.toCollection().primaryKeys(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      reject(error);
      if (initialized) self.postMessage({ error: '搜索索引读取失败，请重新打开搜索' });
    };
    let blocks: { unsubscribe(): void }[] = [];
    let previousKeys: string | undefined;
    liveQuery(keysQuery).subscribe({
      next: (keys) => {
        const encoded = JSON.stringify(keys);
        if (previousKeys === encoded) return;
        previousKeys = encoded;
        blocks.forEach((block) => block.unsubscribe());
        blocks = [];
        const rows = new Map<string, Row>();
        data.set(table.name, rows);
        let remaining = Math.ceil(keys.length / 32);
        if (!remaining) {
          resolve();
          schedule();
        }
        for (let i = 0; i < keys.length; i += 32) {
          const ids = keys.slice(i, i + 32);
          let first = true;
          blocks.push(
            liveQuery(() => table.bulkGet(ids)).subscribe({
              next: (values) => {
                for (const id of ids) rows.delete(String(id));
                for (const value of values) if (value) rows.set(value.id, value);
                if (first) {
                  first = false;
                  if (--remaining === 0) resolve();
                }
                schedule();
              },
              error: fail,
            }),
          );
        }
      },
      error: fail,
    });
  });
}

function schedule() {
  clearTimeout(scheduled);
  if (initialized) scheduled = setTimeout(search, 0);
}

function snippet(parts: { body: string; searchText: string }[]) {
  const part = parts.find((p) => query.terms.some((t) => p.searchText.includes(t))) ?? parts[0];
  const body = part?.body.replace(/\s+/g, ' ').trim() ?? '';
  const positions = query.terms.map((t) => body.toLowerCase().indexOf(t)).filter((i) => i >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 24) : 0;
  return `${start ? '…' : ''}${body.slice(start, start + 110)}${body.length > start + 110 ? '…' : ''}`;
}

async function search() {
  const current = query;
  if (!current.terms.length) return;
  const get = (name: string) => data.get(name) ?? new Map<string, any>();
  const changes = new Map<string, string[]>();
  for (const summary of get('versionSummaries').values()) {
    const values = changes.get(summary.recipeId) ?? [];
    values.push(summary.change ?? '');
    changes.set(summary.recipeId, values);
  }
  const changeParts = new Map(
    [...changes].map(([id, values]) => {
      const body = values.join(' ');
      return [id, { body, searchText: body.toLowerCase() }];
    }),
  );
  const conversations = new Map<string, { body: string; searchText: string }[]>();
  for (const message of get('messageSearch').values()) {
    const parts = conversations.get(message.conversationId) ?? [];
    parts.push(message);
    conversations.set(message.conversationId, parts);
  }
  const rows: StoredSearchResult[] = [];
  for (const session of [...get('sessions').values()].sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  )) {
    if (get('recipes').get(session.recipeId)?.source !== 'ai') continue;
    const version = get('versionSearch').get(session.versionId);
    if (version)
      rows.push({
        id: session.id,
        title: version.title,
        source: 'ai',
        parts: [
          version,
          { body: session.note, searchText: session.note.toLowerCase() },
          changeParts.get(session.recipeId) ?? { body: '', searchText: '' },
        ],
      });
  }
  for (const conversation of [...get('conversationSearch').values()].sort(
    (a, b) => b.lastSentAt - a.lastSentAt || b.id.localeCompare(a.id),
  )) {
    if (conversation.lastSentAt < Date.now() - 30 * 86400000) continue;
    rows.push({
      id: conversation.id,
      title: conversation.title,
      source: 'conversations',
      parts: [
        { body: conversation.title, searchText: conversation.title.toLowerCase() },
        conversation,
        ...(conversations.get(conversation.id) ?? []),
      ],
    });
  }
  if (current !== query) return;
  const matches = [...rows, ...catalog].filter((row) =>
    current.terms.every((term) => row.parts.some((p) => p.searchText.includes(term))),
  );
  self.postMessage({
    revision: current.revision,
    reads,
    rows: matches.map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source,
      snippet: snippet(row.parts),
    })),
  });
}

self.onmessage = async ({ data: request }: MessageEvent<typeof query>) => {
  query = request;
  if (initialized) {
    schedule();
    return;
  }
};

async function initialize() {
  // Fetch only the prebuilt search asset. Complete recipe objects are loaded on selection.
  const { default: url } = await import('../assets/recipes/search.json?url');
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error('菜谱搜索数据加载失败');
  catalog = await response.json();
  await Promise.all([prepareSearchIndex('version'), prepareSearchIndex('conversation')]);
  await Promise.all(
    [
      'recipes',
      'sessions',
      'versionSearch',
      'versionSummaries',
      'conversationSearch',
      'messageSearch',
    ].map((name) =>
      name === 'versionSearch'
        ? observe(db.table(name), () => db.sessions.orderBy('versionId').uniqueKeys())
        : observe(db.table(name)),
    ),
  );
  initialized = true;
  schedule();
  // Clear/import operations may change readiness without changing a result key.
  liveQuery(() =>
    db.settings.bulkGet(['versionSearchReady-v4', 'conversationSearchReady-v4']),
  ).subscribe(schedule);
}
void initialize().catch(() => self.postMessage({ error: '搜索索引加载失败，请重新打开搜索' }));
