import { createContext, useContext } from 'react';
import type { Recipe, Timer, ModelConfig, Preferences, Task, Candidate } from '../domain/schema';
import type { ModelSnapshot } from '../services/ai/client';

export type Route = {
  page: 'home' | 'recipes' | 'ai-recipes' | 'settings' | 'cook' | 'search';
  sessionId?: string;
};
export type Data = {
  recipes: Recipe[];
  timers: Timer[];
  models: ModelConfig[];
  preferences: Preferences;
  activeModelId: string;
  activeConversationId: string | null;
};
export type Work = { task: Task; model: ModelSnapshot; signal: AbortSignal; valid: () => boolean };
export type AppContext = {
  data: Data;
  route: Route;
  busy: string | null;
  composerHost: HTMLElement | null;
  menuOpen: boolean;
  navigate: (route: Route) => Promise<void>;
  back: () => void;
  notify: (text: string, tone?: 'info' | 'success' | 'error') => void;
  safe: <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
  work: (
    label: string,
    kind: Task['kind'],
    contextId: string,
    operation: (work: Work) => Promise<void>,
    candidate?: Candidate,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  showTimers: () => void;
  showModels: () => void;
  showPreferences: () => void;
  showHistory: () => void;
  showMenu: () => void;
};
export const Context = createContext<AppContext | null>(null);
export function useApp(): AppContext {
  const context = useContext(Context);
  if (!context) throw new Error('App context missing');
  return context;
}
