import type { Content } from './schema';

export function ingredientAmount(
  content: Content,
  use: { ingredientId: string; fraction: number },
): string {
  const ingredient = content.ingredients.find((i) => i.id === use.ingredientId);
  if (!ingredient) return '';
  if (use.fraction === 0) return ingredient.name;
  const amount =
    ingredient.quantity === null
      ? ingredient.amountText
      : `${Math.round(ingredient.quantity * use.fraction * 100) / 100}${ingredient.unit}`;
  return `${ingredient.name} ${amount}`;
}
export function renderAction(
  content: Content,
  action: { action: string; uses: { ingredientId: string; fraction: number }[] },
): string {
  return action.action.replace(/\{\{([^}]+)\}\}/g, (_, id: string) =>
    ingredientAmount(
      content,
      action.uses.find((u) => u.ingredientId === id) ?? { ingredientId: id, fraction: 0 },
    ),
  );
}
export function contentSearchText(content: Content): string {
  return [
    content.title,
    ...content.aliases,
    content.conditions,
    ...content.cookware,
    ...content.keyPoints,
    ...content.ingredients.map(
      (i) => `${i.name} ${i.quantity === null ? i.amountText : `${i.quantity}${i.unit}`} ${i.note}`,
    ),
    ...content.prep.map((p) => `${p.title} ${renderAction(content, p)} ${p.parallel}`),
    ...content.steps.map(
      (s) => `${s.title} ${renderAction(content, s)} ${s.heat} ${s.signal} ${s.tip}`,
    ),
  ].join(' ');
}
