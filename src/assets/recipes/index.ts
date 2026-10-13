import raw from './catalog.json';
import type { BuiltinRecipe } from '../../domain/schema';
export const catalog = raw as BuiltinRecipe[];
