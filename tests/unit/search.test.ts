import { afterEach, expect, it, vi } from 'vitest';
import { canSearch, referenceBlock, search } from '../../src/services/ai/search';
import { searchEndpoint } from '../../src/services/ai/providers';

const model = {
  id: 'test',
  name: 'test',
  model: 'deepseek-flash',
  url: 'https://api.deepseek.com',
  key: 'private-test-key',
};
const payload = (results: unknown) => new Response(JSON.stringify({ results }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['https://api.deepseek.com', 'https://api.deepseek.com/v1/tools/search'],
  ['https://api.deepseek.com/', 'https://api.deepseek.com/v1/tools/search'],
  ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/tools/search'],
  ['https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/v1/tools/search'],
])('%s 拼出固定的搜索地址', (base, expected) => {
  expect(searchEndpoint(base)).toBe(expected);
});

it('只有官方接口且带 Key 时才启用搜索，第三方不占用额度', async () => {
  expect(canSearch(model)).toBe(true);
  expect(canSearch({ ...model, url: 'https://example.com/v1' })).toBe(false);
  expect(canSearch({ ...model, key: '  ' })).toBe(false);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await search({ ...model, url: 'https://example.com/v1' }, '宫保鸡丁')).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});

it('请求只取摘要，不抓正文', async () => {
  const fetcher = vi.fn().mockResolvedValue(payload([]));
  vi.stubGlobal('fetch', fetcher);
  await search(model, '  宫保鸡丁 做法  ', { count: 4 });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.deepseek.com/v1/tools/search');
  expect(init.headers.Authorization).toBe(`Bearer ${model.key}`);
  expect(JSON.parse(init.body)).toEqual({
    query: '宫保鸡丁 做法',
    count: 4,
    need_content: false,
  });
});

it('丢弃没有正文或不是网页的条目，摘要清理 Markdown 并截断', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      payload([
        { title: 'A', url: 'https://a.example/1', summary: '做法一' },
        { title: 'B', url: 'javascript:alert(1)', summary: '坏链接' },
        { title: 'C', url: 'https://c.example/3', summary: '', snippet: '短摘要' },
        { title: 'D', url: 'https://d.example/4', summary: '   ' },
        {
          title: 'E',
          url: 'https://e.example/5',
          summary: `# 标题\n\n**鸡腿肉** 120 克，[参考](https://x.example)\n\n${'长'.repeat(800)}`,
        },
        { url: 'https://f.example/6', summary: '无标题' },
      ]),
    ),
  );
  const references = await search(model, '宫保鸡丁');
  expect(references.map((r) => r.title)).toEqual(['A', 'C', 'E', 'https://f.example/6']);
  expect(references[1].summary).toBe('短摘要');
  expect(references[2].summary.startsWith('标题\n鸡腿肉 120 克，参考\n长')).toBe(true);
  expect(references[2].summary).toHaveLength(601);
  expect(references[2].summary.endsWith('…')).toBe(true);
});

it('搜索失败或返回异常结构时静默降级，不影响生成', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
  expect(await search(model, '宫保鸡丁')).toEqual([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
  expect(await search(model, '宫保鸡丁')).toEqual([]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  expect(await search(model, '宫保鸡丁')).toEqual([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"results":{}}')));
  expect(await search(model, '宫保鸡丁')).toEqual([]);
});

it('用户取消时抛出取消错误而不是假装没有参考', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('请求已取消', 'AbortError')),
            ),
          ),
      ),
  );
  const pending = search(model, '宫保鸡丁', { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('请求已取消');
});

it('参考块为空时不污染提示词', () => {
  expect(referenceBlock([])).toBe('');
  const block = referenceBlock([{ title: 'A', url: 'https://a.example', summary: '做法一' }]);
  expect(block).toContain('1. A：做法一');
  expect(block).toContain('不要把网址写进输出');
});
