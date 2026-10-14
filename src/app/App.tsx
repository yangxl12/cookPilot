import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LoaderCircle, Timer as TimerIcon, X } from 'lucide-react';
import { Context, type AppContext, type Data, type Route, type Work } from './context';
import { db, setSetting } from '../storage/db';
import { cancelTask, createTask, initialize, pageOwner, pruneHistory } from '../storage/repository';
import { defaultPreferences, type Task } from '../domain/schema';
import { formatTime, timerRemaining } from '../domain/rules';
import { Home } from '../features/home/Home';
import { HistorySheet, MenuSheet } from '../features/home/Navigation';
import { SearchPage } from '../features/search/SearchPage';
import { RecipePages } from '../features/recipes/RecipePages';
import { Cooking } from '../features/cooking/Cooking';
import { Timers } from '../features/cooking/Timers';
import { ModelSwitch, PreferencesSheet, Settings } from '../features/settings/Settings';
import { migrateLegacy } from '../storage/migration';

function parseRoute(): Route {
  const [page, query] = location.hash.slice(1).split('?');
  if (page === 'recipes' || page === 'library/recipes') return { page: 'recipes' };
  if (page === 'ai-recipes' || page === 'library') return { page: 'ai-recipes' };
  if (page === 'settings') return { page: 'settings' };
  if (page === 'search') return { page: 'search' };
  if (['cook', 'overview', 'finish'].includes(page))
    return {
      page: 'cook',
      sessionId:
        new URLSearchParams(query).get('session') ??
        localStorage.getItem('cookpilot-current') ??
        undefined,
    };
  return { page: 'home' };
}
export function App() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  const [route, setRoute] = useState<Route>(parseRoute);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [sheet, setSheet] = useState<
    'menu' | 'history' | 'models' | 'preferences' | 'timers' | null
  >(null);
  const [, tick] = useState(0);
  const active = useRef<{ controller: AbortController; taskId?: string } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const data = useLiveQuery(async (): Promise<Data> => {
    const [recipes, versions, sessions, timers, conversations, cookingMessages, models, settings] =
      await db.transaction(
        'r',
        [
          db.recipes,
          db.versions,
          db.sessions,
          db.timers,
          db.conversations,
          db.cookingMessages,
          db.models,
          db.settings,
        ],
        () =>
          Promise.all([
            db.recipes.toArray(),
            db.versions.toArray(),
            db.sessions.toArray(),
            db.timers.toArray(),
            db.conversations.toArray(),
            db.cookingMessages.toArray(),
            db.models.toArray(),
            db.settings.toArray(),
          ]),
      );
    const values = new Map(settings.map((s) => [s.id, s.value]));
    return {
      recipes,
      versions,
      sessions,
      timers,
      conversations,
      cookingMessages,
      models,
      preferences: (values.get('preferences') as Data['preferences']) ?? defaultPreferences(),
      activeModelId: (values.get('activeModelId') as string) ?? '',
      activeConversationId: (values.get('activeConversationId') as string | null) ?? null,
    };
  }, []);
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 6500);
  }, []);
  const safe: AppContext['safe'] = useCallback(
    async (operation, success) => {
      try {
        const result = await operation();
        if (success) notify(success);
        return result;
      } catch (error) {
        notify(error instanceof Error ? error.message.slice(0, 700) : '操作失败，请重试');
        return undefined;
      }
    },
    [notify],
  );
  const cancel = useCallback(async () => {
    const request = active.current;
    active.current = null;
    setBusy(null);
    if (request) {
      request.controller.abort();
      if (request.taskId) await cancelTask(request.taskId);
    }
  }, []);
  const navigate = useCallback(
    async (next: Route) => {
      await cancel();
      setSheet(null);
      if (next.sessionId) {
        try {
          localStorage.setItem('cookpilot-current', next.sessionId);
        } catch {
          /* The route URL still persists the session identity. */
        }
      }
      const hash = `#${next.page}${next.sessionId ? `?session=${encodeURIComponent(next.sessionId)}` : ''}`;
      if (location.hash !== hash)
        history.pushState({ cookpilot: true, depth: (history.state?.depth ?? 0) + 1 }, '', hash);
      setRoute(next);
      window.scrollTo(0, 0);
    },
    [cancel],
  );
  const back = useCallback(() => {
    if (history.state?.depth > 0) history.back();
    else void navigate({ page: 'home' });
  }, [navigate]);
  const work: AppContext['work'] = async (label, kind, contextId, operation, candidate) => {
    if (active.current) return;
    const request: { controller: AbortController; taskId?: string } = {
      controller: new AbortController(),
    };
    active.current = request;
    setBusy(label);
    try {
      const selected = data?.models.find((m) => m.id === data.activeModelId) ?? data?.models[0];
      if (!selected) {
        setSheet(null);
        throw new Error('请先在我的厨房添加模型配置');
      }
      const credential = await db.credentials.get(selected.id);
      if (active.current !== request) return;
      const model = { ...selected, key: credential?.key ?? '' };
      const task: Task = await createTask(kind, contextId, selected, candidate);
      request.taskId = task.id;
      if (active.current !== request) {
        await cancelTask(task.id);
        return;
      }
      const context: Work = {
        task,
        model,
        signal: request.controller.signal,
        valid: () => active.current === request && !request.controller.signal.aborted,
      };
      await operation(context);
    } catch (error) {
      if (request.taskId)
        await db.tasks
          .where('id')
          .equals(request.taskId)
          .modify((task) => {
            if (task.status === 'pending')
              task.status = request.controller.signal.aborted ? 'cancelled' : 'failed';
          })
          .catch(() => undefined);
      if (!request.controller.signal.aborted)
        notify(error instanceof Error ? error.message.slice(0, 700) : '请求失败，请重试');
    } finally {
      if (active.current === request) {
        active.current = null;
        setBusy(null);
      }
    }
  };
  useEffect(() => {
    let alive = true;
    void initialize()
      .then(migrateLegacy)
      .then(() => {
        if (alive) {
          setRoute(parseRoute());
          setReady(true);
        }
      })
      .catch((error) => {
        if (alive)
          setFatal(
            `无法打开本机数据库：${error.message}。请检查浏览器是否允许存储；原数据没有被清空。`,
          );
      });
    const onRoute = () => {
      void cancel().catch(() => undefined);
      setSheet(null);
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    if (!history.state?.cookpilot)
      history.replaceState({ cookpilot: true, depth: 0 }, '', location.hash || '#home');
    const interval = setInterval(() => {
      void pruneHistory().catch((error) => notify(`历史清理失败：${error.message}`));
    }, 60000);
    const heartbeat = setInterval(() => {
      void setSetting(`lease:${pageOwner}`, Date.now()).catch(() => undefined);
    }, 15000);
    const second = setInterval(() => tick((t) => t + 1), 1000);
    const onHide = () => {
      active.current?.controller.abort();
      if (active.current?.taskId) void cancelTask(active.current.taskId).catch(() => undefined);
      void setSetting(`lease:${pageOwner}`, 0).catch(() => undefined);
    };
    window.addEventListener('pagehide', onHide);
    const onVisible = () => {
      tick((t) => t + 1);
      void pruneHistory().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(interval);
      clearInterval(heartbeat);
      clearInterval(second);
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cancel, notify]);
  useEffect(() => {
    if (!data || !ready) return;
    for (const timer of data.timers)
      if (timer.status === 'running' && timerRemaining(timer) === 0) {
        void db
          .transaction('rw', db.timers, async () => {
            const fresh = await db.timers.get(timer.id);
            if (fresh?.status !== 'running') return;
            await db.timers.update(timer.id, {
              status: 'done',
              remaining: 0,
              deadline: null,
              notified: true,
            });
            notify(`${timer.name} 时间到，请观察食材状态`);
          })
          .catch(() => notify('计时状态保存失败，请重试'));
      }
  });
  useEffect(() => {
    if (!ready || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
    // Waiting workers are deliberately not activated while the user is cooking.
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined);
  }, [ready]);
  if (fatal)
    return (
      <div className="app">
        <div className="empty-state">
          <p role="alert">{fatal}</p>
          <button className="primary" onClick={() => location.reload()}>
            重试
          </button>
        </div>
      </div>
    );
  if (!ready || !data)
    return (
      <div className="app">
        <div className="boot" role="status">
          <LoaderCircle className="spin" size={24} />
          正在打开厨房…
        </div>
      </div>
    );
  const running = data.timers.find((t) => t.status === 'running' && timerRemaining(t) > 0);
  const context: AppContext = {
    data,
    route,
    busy,
    safe,
    work,
    cancel,
    navigate,
    back,
    notify,
    showTimers: () => setSheet('timers'),
    showModels: () => setSheet('models'),
    showPreferences: () => setSheet('preferences'),
    showHistory: () => setSheet('history'),
    showMenu: () => setSheet('menu'),
  };
  return (
    <Context.Provider value={context}>
      <div className="app">
        <div id="app-content">
          {route.page === 'home' && <Home />}
          {route.page === 'recipes' && <RecipePages />}
          {route.page === 'ai-recipes' && <RecipePages ai />}
          {route.page === 'settings' && <Settings />}
          {route.page === 'search' && <SearchPage />}
          {route.page === 'cook' && <Cooking key={route.sessionId} />}{' '}
          {data.timers.length > 0 && route.page !== 'cook' && (
            <button
              className="timer-floating"
              aria-label="打开所有计时器"
              onClick={() => setSheet('timers')}
            >
              <TimerIcon size={16} />
              {running ? formatTime(timerRemaining(running)) : '计时器'}
              <span>{data.timers.length}</span>
            </button>
          )}
        </div>
        {sheet === 'menu' && <MenuSheet onClose={() => setSheet(null)} />}{' '}
        {sheet === 'history' && <HistorySheet onClose={() => setSheet(null)} />}{' '}
        {sheet === 'models' && <ModelSwitch onClose={() => setSheet(null)} />}{' '}
        {sheet === 'preferences' && <PreferencesSheet onClose={() => setSheet(null)} />}{' '}
        {sheet === 'timers' && <Timers onClose={() => setSheet(null)} />}{' '}
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
