import type { Conversation } from './conversations';
import type { Guide, Recipe } from './data';

// Search readable content, including nested ingredients, preparation and steps.
function contentText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join(' · ');
  if (value && typeof value === 'object') return Object.entries(value)
    .filter(([key]) => !['id', 'image', 'stepId', 'savedId', 'guideId', 'subtitle', 'reason'].includes(key))
    .map(([, entry]) => contentText(entry)).filter(Boolean).join(' · ');
  return '';
}

function findMatches<T>(items: T[], query: string, getContent: (item: T) => unknown) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return items.flatMap((item) => {
    const text = contentText(getContent(item));
    const lower = text.toLocaleLowerCase();
    if (!terms.every((term) => lower.includes(term))) return [];
    const firstMatch = Math.min(...terms.map((term) => lower.indexOf(term)));
    const start = Math.max(0, firstMatch - 24);
    const end = Math.min(text.length, Math.max(start + 110, firstMatch + terms[0].length));
    return [{ item, excerpt: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` }];
  });
}

export function searchAll(query: string, guides: Guide[], recipes: Recipe[], conversations: Conversation[]) {
  return {
    ai: findMatches(guides.filter((guide) => guide.source === 'ai'), query,
      (guide) => [guide.recipe, guide.conditions, guide.note, guide.changes]),
    catalog: findMatches(recipes, query, (recipe) => recipe),
    history: findMatches(conversations, query, (conversation) => [conversation.title, conversation.turns]),
  };
}
