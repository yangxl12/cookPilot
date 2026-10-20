import type { ModelSnapshot } from './client';
import { isDeepSeek, searchEndpoint } from './providers';

/** One web page the model may consult. score is DeepSeek's rerank value: 0~3, -1 when unknown. */
export type Reference = { title: string; url: string; summary: string; score: number };

// Only the official endpoint documents a tools API; compatible third-party services do not.
export function canSearch(snapshot: ModelSnapshot): boolean {
  return isDeepSeek(snapshot.url) && Boolean(snapshot.key.trim());
}

/** UI-side check: does this provider have a search API at all? Key presence is checked later. */
export function supportsSearch(url: string): boolean {
  return isDeepSeek(url);
}

// DeepSeek returns Markdown summaries that open with headings and filler; strip the syntax so
// the useful lines survive truncation. count is free (billing is per request), so keep several.
const clean = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
};
const limit = (value: unknown, max = 600) => {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/**
 * Search is an optional aid: any failure returns no references so the request still completes.
 * Aborting is the only error that propagates, because the user asked to stop.
 * https://api-docs.deepseek.com/zh-cn/guides/search/
 */
export async function search(
  snapshot: ModelSnapshot,
  query: string,
  options: {
    signal?: AbortSignal;
    count?: number;
    timeoutMs?: number;
    /** Drop weak matches; unknown scores never filter. Rerank ≥ 1.5 is documented as good. */
    minScore?: number;
    maxChars?: number;
  } = {},
): Promise<Reference[]> {
  if (!canSearch(snapshot) || !query.trim()) return [];
  const maxChars = options.maxChars ?? 600;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timeout = false;
  const handle = setTimeout(() => {
    timeout = true;
    controller.abort();
  }, options.timeoutMs ?? 12000);
  try {
    const response = await fetch(searchEndpoint(snapshot.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${snapshot.key}`,
      },
      body: JSON.stringify({
        query: query.trim().slice(0, 128),
        count: options.count ?? 5,
        need_content: false,
      }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const results: unknown = payload?.results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((item: Record<string, unknown>) => {
      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return [];
      const raw = item.rerank_score;
      const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : -1;
      if (score >= 0 && score < (options.minScore ?? 0)) return [];
      const summary = limit(item.summary, maxChars) || limit(item.snippet, maxChars);
      if (!summary) return [];
      return [{ title: limit(item.title) || url, url, summary, score }];
    });
  } catch {
    if (!timeout && controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    return [];
  } finally {
    clearTimeout(handle);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Compact prompt block. Empty when there is nothing to cite. */
export function referenceBlock(
  references: Reference[],
  note = '仅用于核对做法、用量和关键点；与用户要求冲突时以用户要求为准',
): string {
  if (!references.length) return '';
  return `网络参考（${note}；不要把网址写进输出）：
${references.map((reference, index) => `${index + 1}. ${reference.title}：${reference.summary}`).join('\n')}`;
}
