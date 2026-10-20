import type { ModelConfig } from '../../domain/schema';

// Official model names: https://api-docs.deepseek.com/quick_start/pricing/
export const DEEPSEEK_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODELS = [
  { name: 'DeepSeek Flash', model: 'deepseek-flash' },
  { name: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro' },
] as const;

export function isDeepSeek(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.deepseek.com';
  } catch {
    return false;
  }
}

// The tools API lives at a fixed path: https://api-docs.deepseek.com/zh-cn/guides/search/
export function searchEndpoint(url: string): string {
  const root = url
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/v1$/, '');
  return `${root}/v1/tools/search`;
}

export function isRetiredDeepSeek(config: ModelConfig): boolean {
  return (
    isDeepSeek(config.url) && ['deepseek-chat', 'deepseek-reasoner'].includes(config.model.trim())
  );
}

export function normalizeModelConfig(config: ModelConfig): ModelConfig {
  const model = config.model.trim();
  if (
    isDeepSeek(config.url) &&
    ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)
  )
    return { ...config, model: 'deepseek-flash' };
  return { ...config, model };
}

export const retiredModelMessage =
  'DeepSeek 已停用此模型，请改用 deepseek-flash 或 deepseek-v4-pro';
