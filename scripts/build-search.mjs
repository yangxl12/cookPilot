import { format } from 'prettier';
import { readFile, writeFile } from 'node:fs/promises';
import { contentSearchText } from '../src/domain/contentText.ts';

const recipes = JSON.parse(
  await readFile(new URL('../src/assets/recipes/catalog.json', import.meta.url), 'utf8'),
);
const rows = recipes.map((recipe) => {
  const body = `${recipe.content.title} ${recipe.sourceText} ${contentSearchText(recipe.content)}`;
  return {
    id: recipe.id,
    title: recipe.content.title,
    source: 'catalog',
    parts: [{ body, searchText: body.toLowerCase() }],
  };
});
await writeFile(
  new URL('../src/assets/recipes/search.json', import.meta.url),
  await format(JSON.stringify(rows), { parser: 'json', printWidth: 100 }),
);
