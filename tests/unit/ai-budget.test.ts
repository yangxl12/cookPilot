import { afterEach, expect, it, vi } from 'vitest';
import { chat } from '../../src/services/ai/client';
import { generate } from '../../src/services/ai/cooking';
import { search } from '../../src/services/ai/search';
import { startTaskBudget, TaskTimeoutError } from '../../src/services/ai/budget';
import { defaultPreferences } from '../../src/domain/schema';

const model = {
  id: 'test',
  name: 'test',
  model: 'deepseek-flash',
  url: 'https://api.deepseek.com',
  key: 'test',
};
const candidate = {
  name: '西红柿炒鸡蛋',
  aliases: [],
  minutes: 15,
  difficulty: '简单' as const,
  summary: '',
  blocked: '',
};
const response = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('搜索悬挂在3.5秒降级，后续三轮生成共用剩余60秒预算', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const stop = startTaskBudget(controller);
  const fetcher = vi.fn().mockImplementation(
    (url: string, init: RequestInit) =>
      new Promise((resolve, reject) => {
        const timer = url.includes('/tools/search')
          ? undefined
          : setTimeout(() => resolve(response('{}')), 20_000);
        init.signal!.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(init.signal!.reason);
          },
          { once: true },
        );
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  try {
    const pendingSearch = search(model, '番茄炒蛋', { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(3499);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pendingSearch).resolves.toEqual([]);
    const pending = generate(model, candidate, '', defaultPreferences(), controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(TaskTimeoutError);
    await vi.advanceTimersByTimeAsync(56_499);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally {
    stop();
  }
});

it('第三次请求只保留最近失败输出和原始约束', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response('{"obsolete":true}'))
    .mockResolvedValueOnce(response('{"latest":true}'))
    .mockResolvedValueOnce(response('{}'));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    generate(
      model,
      candidate,
      '番茄400g，鸡蛋3个',
      defaultPreferences(),
      new AbortController().signal,
    ),
  ).rejects.toThrow('校验未通过');
  const messages = JSON.parse(fetcher.mock.calls[2][1].body).messages;
  expect(messages).toHaveLength(4);
  expect(messages[1].content).toContain('番茄400g，鸡蛋3个');
  expect(messages[2].content).toBe('{"latest":true}');
  expect(JSON.stringify(messages)).not.toContain('obsolete');
});

it('重试等待期到达任务期限后不再发送请求', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const stop = startTaskBudget(controller, 300);
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  try {
    const rejected = expect(chat(model, [], { signal: controller.signal })).rejects.toBeInstanceOf(
      TaskTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(300);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it('取消后丢弃不遵守abort的迟到响应，提前取消不发送请求', async () => {
  const controller = new AbortController();
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const rejected = expect(chat(model, [], { signal: controller.signal })).rejects.toThrow(
    '请求已取消',
  );
  controller.abort();
  finish(response('迟到内容'));
  await rejected;
  await expect(chat(model, [], { signal: controller.signal })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
