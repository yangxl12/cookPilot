export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
const aliases = [
  ['西红柿炒鸡蛋', '番茄炒蛋', '番茄炒鸡蛋', '西红柿炒蛋'],
  ['宫保鸡丁', '宫爆鸡丁'],
];
export function identity(name: string): string {
  const normalized = normalizeName(name);
  const group = aliases.find((names) => names.some((n) => normalizeName(n) === normalized));
  return group ? normalizeName(group[0]) : normalized;
}
export function nameMatches(name: string, names: string[]): boolean {
  return names.some((n) => identity(n) === identity(name));
}
