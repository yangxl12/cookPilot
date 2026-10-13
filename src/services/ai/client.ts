import type { ModelConfig } from '../../domain/schema';
import {
  isDeepSeek,
  isRetiredDeepSeek,
  normalizeModelConfig,
  retiredModelMessage,
} from './providers';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelSnapshot = ModelConfig & { key: string };
export class ModelError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}
export function endpoint(base: string): string {
  const clean = base.replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}
export async function chat(
  snapshot: ModelSnapshot,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; json?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (isRetiredDeepSeek(snapshot)) throw new ModelError(retiredModelMessage);
  let service: URL;
  try {
    service = new URL(snapshot.url);
  } catch {
    throw new ModelError('接口地址不是有效的网址');
  }
  if (
    service.username ||
    service.password ||
    service.search ||
    service.hash ||
    !['https:', 'http:'].includes(service.protocol) ||
    (service.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(service.hostname))
  )
    throw new ModelError('请输入有效的 HTTPS 接口地址（本机服务可使用 HTTP）');
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timeout = false;
  const handle = setTimeout(() => {
    timeout = true;
    controller.abort();
  }, options.timeoutMs ?? 90000);
  try {
    const body: Record<string, unknown> = {
      model: normalizeModelConfig(snapshot).model,
      messages,
      stream: false,
      max_tokens: options.maxTokens ?? 4096,
    };
    if (options.json) body.response_format = { type: 'json_object' };
    // DeepSeek defaults to thinking; disable it to keep interactive requests small.
    if (isDeepSeek(snapshot.url)) body.thinking = { type: 'disabled' };
    const response = await fetch(endpoint(snapshot.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(snapshot.key ? { Authorization: `Bearer ${snapshot.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) {
      const explanation: Record<number, string> = {
        400: '请求参数或模型名称不受支持，请检查配置',
        401: 'API Key 无效或已失效',
        402: '模型账户余额不足',
        403: '模型服务拒绝访问，请检查权限',
        404: '接口地址或模型名称不存在',
        429: '请求过于频繁，请稍后重试',
        500: '模型服务暂时出错',
        503: '模型服务繁忙，请稍后重试',
      };
      // Never echo provider bodies: upstream errors can include credentials and private prompts.
      throw new ModelError(
        `${explanation[response.status] ?? '模型请求失败'}（HTTP ${response.status}）`,
        response.status,
      );
    }
    const result = await response.json();
    const choice = result.choices?.[0];
    if (choice?.finish_reason === 'length')
      throw new ModelError('模型输出被截断，未保存。请重试或简化要求');
    if (choice?.finish_reason && choice.finish_reason !== 'stop')
      throw new ModelError('模型未完整生成回复，请稍后重试');
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim())
      throw new ModelError('模型返回空内容，请重试');
    return content.trim();
  } catch (error) {
    if (timeout) throw new ModelError('请求超时，未自动重试；上游可能已产生用量，请稍后重试');
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (error instanceof ModelError) throw error;
    throw new ModelError('无法连接模型。请检查网络、接口地址和浏览器跨域支持');
  } finally {
    clearTimeout(handle);
    options.signal?.removeEventListener('abort', abort);
  }
}
export function parseJson(text: string): unknown {
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new ModelError('模型返回的 JSON 无法解析，未保存');
  }
}
export async function testConnection(
  snapshot: ModelSnapshot,
  signal?: AbortSignal,
): Promise<string> {
  return chat(snapshot, [{ role: 'user', content: '只回复：连接成功' }], {
    signal,
    maxTokens: 24,
    timeoutMs: 30000,
  });
}
