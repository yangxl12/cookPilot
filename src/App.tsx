import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChefHat,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  Flame,
  Layers,
  LoaderCircle,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer as TimerIcon,
  Trash2,
  Utensils,
  X,
  Zap,
} from 'lucide-react';
import type { Guide, GuideSource, Model, Preferences, Recipe, State, Step, Timer, View } from './data';
import { discover, findSavedRecipe, parseAvoidances, recipeConflict } from './discovery';
import type { DiscoveryTurn, Recommendation } from './discovery';
import { historyGroup, retainConversations } from './conversations';
import { searchAll } from './search';
import {
  defaultConditions,
  defaultPreferences,
  formatTime,
  initialState,
  loadState,
  makeGuide,
  quantity,
  recipes,
  STORAGE_KEY,
  timerRemaining,
  uid,
} from './data';

type Message = { id: string; role: 'assistant' | 'user'; text: string };
function routeView(hash: string, hasGuide: boolean): View {
  if (['#recipes', '#library/recipes'].includes(hash)) return 'recipes';
  if (['#ai-recipes', '#library'].includes(hash)) return 'ai-recipes';
  if (hash === '#settings') return 'settings';
  if (hasGuide && ['#cook', '#overview', '#finish'].includes(hash)) return 'cook';
  return 'home';
}
type Adjustment = {
  kind: 'water' | 'chili' | 'salt' | 'vinegar';
  title: string;
  explanation: string;
  affected: string[];
};

function StepCarousel({
  guide,
  onSelect,
  preparation,
  children,
}: {
  guide: Guide;
  onSelect: (index: number) => void;
  preparation: ReactNode;
  children: (step: Step, index: number) => ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const selected = useRef(guide.currentCard);
  selected.current = guide.currentCard;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const align = () => {
      const card = element.firstElementChild as HTMLElement | null;
      if (card)
        element.scrollTo({ left: selected.current * (card.offsetWidth + 12), behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = track.current;
    const card = element?.firstElementChild as HTMLElement | null;
    if (element && card) {
      const left = guide.currentCard * (card.offsetWidth + 12);
      if (Math.abs(element.scrollLeft - left) > 2) element.scrollTo({ left, behavior: 'instant' });
    }
  }, [guide.currentCard]);
  return (
    <div
      ref={track}
      className="step-carousel"
      role="region"
      aria-roledescription="轮播"
      aria-label="烹饪步骤卡片"
      tabIndex={0}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        onSelect(
          Math.max(
            0,
            Math.min(
              guide.recipe.steps.length,
              guide.currentCard + (event.key === 'ArrowRight' ? 1 : -1),
            ),
          ),
        );
      }}
      onScroll={(event) => {
        const element = event.currentTarget;
        const card = element.firstElementChild as HTMLElement | null;
        if (!card) return;
        const stride = card.offsetWidth + 12;
        const index = Math.round(element.scrollLeft / stride);
        if (
          Math.abs(element.scrollLeft - index * stride) < 2 &&
          index !== selected.current &&
          index >= 0 &&
          index <= guide.recipe.steps.length
        )
          onSelect(index);
      }}
    >
      <article
        className={`step-card preparation-card ${guide.currentCard === 0 ? 'active current-step' : ''}`}
        aria-roledescription="幻灯片"
        aria-label="准备：要点、食材和调味辅料、备菜"
        aria-hidden={guide.currentCard !== 0}
        inert={guide.currentCard !== 0}
      >
        <div className="step-card-scroll" tabIndex={guide.currentCard === 0 ? 0 : -1}>
          {preparation}
        </div>
      </article>
      {guide.recipe.steps.map((step, index) => (
        <article
          key={step.id}
          className={`step-card ${index + 1 === guide.currentCard ? 'active current-step' : ''}`}
          aria-roledescription="幻灯片"
          aria-label={`第 ${index + 1} 步：${step.title}`}
          aria-hidden={index + 1 !== guide.currentCard}
          inert={index + 1 !== guide.currentCard}
        >
          <div className="step-card-scroll" tabIndex={index + 1 === guide.currentCard ? 0 : -1}>
            {children(step, index)}
          </div>
        </article>
      ))}
    </div>
  );
}

function Sheet({
  title,
  subtitle,
  onClose,
  children,
  className = '',
  returnFocus,
  headerActions,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  returnFocus?: HTMLElement | null;
  headerActions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement as HTMLElement | null;
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel)?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab' && panel) {
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, textarea, select, a[href]',
          ),
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === panel)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === panel)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handle);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className={`sheet-overlay ${className === 'navigation-drawer' ? 'navigation-overlay' : ''}`} onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="sheet-header-actions">
            {headerActions}
            <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="sheet-content">{children}</div>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<State>(loadState);
  const [view, setView] = useState<View>(() => {
    const saved = loadState();
    return routeView(window.location.hash, saved.guides.some((g) => g.id === saved.activeId));
  });
  const [preferencesDraft, setPreferencesDraft] = useState<Preferences>(state.preferences);
  const [prompt, setPrompt] = useState('');
  const discoveryTurns = state.conversations.find((c) => c.id === state.activeConversationId)?.turns ?? [];
  const setDiscoveryTurns = (updater: (turns: DiscoveryTurn[]) => DiscoveryTurn[]) =>
    setState((prev) => {
      const active = prev.conversations.find((c) => c.id === prev.activeConversationId);
      if (!active) return prev;
      const turns = updater(active.turns);
      if (turns === active.turns) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map((c) => c.id === active.id ? { ...c, turns } : c),
      };
    });
  const [homeBusy, setHomeBusy] = useState<'analyzing' | 'generating' | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const discoveryRequest = useRef(0);
  const discoveryBusy = useRef(false);
  const discoveryLatest = useRef<HTMLDivElement>(null);
  const [requestedSheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [noteDraft, setNoteDraft] = useState('');
  const notesButton = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [recipeFilter, setRecipeFilter] = useState('全部');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState(false);
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [modelDraft, setModelDraft] = useState<Model | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [modelError, setModelError] = useState('');
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testedModels, setTestedModels] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => void;
    label: string;
  } | null>(null);
  const [customTimer, setCustomTimer] = useState({ name: '', minutes: 5 });
  const [saveError, setSaveError] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chatEnd = useRef<HTMLDivElement>(null);
  const activeGuideRef = useRef(state.activeId);
  activeGuideRef.current = state.activeId;
  const guide = state.guides.find((g) => g.id === state.activeId);
  const isPreparation = guide?.currentCard === 0;
  const currentStep = guide?.recipe.steps[isPreparation ? 0 : guide.currentStep];
  const activeModel = state.models.find((m) => m.id === state.modelId);
  const runningTimers = state.timers.filter((t) => t.endAt !== null && timerRemaining(t, now) > 0);
  const isRoot = view !== 'cook';
  const sheet = confirm ? null : requestedSheet;
  const historyMinute = Math.floor(now / 60000);
  const conversations = retainConversations(state.conversations, now)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const searchResults = searchAll(globalSearch, state.guides, recipes, conversations);

  const later = (callback: () => void, ms: number) => {
    const id = setTimeout(callback, ms);
    timeouts.current.push(id);
  };
  const notify = (text: string) => setToast(text);
  const cancelDiscovery = () => {
    discoveryRequest.current += 1;
    discoveryBusy.current = false;
    setHomeBusy(null);
    setGeneratingId(null);
    setDiscoveryTurns((prev) => prev.some((turn) => !turn.result) ? prev.map((turn) => turn.result ? turn : {
      ...turn, result: { kind: 'chat', text: '分析已停止，可以重新发送这条消息。' },
    }) : prev);
  };
  const navigate = (next: View) => {
    cancelDiscovery();
    if (window.location.hash !== `#${next}`) {
      history.pushState({ cookpilot: true, depth: (history.state?.depth ?? 0) + 1 }, '', `#${next}`);
    }
    setView(next);
    setSheet(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const goBack = () => {
    cancelDiscovery();
    setSheet(null);
    if (history.state?.cookpilot && history.state.depth > 0) history.back();
    else navigate('home');
  };
  const backButton = (
    <button className="icon-button" aria-label="返回" onClick={goBack}>
      <ArrowLeft size={21} />
    </button>
  );
  const newConversation = () => {
    navigate('home');
    setState((prev) => ({ ...prev, activeConversationId: null }));
    setPrompt('');
  };
  const openConversation = (id: string) => {
    navigate('home');
    setState((prev) => ({ ...prev, activeConversationId: id }));
    setPrompt('');
  };
  const menuButton = (
    <button ref={menuButtonRef} className="icon-button menu-button" aria-label="菜单" title="菜单" aria-haspopup="dialog"
      aria-expanded={sheet === 'navigation'} onClick={() => setSheet('navigation')}>
      <Menu size={21} />
    </button>
  );
  const updateGuide = (updater: (g: Guide) => Guide) =>
    setState((prev) => ({
      ...prev,
      guides: prev.guides.map((g) => (g.id === prev.activeId ? updater(g) : g)),
    }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state]);
  useEffect(() => {
    setState((prev) => {
      const retained = retainConversations(prev.conversations);
      if (retained.length === prev.conversations.length) return prev;
      return {
        ...prev,
        conversations: retained,
        activeConversationId: retained.some((c) => c.id === prev.activeConversationId)
          ? prev.activeConversationId : null,
      };
    });
  }, [historyMinute]);
  useEffect(() => {
    // Seed a home entry so deep links also return to home; browser history survives refreshes.
    if (!history.state?.cookpilot) {
      history.replaceState({ cookpilot: true, depth: 0 }, '', '#home');
      if (view !== 'home') history.pushState({ cookpilot: true, depth: 1 }, '', `#${view}`);
    } else {
      history.replaceState(history.state, '', `#${view}`);
    }
    const onHashChange = () => {
      const saved = loadState();
      const next = routeView(window.location.hash, saved.guides.some((g) => g.id === saved.activeId));
      cancelDiscovery();
      setView(next);
      history.replaceState(history.state?.cookpilot ? history.state : { cookpilot: true, depth: 1 }, '', `#${next}`);
      setSheet(null);
      setConfirm(null);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages, answering]);
  useEffect(() => {
    if (view === 'home' && discoveryTurns.length)
      discoveryLatest.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [discoveryTurns, view]);
  useEffect(() => {
    const expired = state.timers.filter(
      (t) => t.endAt !== null && timerRemaining(t, now) === 0 && !t.notified,
    );
    if (expired.length) {
      setToast(`${expired.map((t) => t.name).join('、')}时间到，请观察状态后再继续`);
      setState((prev) => ({
        ...prev,
        timers: prev.timers.map((t) =>
          expired.some((e) => e.id === t.id) ? { ...t, notified: true } : t,
        ),
      }));
    }
  }, [now, state.timers]);

  function chooseRecipe(recipe: Recipe, text = '', source: GuideSource = 'catalog') {
    const next = defaultConditions(recipe);
    next.taste = state.preferences.taste || next.taste;
    next.allergies = parseAvoidances(state.preferences.avoidances);
    next.cookwares = [...state.preferences.cookware];
    if (next.cookwares.length) next.cookware = next.cookwares.join('、');
    const amount = text.match(/(\d+)\s*(?:克|g)/i);
    if (amount) next.amount = Number(amount[1]);
    if (!Number.isFinite(next.amount) || next.amount < 50 || next.amount > 3000) {
      notify('主料用量请填写 50–3000 g');
      return;
    }
    if (/不辣|不吃辣|不要辣/.test(text)) next.taste = '不辣';
    if (/清淡|少盐|不.*咸/.test(text)) next.taste += ' 少盐';
    for (const name of ['花生', '鸡蛋', '牛肉', '鸡肉', '蘑菇', '小葱', '番茄', '土豆']) {
      if (new RegExp(`${name}.{0,3}过敏|(?:不吃|不要|不放)${name}`).test(text)) next.allergies.push(name);
    }
    const conflict = recipeConflict(recipe, state.preferences, text);
    if (conflict) {
      notify(conflict);
      return;
    }
    setMessages([]);
    setAdjustment(null);
    setQuestion('');
    const generated = makeGuide(recipe, next);
    generated.source = source;
    setState((prev) => ({ ...prev, guides: [generated, ...prev.guides], activeId: generated.id }));
    navigate('cook');
    if (source === 'ai') notify('已加入 AI 菜谱');
  }
  function submitPrompt() {
    if (discoveryBusy.current) return;
    if (!prompt.trim()) {
      notify('说说想吃什么，或输入一个问题');
      return;
    }
    const text = prompt.trim();
    const id = uid();
    const request = ++discoveryRequest.current;
    discoveryBusy.current = true;
    setState((prev) => {
      const date = new Date().toISOString();
      const active = prev.conversations.find((c) => c.id === prev.activeConversationId);
      const conversationId = active?.id ?? uid();
      return {
        ...prev,
        activeConversationId: conversationId,
        conversations: active ? prev.conversations.map((c) => c.id === active.id
          ? { ...c, updatedAt: date, turns: [...c.turns, { id, prompt: text }] } : c)
          : [{ id: conversationId, title: text.slice(0, 28), createdAt: date,
            updatedAt: date, turns: [{ id, prompt: text }] }, ...prev.conversations],
      };
    });
    setPrompt('');
    setHomeBusy('analyzing');
    later(() => {
      if (request !== discoveryRequest.current) return;
      const result = discover(text, state.guides, state.preferences);
      setDiscoveryTurns((prev) => prev.map((turn) => turn.id === id ? { ...turn, result } : turn));
      discoveryBusy.current = false;
      setHomeBusy(null);
    }, 650);
  }
  function selectRecommendation(candidate: Recommendation, text: string) {
    if (discoveryBusy.current) return;
    // Recheck at selection time: a recipe may have been saved since the recommendation appeared.
    const saved = findSavedRecipe(candidate.recipe, state.guides);
    const conflict = recipeConflict(saved?.recipe || candidate.recipe, state.preferences, text, !!saved);
    if (conflict) {
      notify(conflict);
      return;
    }
    if (saved) {
      openGuide(saved);
      return;
    }
    const request = ++discoveryRequest.current;
    discoveryBusy.current = true;
    setGeneratingId(candidate.recipe.id);
    setHomeBusy('generating');
    later(() => {
      if (request !== discoveryRequest.current) return;
      discoveryBusy.current = false;
      setHomeBusy(null);
      setGeneratingId(null);
      chooseRecipe(candidate.recipe, text, 'ai');
    }, 850);
  }
  function openGuide(g: Guide) {
    setState((prev) => ({
      ...prev,
      activeId: g.id,
      guides: prev.guides.map((item) => item.id === g.id ? { ...item, currentCard: 0 } : item),
    }));
    setMessages([]);
    setAnswering(false);
    setAdjustment(null);
    navigate('cook');
  }
  function repeatGuide(g: Guide) {
    const next = {
      ...structuredClone(g),
      id: uid(),
      checked: [],
      completed: [],
      currentStep: 0,
      currentCard: 0,
      status: 'ready' as const,
      note: '',
      createdAt: new Date().toISOString(),
    };
    setState((prev) => ({ ...prev, guides: [next, ...prev.guides], activeId: next.id }));
    setMessages([]);
    setAdjustment(null);
    setAnswering(false);
    navigate('cook');
    notify(`已沿用 v${g.version} 指南`);
  }
  function addTimer(name: string, seconds: number, stepId: string) {
    if (!guide) return;
    const duplicate = state.timers.find(
      (t) =>
        t.guideId === guide.id &&
        t.stepId === stepId &&
        t.name === name &&
        timerRemaining(t, now) > 0,
    );
    if (duplicate) {
      setSheet('timers');
      return;
    }
    const timer: Timer = {
      id: uid(),
      guideId: guide.id,
      stepId,
      name,
      total: seconds,
      remaining: seconds,
      endAt: Date.now() + seconds * 1000,
      notified: false,
    };
    setState((prev) => ({ ...prev, timers: [...prev.timers, timer] }));
    notify(`${name}计时已开始`);
  }
  function toggleTimer(t: Timer) {
    const remaining = timerRemaining(t);
    setState((prev) => ({
      ...prev,
      timers: prev.timers.map((timer) =>
        timer.id === t.id
          ? { ...timer, remaining, endAt: t.endAt === null ? Date.now() + remaining * 1000 : null }
          : timer,
      ),
    }));
  }
  function openChat() {
    if (!guide || !currentStep) return;
    setSheet('chat');
  }
  function requestAdjustment(kind: Adjustment['kind']) {
    if (!guide) return;
    const remaining = guide.recipe.steps
      .filter((_, index) => index >= (isPreparation ? 0 : guide.currentStep))
      .filter((s) => !guide.completed.includes(s.id));
    const affected = remaining
      .filter((s) =>
        kind === 'water'
          ? s.id === currentStep?.id || s.uses.includes('water')
          : kind === 'chili'
            ? s.uses.some((id) => ['chili', 'pepper'].includes(id))
            : kind === 'vinegar'
              ? s.uses.includes('vinegar')
              : s.uses.some((id) => ['salt', 'soy', 'darksoy'].includes(id)),
      )
      .map((s) => s.id);
    if (!affected.length) {
      setAdjustment(null);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          text: '相关调料已使用，无法从成品中减去。先不要再添加；如果偏咸，可以搭配无盐米饭。',
        },
      ]);
      return;
    }
    setAdjustment({
      kind,
      title:
        kind === 'water'
          ? '先蒸发多余水分，再继续'
          : kind === 'chili'
            ? '后续步骤不再放辣椒'
            : kind === 'vinegar'
              ? '不放米醋，改为咸鲜口'
              : '后续咸味调料减少 30%',
      explanation:
        kind === 'water'
          ? '当前步骤增加开盖收水提示，后续清水减少 50%。先观察锅内状态，再决定是否继续。'
          : kind === 'chili'
            ? '移除尚未下锅的干辣椒与花椒。'
            : kind === 'vinegar'
              ? '移除后续米醋，后续白糖减少 50%，避免只有甜味。风味会更偏咸鲜。'
              : '后续尚未使用的盐、生抽和老抽减少 30%。',
      affected,
    });
  }
  function ask(text: string) {
    if (!text.trim() || answering || !guide || !currentStep) return;
    const q = text.trim();
    setQuestion('');
    setAnswering(true);
    setAdjustment(null);
    setMessages((prev) => [...prev, { id: uid(), role: 'user', text: q }]);
    later(() => {
      if (activeGuideRef.current !== guide.id) return;
      const timerText = state.timers
        .filter((t) => t.guideId === guide.id)
        .map((t) => `${t.name}剩余 ${formatTime(timerRemaining(t))}`)
        .join('，');
      let answer = `现在先关注「${currentStep.title}」：${currentStep.action}\n\n观察这个信号再继续：${currentStep.signal}${timerText ? `\n\n当前计时：${timerText}。计时结束也需要你确认食材状态。` : ''}`;
      if (/水|出水/.test(q))
        answer =
          '先不要急着加调料。如果锅里出现很多水，保持开盖，让多余水分蒸发；轻轻翻动避免粘锅，再看是否达到本步的结束信号。可以把收水提醒加入剩余流程。';
      if (/辣|辣椒/.test(q))
        answer =
          '可以调整辣度。尚未下锅的辣椒和花椒可以省略；已经加入锅中的辣味无法直接移除，不建议加糖掩盖。下面先确认会影响的后续步骤。';
      if (/醋/.test(q))
        answer =
          '没有米醋时，可以做成咸鲜口，同时减少后续糖量，避免味道过甜。';
      if (/咸|少盐|清淡/.test(q))
        answer =
          '先暂停添加咸味调料。我们可以把后续尚未使用的盐、生抽和老抽减少 30%，已经加入的部分保持原记录。';
      if (/熟|判断|怎么看/.test(q))
        answer = `这一步看状态更可靠：${currentStep.signal}\n\n${currentStep.tip} 不必只等倒计时结束；如果还没达到状态，就继续观察。`;
      if (/为什么|原理/.test(q))
        answer = `${currentStep.why}\n\n实际操作时，记住：${currentStep.tip}`;
      if (isPreparation && !/辣|醋|咸|少盐|清淡/.test(q))
        answer = `现在先完成备菜：${guide.recipe.prep.map((prep) => `${prep.title}：${prep.detail}`).join('\n\n')}\n\n要点：${guide.recipe.key}${timerText ? `\n\n当前计时：${timerText}` : ''}`;
      const waterBeforeFood = /水|出水/.test(q) && (isPreparation || currentStep.id === 'heat');
      const braisingWater =
        !isPreparation && /水|出水/.test(q) && guide.recipe.id === 'beef' && currentStep.id === 'braise';
      if (waterBeforeFood && !isPreparation)
        answer =
          '现在还在热锅阶段，不要往热油中加水。如果锅底有水，先关火，等待冷却后倒掉水并擦干，再按本步重新热锅。这种情况无需修改后续碗汁用量。';
      if (braisingWater)
        answer = `炖牛肉时有汤汁是正常的，保持热水刚没过牛肉、锅里轻微冒泡即可。不要现在急着收汁；等牛肉软烂、土豆也熟后再按最后一步收汁。\n\n现在看这个状态：${currentStep.signal}`;
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', text: answer }]);
      setAnswering(false);
      if (/水|出水/.test(q) && !waterBeforeFood && !braisingWater) requestAdjustment('water');
      else if (/辣|辣椒/.test(q)) requestAdjustment('chili');
      else if (/醋/.test(q)) requestAdjustment('vinegar');
      else if (/咸|少盐|清淡/.test(q)) requestAdjustment('salt');
    }, 850);
  }
  function applyAdjustment() {
    if (!adjustment || !guide) return;
    const { kind, affected, title } = adjustment;
    updateGuide((g) => {
      const changed = structuredClone(g);
      // Keep the confirmed ingredient/preparation baseline. Only future step overrides change.
      changed.recipe.steps = changed.recipe.steps.map((s) => {
        if (!affected.includes(s.id) || g.completed.includes(s.id)) return s;
        const suffix =
          kind === 'water'
            ? '调整：先开盖蒸发多余水分；本步如需加水，先用原量的 1/2，观察后再决定是否补水。'
            : kind === 'chili'
              ? '调整：本步不加干辣椒与花椒。'
              : kind === 'vinegar'
                ? '调整：本步不加米醋，白糖使用原量的 1/2。'
                : '调整：本步尚未加入的盐、生抽、老抽使用原量的 70%；已经加入的部分不要再补。';
        return {
          ...s,
          action: `${s.action}\n${suffix}`,
          uses: s.uses.filter(
            (id) =>
              !(kind === 'chili' && ['chili', 'pepper'].includes(id)) &&
              !(kind === 'vinegar' && id === 'vinegar'),
          ),
        };
      });
      changed.changes.push(`${title}（第 ${isPreparation ? 1 : g.currentStep + 1} 步起）`);
      changed.version += 1;
      return changed;
    });
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: 'assistant',
        text: `已更新：${title}。`,
      },
    ]);
    setAdjustment(null);
  }
  function saveModel() {
    if (!modelDraft) return;
    if (!modelDraft.name.trim() || !modelDraft.model.trim()) {
      setModelError('请填写配置名称和模型名称');
      return;
    }
    try {
      const url = new URL(modelDraft.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    } catch {
      setModelError('请输入有效的 http 或 https 接口地址');
      return;
    }
    setState((prev) => ({
      ...prev,
      modelId: prev.models.length ? prev.modelId : modelDraft.id,
      models: prev.models.some((m) => m.id === modelDraft.id)
        ? prev.models.map((m) => (m.id === modelDraft.id ? { ...modelDraft } : m))
        : [...prev.models, { ...modelDraft }],
    }));
    setSheet(null);
    setModelDraft(null);
    notify('模型配置已保存');
  }
  function editModel(model?: Model) {
    setModelDraft(
      model
        ? { ...model }
        : { id: uid(), name: '', url: 'https://api.example.com/v1', key: '', model: '' },
    );
    setModelError('');
    setShowKey(false);
    setSheet('model-edit');
  }
  function testModel(model: Model) {
    setTestingModel(model.id);
    later(() => {
      setTestingModel(null);
      setTestedModels((prev) => [...prev, model.id]);
      notify('模拟连接成功');
    }, 1100);
  }
  function exportData() {
    const safe = {
      app: 'CookPilot',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      ...state,
      models: state.models.map(({ key: _key, ...m }) => m),
    };
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'cookpilot-demo-backup.json';
    a.click();
    later(() => URL.revokeObjectURL(url), 1500);
    notify('数据已导出');
  }
  function deleteGuide(g: Guide) {
    setConfirm({
      title: `删除「${g.recipe.title}」？`,
      description: '将删除这份指南、心得和关联计时器，此操作无法撤销。',
      label: '删除指南',
      action: () => {
        setState((prev) => ({
          ...prev,
          guides: prev.guides.filter((item) => item.id !== g.id),
          timers: prev.timers.filter((t) => t.guideId !== g.id),
          activeId: prev.activeId === g.id ? null : prev.activeId,
        }));
        setSheet(null);
        navigate('ai-recipes');
        notify('指南已删除');
      },
    });
  }

  function ingredients(
    ids: string[],
    stepMode = false,
    prepId?: string,
    ingredientStep = currentStep,
  ) {
    if (!guide) return null;
    const currentStep = ingredientStep;
    return (
      <div className="ingredient-pills">
        {ids.map((id) => {
          const item = guide.recipe.ingredients.find((item) => item.id === id);
          if (!item) return null;
          let amount = quantity(item);
          if (prepId && guide.recipe.id === 'chicken') {
            if (id === 'soy' && ['marinate', 'sauce'].includes(prepId))
              amount = `${Number((item.quantity * (prepId === 'marinate' ? 1 / 3 : 2 / 3)).toFixed(1))} ml`;
            if (id === 'starch' && ['marinate', 'sauce'].includes(prepId))
              amount = `${Number((item.quantity / 2).toFixed(1))} g`;
            if (id === 'oil')
              amount = `${Number((item.quantity * (prepId === 'marinate' ? 0.2 : 0.8)).toFixed(1))} ml`;
          }
          if (prepId && guide.recipe.id === 'eggs' && id === 'salt')
            amount = `${Number((item.quantity * (prepId === 'eggs' ? 0.25 : 0.75)).toFixed(1))} g`;
          if (stepMode && currentStep) {
            if (guide.recipe.id === 'chicken') {
              if (currentStep.id === 'heat' && id === 'oil')
                amount = `${Number((item.quantity * 0.8).toFixed(1))} ml`;
              if (currentStep.id === 'sauce' && id === 'soy')
                amount = `${Number(((item.quantity * 2) / 3).toFixed(1))} ml`;
              if (currentStep.id === 'sauce' && id === 'starch')
                amount = `${Number((item.quantity / 2).toFixed(1))} g`;
            }
            if (guide.recipe.id === 'eggs') {
              if (id === 'oil')
                amount = `${Number((item.quantity * (currentStep.id === 'eggs' ? 0.6 : 0.4)).toFixed(1))} ml`;
              if (id === 'salt') amount = `${Number((item.quantity * 0.75).toFixed(1))} g`;
            }
            if (guide.recipe.id === 'beef' && id === 'ginger')
              amount = `${Number((item.quantity * (currentStep.id === 'blanch' ? 1 / 3 : 2 / 3)).toFixed(1))} g`;
            if (currentStep.action.includes('调整：')) {
              const q = Number(amount.split(' ')[0]),
                unit = amount.split(' ')[1];
              if (currentStep.action.includes('70%') && ['salt', 'soy', 'darksoy'].includes(id))
                amount = `${Number((q * 0.7).toFixed(1))} ${unit}`;
              if (
                currentStep.action.includes('1/2') &&
                ((id === 'water' && currentStep.action.includes('蒸发')) ||
                  (id === 'sugar' && currentStep.action.includes('米醋')))
              )
                amount = `${Number((q / 2).toFixed(1))} ${unit}`;
            }
            if (['chicken', 'eggs', 'beef'].includes(id) && guide.recipe.id === id)
              amount += ' · 已备好';
            if (id === 'tomato' && currentStep.id === 'combine') amount = '锅中的';
          }
          return (
            <span key={id}>
              <span>{item.name}</span>
              <b>{amount}</b>
            </span>
          );
        })}
      </div>
    );
  }

  function renderHome() {
    return (
      <>
        <header className="home-header">
          <div className="header-identity">
            {menuButton}
            <a
              className="brand"
              href="#home"
              onClick={(event) => {
                event.preventDefault();
                navigate('home');
              }}
            >
              <span className="brand-symbol">
                <ChefHat size={25} strokeWidth={1.7} />
              </span>
              CookPilot
            </a>
          </div>
          <div className="home-controls">
            <button className="icon-button new-conversation" aria-label="新建对话" title="新建对话" onClick={newConversation}>
              <MessageSquarePlus size={20} />
            </button>
            <button className="model-pill" onClick={() => setSheet('model-switch')}>
              <span>{activeModel?.name || '选择模型'}</span>
              <ChevronDown size={13} />
            </button>
            <button
              className="icon-button"
              aria-label="通用设置"
              disabled={homeBusy !== null}
              onClick={() => {
                setPreferencesDraft(structuredClone(state.preferences));
                setSheet('preferences');
              }}
            >
              <Settings2 size={19} />
            </button>
          </div>
        </header>
        <main className={`home page ${discoveryTurns.length ? 'home-conversation' : ''}`}>
          <div className="home-center">
            <section className="prompt-card">
              {!discoveryTurns.length && <h1>想做什么菜？</h1>}
              {discoveryTurns.length > 0 && (
                <div className="discovery-conversation" aria-label="做菜灵感对话" aria-busy={homeBusy === 'analyzing'}>
                  {discoveryTurns.map((turn, index) => (
                    <div className="discovery-turn" key={turn.id} ref={index === discoveryTurns.length - 1 ? discoveryLatest : undefined}>
                      <div className="message user"><p>{turn.prompt}</p></div>
                      <div className="discovery-answer">
                        <span className="discovery-author"><ChefHat size={18} /> CookPilot</span>
                        {!turn.result ? (
                          <p className="discovery-status" role="status"><LoaderCircle size={15} className="spin" />正在分析…</p>
                        ) : (
                          <>
                            {(turn.result.kind === 'chat' || !turn.result.candidates.length) && (
                              <p className="discovery-summary">{turn.result.text}</p>
                            )}
                            {turn.result.kind === 'recipes' && (
                              <div className="recommendations">
                                {turn.result.candidates.map((candidate) => {
                                  const saved = findSavedRecipe(candidate.recipe, state.guides);
                                  const busy = generatingId === candidate.recipe.id;
                                  return (
                                    <article className={`recommendation ${candidate.blocked ? 'unavailable' : ''}`} key={candidate.recipe.id}>
                                      <div className="recommendation-heading">
                                        <h2>{candidate.recipe.title}</h2>
                                        {saved && <span className="recipe-source saved">已有 · v{saved.version}</span>}
                                      </div>
                                      <div className="recommendation-meta"><span><Clock3 size={13} />{candidate.recipe.minutes} 分钟</span><span>{candidate.recipe.level}</span></div>
                                      {candidate.blocked && <p className="recommendation-warning">{candidate.blocked}</p>}
                                      <button className="recommendation-select" disabled={!!candidate.blocked || homeBusy !== null}
                                        aria-label={`${saved ? '使用已有菜谱' : '生成菜谱'}：${candidate.recipe.title}`}
                                        onClick={() => selectRecommendation(candidate, turn.prompt)}>
                                        {busy ? <><LoaderCircle size={15} className="spin" />正在生成…</> : <>{saved ? '使用已有菜谱' : '生成菜谱'}<ArrowRight size={15} /></>}
                                      </button>
                                    </article>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="home-composer">
                <div className="prompt-input">
                  <textarea
                    id="recipe-prompt"
                    aria-label="描述做菜需求"
                    maxLength={300}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={discoveryTurns.length ? '换个想法，或继续聊聊…' : '比如：有番茄和鸡蛋，想吃点简单的'}
                    disabled={homeBusy !== null}
                  />
                  <button className="prompt-submit" onClick={submitPrompt} aria-label="发送消息" disabled={homeBusy !== null || !prompt.trim()}>
                    {homeBusy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={21} />}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>
      </>
    );
  }
  function renderRecipes() {
    const visible = recipes.filter(
      (recipe) =>
        (recipeFilter === '全部' ||
          (recipeFilter === '中式' ? !recipe.cuisine : !!recipe.cuisine)) &&
        recipe.title.includes(recipeSearch.trim()),
    );
    return (
      <div className="catalog-content">
        <label className="catalog-search">
          <Search size={18} />
          <input
            aria-label="搜索菜谱"
            placeholder="搜索菜谱"
            value={recipeSearch}
            onChange={(event) => setRecipeSearch(event.target.value)}
          />
        </label>
        <div className="catalog-filters" aria-label="菜谱分类">
          {['全部', '中式', '西式与日式'].map((category) => (
            <button
              key={category}
              aria-pressed={recipeFilter === category}
              className={recipeFilter === category ? 'active' : ''}
              onClick={() => setRecipeFilter(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="catalog-list">
          {visible.map((recipe) => (
            <button
              className="catalog-recipe"
              key={recipe.id}
              aria-label={recipe.title}
              onClick={() => chooseRecipe(recipe)}
            >
              <span className="catalog-recipe-icon">
                <Utensils size={22} strokeWidth={1.5} />
              </span>
              <span>
                <b>{recipe.title}</b>
                <small>
                  {recipe.cuisine || '中式'}
                  <span>·</span>
                  {recipe.minutes} 分钟
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
          {!visible.length && <p className="catalog-empty">没有找到菜谱</p>}
        </div>
      </div>
    );
  }
  function processHeader(title: string, back: () => void, right?: ReactNode) {
    return (
      <header className="process-header">
        <button className="icon-button" aria-label="返回" onClick={back}>
          <ArrowLeft size={21} />
        </button>
        <span>{title}</span>
        {right || <span className="header-spacer" />}
      </header>
    );
  }

  function renderPreparation() {
    if (!guide) return null;
    const r = guide.recipe;
    return (
      <>
        <div className="step-number">开始之前</div>
        <h1>{r.title}</h1>
        <section className="preparation-key">
          <h2>要点</h2>
          <p>{r.key}</p>
        </section>
        <h2 className="preparation-ingredients-title">食材和调味辅料</h2>
        <section className="ingredients-section" aria-label="食材清单">
          {(['主料', '调味'] as const).map((group) => (
            <table className="recipe-ingredient-table" key={group}>
              <caption>{group === '主料' ? '主要食材' : '调味与辅料'}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">食材</th>
                  <th scope="col">用量</th>
                </tr>
              </thead>
              <tbody>
                {r.ingredients
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        {item.name}
                        {item.note && <small>{item.note}</small>}
                      </th>
                      <td>{quantity(item)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ))}
        </section>
        <section className="guide-section guide-prep">
          <h2>备菜</h2>
          <div className="guide-prep-list">
            {r.prep.map((prep, index) => (
              <article className="guide-prep-item" key={prep.id}>
                <button
                  className={`prep-check ${guide.checked.includes(prep.id) ? 'checked' : ''}`}
                  aria-label={`${guide.checked.includes(prep.id) ? '取消' : '完成'}：${prep.title}`}
                  aria-pressed={guide.checked.includes(prep.id)}
                  onClick={() =>
                    updateGuide((g) => ({
                      ...g,
                      checked: g.checked.includes(prep.id)
                        ? g.checked.filter((id) => id !== prep.id)
                        : [...g.checked, prep.id],
                    }))
                  }
                >
                  {guide.checked.includes(prep.id) ? <Check size={16} /> : index + 1}
                </button>
                <div>
                  <h3>{prep.title}</h3>
                  <p>{prep.detail}</p>
                  {prep.parallel && <p className="prep-parallel">{prep.parallel}</p>}
                  {prep.seconds && (
                    <button
                      className="timer-start-small"
                      onClick={() => addTimer(prep.title, prep.seconds!, prep.id)}
                    >
                      <TimerIcon size={15} />
                      开始 {prep.seconds / 60} 分钟计时
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        {guide.changes.length > 0 && (
          <details className="detail-disclosure">
            <summary>
              流程调整 · v{guide.version}
              <ChevronDown size={16} />
            </summary>
            {guide.changes.map((change, index) => (
              <p key={index}>{change}</p>
            ))}
          </details>
        )}
      </>
    );
  }

  function renderCook() {
    if (!guide || !currentStep) return null;
    const r = guide.recipe;
    const index = guide.currentCard;
    const selectStep = (selected: number) => updateGuide((g) => ({
      ...g,
      currentCard: selected,
      currentStep: selected > 0 ? selected - 1 : g.currentStep,
      status: selected > 0 && g.status === 'ready' ? 'cooking' : g.status,
    }));
    return (
      <div className="cards-page">
        {processHeader(
          r.title,
          goBack,
          <div className="cards-header-actions">
            <button ref={notesButton} aria-label="心得" onClick={() => {
              setNoteDraft(guide.note);
              setSheet('notes');
            }}>
              <BookOpen size={17} />
              心得
            </button>
            <button aria-label="问问 AI" onClick={openChat}>
              <MessageCircle size={17} />
              问问 AI
            </button>
            <button aria-label="查看厨房计时器" onClick={() => setSheet('timers')}>
              <TimerIcon size={17} />
              计时器{state.timers.length > 0 && <small>{state.timers.length}</small>}
            </button>
          </div>,
        )}
        <main className="cards-main">
          <StepCarousel guide={guide} onSelect={selectStep} preparation={renderPreparation()}>
            {(step, stepIndex) => {
              const stepTimers = state.timers.filter(
                (timer) => timer.guideId === guide.id && timer.stepId === step.id,
              );
              return (
                <>
                  <div className="step-number">
                    第 {stepIndex + 1} 步
                    <span>{guide.completed.includes(step.id) ? '已完成' : ''}</span>
                  </div>
                  <h1>{step.title}</h1>
                  <div className="step-meta">
                    {step.heat && (
                      <span className="heat">
                        <Flame size={16} />
                        {step.heat}
                      </span>
                    )}
                    {step.seconds && (
                      <button
                        className="step-timer"
                        aria-label={stepTimers.length ? '查看本步计时' : '开始计时'}
                        onClick={() =>
                          stepTimers.length
                            ? setSheet('timers')
                            : addTimer(step.title, step.seconds!, step.id)
                        }
                      >
                        <TimerIcon size={15} />
                        {step.seconds >= 60
                          ? `${Math.round(step.seconds / 60)} 分钟`
                          : `${step.seconds} 秒`}
                        <Play size={12} />
                      </button>
                    )}
                  </div>
                  <p className="step-action">{step.action}</p>
                  {step.uses.length > 0 && (
                    <section className="step-ingredients">
                      <h3>本步用量</h3>
                      {ingredients(step.uses, true, undefined, step)}
                    </section>
                  )}
                  <div className="signal-card">
                    <span className="signal-icon">
                      <Eye size={20} />
                    </span>
                    <div>
                      <b>完成标准</b>
                      <p>{step.signal}</p>
                    </div>
                  </div>
                  {stepTimers.map((timer) => renderTimer(timer, true))}
                  <div className="step-tip">
                    <Zap size={16} />
                    <p>{step.tip}</p>
                  </div>
                  <details className="detail-disclosure">
                    <summary>
                      为什么这样做？
                      <ChevronDown size={16} />
                    </summary>
                    <p>{step.why}</p>
                  </details>
                </>
              );
            }}
          </StepCarousel>
          <nav className="card-pagination" aria-label="跳转步骤">
            <button
              aria-label="跳转准备卡片"
              aria-current={index === 0 ? 'step' : undefined}
              className={index === 0 ? 'active preparation-tab' : 'preparation-tab'}
              onClick={() => selectStep(0)}
            >
              准备
            </button>
            {r.steps.map((step, stepIndex) => (
              <button
                key={step.id}
                aria-label={`跳转第 ${stepIndex + 1} 步`}
                aria-current={index === stepIndex + 1 ? 'step' : undefined}
                className={`${index === stepIndex + 1 ? 'active' : ''} ${guide.completed.includes(step.id) ? 'done' : ''}`}
                onClick={() => selectStep(stepIndex + 1)}
              >
                {stepIndex + 1}
              </button>
            ))}
            <button aria-label="查看全部步骤" onClick={() => setSheet('steps')}>
              <Layers size={17} />
            </button>
          </nav>
        </main>
      </div>
    );
  }
  function renderRecipePage() {
    const aiGuides = state.guides.filter((g) => g.source === 'ai');
    const filtered = aiGuides.filter((g) => g.recipe.title.includes(search.trim()));
    return (
      <>
        <header className="root-header">
          <div className="header-identity">
            {backButton}
            <h1 className="mini-brand">
              <BookOpen size={19} />
              {view === 'recipes' ? '菜谱大全' : 'AI 菜谱'}
            </h1>
          </div>
          <button
            className="icon-button"
            aria-label="指南数据管理"
            onClick={() => setSheet('data')}
          >
            <SlidersHorizontal size={20} />
          </button>
        </header>
        <main className="page library-page">
          <div>
            {view === 'recipes' ? (
              renderRecipes()
            ) : (
              <>
                <label className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="搜索 AI 菜谱"
                    placeholder="搜索菜名"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}>
                      <X size={16} />
                    </button>
                  )}
                </label>
                <div className="guide-list">
                  {filtered.map((g) => (
                    <article className="guide-card" key={g.id}>
                      <button className="guide-main" onClick={() => openGuide(g)}>
                        {g.recipe.image ? (
                          <img src={g.recipe.image} alt={g.recipe.title} />
                        ) : (
                          <div className="saved-dish-icon">
                            <Utensils size={26} strokeWidth={1.5} />
                          </div>
                        )}
                        <div>
                          {g.status === 'finished' && <span className="guide-status">已完成</span>}
                          <h2>{g.recipe.title}</h2>
                          <p>
                            {g.conditions.servings} 人份<span>·</span>
                            {g.conditions.taste}
                            <span>·</span>
                            {g.recipe.minutes} 分钟
                          </p>
                          {g.note && <small className="guide-note">“{g.note}”</small>}
                        </div>
                      </button>
                      <div className="guide-card-bottom">
                        <span>v{g.version}</span>
                        <button
                          className="guide-repeat"
                          onClick={() =>
                            g.status === 'ready' ? openGuide(g) : repeatGuide(g)
                          }
                        >
                          {g.status === 'ready' ? '查看指南' : '再做一次'}
                          <ArrowRight size={14} />
                        </button>
                        <button
                          className="icon-button guide-delete"
                          aria-label={`删除${g.recipe.title}`}
                          onClick={() => deleteGuide(g)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {!filtered.length && (
                  <div className="empty-state">
                    <BookOpen size={37} />
                    <h3>{search ? '未找到菜谱' : '暂无指南'}</h3>
                    <button
                      className="secondary-button"
                      onClick={() => (search ? setSearch('') : navigate('home'))}
                    >
                      {search ? '清空搜索' : '去做一道菜'}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </>
    );
  }
  function renderSettings() {
    return (
      <>
        <header className="root-header">
          <div className="header-identity">
            {backButton}
            <h1 className="mini-brand">
              <Settings2 size={19} />
              我的厨房
            </h1>
          </div>
        </header>
        <main className="page settings-page">
          <section className="settings-section">
            <div className="section-heading">
              <div>
                <h2>模型</h2>
              </div>
              <button className="add-model" onClick={() => editModel()}>
                <Plus size={16} />
                添加
              </button>
            </div>
            <div className="demo-notice">
              <Sparkles size={15} />
              <p>生成、问答与连接测试均为模拟。</p>
            </div>
            <div className="model-list">
              {state.models.map((model) => (
                <article
                  className={`model-card ${model.id === state.modelId ? 'selected' : ''}`}
                  key={model.id}
                >
                  <button
                    className="model-select"
                    aria-label={`使用${model.name}`}
                    onClick={() => {
                      setState((prev) => ({ ...prev, modelId: model.id }));
                      notify(`已切换到 ${model.name}（演示）`);
                    }}
                  >
                    <span className="model-avatar">
                      <Sparkles size={21} />
                    </span>
                    <span>
                      <b>{model.name}</b>
                      <small>{model.model}</small>
                    </span>
                    <span className="radio-circle">{model.id === state.modelId && <span />}</span>
                  </button>
                  <div className="model-endpoint">{model.url}</div>
                  <div className="model-actions">
                    <span>
                      {model.id === state.modelId ? (
                        <>
                          <span className="status-dot" />
                          当前使用
                        </>
                      ) : testedModels.includes(model.id) ? (
                        <>
                          <Check size={12} />
                          模拟连接成功
                        </>
                      ) : (
                        ''
                      )}
                    </span>
                    <button disabled={testingModel !== null} onClick={() => testModel(model)}>
                      {testingModel === model.id ? (
                        <>
                          <LoaderCircle className="spin" size={13} />
                          测试中
                        </>
                      ) : (
                        '测试连接'
                      )}
                    </button>
                    <button onClick={() => editModel(model)}>编辑</button>
                    <button
                      className="icon-button"
                      aria-label={`删除模型${model.name}`}
                      onClick={() =>
                        setConfirm({
                          title: `删除 ${model.name}？`,
                          description: '仅删除当前设备的配置，不影响已保存的指南。',
                          label: '删除配置',
                          action: () => {
                            setState((prev) => ({
                              ...prev,
                              models: prev.models.filter((m) => m.id !== model.id),
                              modelId:
                                prev.modelId === model.id
                                  ? prev.models.find((m) => m.id !== model.id)?.id || ''
                                  : prev.modelId,
                            }));
                            notify('模型配置已删除');
                          },
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!state.models.length && (
              <button className="empty-model" onClick={() => editModel()}>
                <Plus size={20} />
                添加一套模型配置
              </button>
            )}
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h2>数据</h2>
              <ShieldCheck size={19} />
            </div>
            <div className="settings-rows">
              <button onClick={exportData}>
                <span className="row-icon">
                  <ArrowDownToLine size={19} />
                </span>
                <span>
                  <b>导出数据</b>
                  <small>不含 API Key</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setSheet('data')}>
                <span className="row-icon">
                  <SlidersHorizontal size={19} />
                </span>
                <span>
                  <b>管理本地数据</b>
                  <small>
                    {state.guides.length} 份指南 · {state.models.length} 套模型配置
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            </div>
          </section>
        </main>
      </>
    );
  }
  function renderTimer(t: Timer, compact = false) {
    const remaining = timerRemaining(t, now),
      expired = remaining === 0;
    const dish = state.guides.find((g) => g.id === t.guideId)?.recipe.title;
    return (
      <div
        className={`timer-card ${compact ? 'compact' : ''} ${expired ? 'expired' : ''}`}
        key={t.id}
      >
        <div className="timer-card-top">
          <TimerIcon size={17} />
          <span>
            <b>{t.name}</b>
            {!compact && <small>{dish}</small>}
          </span>
          <button
            className="icon-button"
            aria-label={`取消计时${t.name}`}
            onClick={() =>
              setState((prev) => ({
                ...prev,
                timers: prev.timers.filter((timer) => timer.id !== t.id),
              }))
            }
          >
            <X size={17} />
          </button>
        </div>
        <div className="timer-card-body">
          <strong>{formatTime(remaining)}</strong>
          <span>{expired ? '时间到，请检查状态' : t.endAt === null ? '已暂停' : '正在计时'}</span>
          <button
            className="timer-control"
            aria-label={
              expired
                ? `重新计时${t.name}`
                : t.endAt === null
                  ? `继续计时${t.name}`
                  : `暂停计时${t.name}`
            }
            onClick={() =>
              expired
                ? setState((prev) => ({
                    ...prev,
                    timers: prev.timers.map((timer) =>
                      timer.id === t.id
                        ? {
                            ...timer,
                            remaining: timer.total,
                            endAt: Date.now() + timer.total * 1000,
                            notified: false,
                          }
                        : timer,
                    ),
                  }))
                : toggleTimer(t)
            }
          >
            {expired ? (
              <RotateCcw size={18} />
            ) : t.endAt === null ? (
              <Play size={18} />
            ) : (
              <Pause size={18} />
            )}
          </button>
        </div>
        <div className="timer-track">
          <span style={{ width: `${(1 - remaining / t.total) * 100}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${isRoot ? 'root-view' : ''} ${view === 'home' ? 'home-view' : ''} ${state.timers.length ? 'has-timers' : ''}`}>
      <div
        className="app-content"
        inert={sheet !== null || confirm !== null}
        aria-hidden={sheet !== null || confirm !== null ? true : undefined}
      >
        {saveError && (
          <div className="storage-warning" role="alert">
            浏览器无法保存数据。请允许本地存储，或先导出本次记录。
          </div>
        )}
        {view === 'home' && renderHome()}
        {view === 'cook' && renderCook()}
        {(view === 'ai-recipes' || view === 'recipes') && renderRecipePage()}
        {view === 'settings' && renderSettings()}
        {state.timers.length > 0 && !['timers', 'chat'].includes(sheet || '') && (
          <button
            className="floating-timer"
            onClick={() => setSheet('timers')}
            aria-label={
              runningTimers.length
                ? `查看 ${runningTimers.length} 个运行中的计时器`
                : '查看已暂停或到点的计时器'
            }
          >
            <TimerIcon size={16} />
            <b>
              {runningTimers.length
                ? formatTime(Math.min(...runningTimers.map((t) => timerRemaining(t, now))))
                : state.timers.some((t) => timerRemaining(t, now) === 0)
                  ? '时间到'
                  : '已暂停'}
            </b>
            {state.timers.length > 1 && <span>{state.timers.length}</span>}
          </button>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
        </div>
      )}

      {sheet === 'navigation' && (
        <Sheet title="CookPilot" className="navigation-drawer" returnFocus={menuButtonRef.current} onClose={() => setSheet(null)}
          headerActions={<button className="icon-button" aria-label="全局搜索" title="搜索菜谱和对话" onClick={() => {
            setGlobalSearch('');
            setSheet('search');
          }}><Search size={20} /></button>}>
          <nav className="drawer-navigation" aria-label="主要导航">
            {([
              { key: 'ai-recipes', icon: Sparkles, label: 'AI 菜谱' },
              { key: 'recipes', icon: BookOpen, label: '菜谱大全' },
              { key: 'settings', icon: Settings2, label: '我的厨房' },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button key={key} className={view === key ? 'active' : ''}
                aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}>
                <Icon size={19} />{label}<ChevronRight size={15} />
              </button>
            ))}
          </nav>
          <section className="conversation-history" aria-label="对话历史">
            <div className="history-heading"><h3>对话历史</h3></div>
            {conversations.length ? conversations.map((conversation, index) => {
              const group = historyGroup(conversation.updatedAt, now);
              return <div key={conversation.id}>
                {(index === 0 || historyGroup(conversations[index - 1].updatedAt, now) !== group) &&
                  <p className="history-group">{group}</p>}
                <button className={`history-item ${state.activeConversationId === conversation.id ? 'active' : ''}`}
                  aria-current={state.activeConversationId === conversation.id ? 'true' : undefined}
                  onClick={() => openConversation(conversation.id)}>
                  <MessageCircle size={16} /><span>{conversation.title}</span>
                </button>
              </div>;
            }) : <p className="history-empty">暂无对话</p>}
          </section>
          <p className="history-retention">超过 30 天未继续的对话会自动删除</p>
        </Sheet>
      )}
      {sheet === 'search' && (
        <Sheet title="搜索" className="global-search-sheet" returnFocus={menuButtonRef.current} onClose={() => setSheet('navigation')}>
          <label className="search-field global-search-field">
            <Search size={18} />
            <input data-autofocus aria-label="搜索全部内容" placeholder="搜索菜谱、心得或对话" value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)} />
            {globalSearch && <button className="icon-button" aria-label="清空搜索" onClick={() => setGlobalSearch('')}><X size={16} /></button>}
          </label>
          {globalSearch.trim() && (
            <div className="global-search-results" aria-live="polite" aria-atomic="true">
              {([
                { key: 'ai', label: 'AI 菜谱', icon: Sparkles, matches: searchResults.ai.map(({ item, excerpt }) => ({
                  id: item.id, title: item.recipe.title, excerpt, open: () => openGuide(item),
                })) },
                { key: 'catalog', label: '菜谱大全', icon: BookOpen, matches: searchResults.catalog.map(({ item, excerpt }) => ({
                  id: item.id, title: item.title, excerpt, open: () => chooseRecipe(item),
                })) },
                { key: 'history', label: '对话历史', icon: MessageCircle, matches: searchResults.history.map(({ item, excerpt }) => ({
                  id: item.id, title: item.title, excerpt, open: () => openConversation(item.id),
                })) },
              ]).map(({ key, label, icon: Icon, matches }) => (
                <section className="global-search-group" aria-label={label} key={key}>
                  <h3>{label}<span>{matches.length}</span></h3>
                  {matches.map((match) => (
                    <button className="global-search-result" key={match.id} onClick={match.open}>
                      <Icon size={18} />
                      <span><b>{match.title}</b><small>{match.excerpt}</small></span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              ))}
              {!Object.values(searchResults).some((matches) => matches.length) && (
                <p className="global-search-no-match">没有匹配结果</p>
              )}
            </div>
          )}
        </Sheet>
      )}
      {sheet === 'preferences' && (
        <Sheet title="通用设置" onClose={() => setSheet(null)}>
          <form
            className="preferences-form"
            onSubmit={(event) => {
              event.preventDefault();
              setState((prev) => ({ ...prev, preferences: structuredClone(preferencesDraft) }));
              setSheet(null);
              notify('设置已保存');
            }}
          >
            <label htmlFor="avoidances">忌口</label>
            <input
              id="avoidances"
              maxLength={200}
              value={preferencesDraft.avoidances}
              placeholder="花生过敏、蚕豆过敏、不吃小葱"
              onChange={(event) =>
                setPreferencesDraft((prev) => ({ ...prev, avoidances: event.target.value }))
              }
            />
            <label htmlFor="taste-preference">口味</label>
            <input
              id="taste-preference"
              maxLength={100}
              value={preferencesDraft.taste}
              placeholder="微辣、不要太咸"
              onChange={(event) =>
                setPreferencesDraft((prev) => ({ ...prev, taste: event.target.value }))
              }
            />
            <fieldset>
              <legend>锅具</legend>
              <div className="cookware-options">
                {['不粘锅', '铁炒锅', '平底锅', '煮锅', '带盖炖锅', '蒸锅', '高压锅'].map((pot) => (
                  <label
                    className={`cookware-option ${preferencesDraft.cookware.includes(pot) ? 'selected' : ''}`}
                    key={pot}
                  >
                    <input
                      type="checkbox"
                      checked={preferencesDraft.cookware.includes(pot)}
                      onChange={() =>
                        setPreferencesDraft((prev) => ({
                          ...prev,
                          cookware: prev.cookware.includes(pot)
                            ? prev.cookware.filter((item) => item !== pot)
                            : [...prev.cookware, pot],
                        }))
                      }
                    />
                    <span className="cookware-check">
                      {preferencesDraft.cookware.includes(pot) && <Check size={13} />}
                    </span>
                    {pot}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="primary-button" type="submit">
              保存设置
            </button>
          </form>
        </Sheet>
      )}
      {sheet === 'notes' && guide && (
        <Sheet title="心得" subtitle={guide.recipe.title} returnFocus={notesButton.current} onClose={() => setSheet(null)}>
          <form className="notes-form" onSubmit={(event) => {
            event.preventDefault();
            updateGuide((g) => ({ ...g, note: noteDraft }));
            setSheet(null);
            notify('心得已保存');
          }}>
            <label className="sr-only" htmlFor="cooking-notes">我的记录</label>
            <textarea
              id="cooking-notes"
              maxLength={2000}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="记录口味或下次的调整"
            />
            <span className="notes-count">{noteDraft.length} / 2000</span>
            <div className="notes-actions">
              <button type="button" className="secondary-button" onClick={() => setSheet(null)}>取消</button>
              <button type="submit" className="primary-button">保存心得</button>
            </div>
          </form>
        </Sheet>
      )}
      {sheet === 'steps' && guide && (
        <Sheet
          title="全部步骤"
          subtitle={`${guide.recipe.title} · 已完成 ${guide.completed.length}/${guide.recipe.steps.length} 步`}
          onClose={() => setSheet(null)}
        >
          <div className="full-steps">
            <div className="full-prep">
              <CheckCheck size={18} />
              <span>
                <b>先备菜</b>
                <small>{guide.recipe.prep.map((p) => p.title).join(' → ')}</small>
              </span>
              <button className="text-button" onClick={() => {
                updateGuide((g) => ({ ...g, currentCard: 0 }));
                setSheet(null);
              }}>
                查看
              </button>
            </div>
            {guide.recipe.steps.map((step, index) => (
              <button
                key={step.id}
                className={`full-step ${index + 1 === guide.currentCard ? 'current' : ''}`}
                onClick={() => {
                  updateGuide((g) => ({
                    ...g,
                    currentStep: index,
                    currentCard: index + 1,
                    status: g.status === 'ready' ? 'cooking' : g.status,
                  }));
                  navigate('cook');
                }}
              >
                <span className={`step-circle ${guide.completed.includes(step.id) ? 'done' : ''}`}>
                  {guide.completed.includes(step.id) ? <Check size={15} /> : index + 1}
                </span>
                <span>
                  <b>{step.title}</b>
                  <small>
                    {step.heat || '完成装盘'}
                    {step.seconds ? ` · 约 ${formatTime(step.seconds)}` : ''}
                  </small>
                  <p>{step.action}</p>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'timers' && (
        <Sheet title="计时器" onClose={() => setSheet(null)}>
          <div className="timers-list">{state.timers.map((t) => renderTimer(t))}</div>
          {!state.timers.length && (
            <div className="empty-state small">
              <TimerIcon size={37} />
              <h3>暂无计时</h3>
            </div>
          )}
          {guide ? (
            <form
              className="custom-timer"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !customTimer.name.trim() ||
                  customTimer.minutes < 0.05 ||
                  customTimer.minutes > 180
                ) {
                  notify('请填写名称和 0.05–180 分钟的时长');
                  return;
                }
                addTimer(
                  customTimer.name.trim(),
                  Math.round(customTimer.minutes * 60),
                  isPreparation ? 'preparation' : currentStep?.id || 'custom',
                );
                setCustomTimer({ name: '', minutes: 5 });
              }}
            >
              <h3>添加计时</h3>
              <label>
                计时名称
                <input
                  aria-label="计时名称"
                  maxLength={30}
                  value={customTimer.name}
                  placeholder="例如：焖米饭"
                  onChange={(e) => setCustomTimer((t) => ({ ...t, name: e.target.value }))}
                />
              </label>
              <div>
                <label>
                  分钟
                  <input
                    aria-label="计时分钟"
                    type="number"
                    min="0.05"
                    max="180"
                    step="0.05"
                    value={customTimer.minutes}
                    onChange={(e) =>
                      setCustomTimer((t) => ({ ...t, minutes: Number(e.target.value) }))
                    }
                  />
                </label>
                <button className="primary-button" type="submit">
                  <Plus size={17} />
                  开始计时
                </button>
              </div>
            </form>
          ) : (
            <p className="sheet-footnote">打开菜谱后可添加计时</p>
          )}
        </Sheet>
      )}
      {sheet === 'chat' && guide && (
        <Sheet
          title="问问 AI"
          subtitle={`${guide.recipe.title} · ${isPreparation ? '备菜阶段' : `第 ${guide.currentStep + 1} 步`} · 演示问答`}
          className="chat-sheet"
          onClose={() => setSheet(null)}
        >
          <div className="messages">
            {messages.map((m) => (
              <div className={`message ${m.role}`} key={m.id}>
                {m.role === 'assistant' && (
                  <span className="assistant-avatar">
                    <ChefHat size={18} />
                  </span>
                )}
                <p>{m.text}</p>
              </div>
            ))}
            {answering && (
              <div className="message assistant">
                <span className="assistant-avatar">
                  <ChefHat size={18} />
                </span>
                <p className="thinking">
                  <i />
                  <i />
                  <i />
                </p>
              </div>
            )}
            {adjustment && (
              <div className="adjustment-card">
                <div>
                  <SlidersHorizontal size={18} />
                  <b>调整建议</b>
                </div>
                <h3>{adjustment.title}</h3>
                <p>{adjustment.explanation}</p>
                <span>
                  影响步骤：
                  {adjustment.affected
                    .map((id) => `${guide.recipe.steps.findIndex((s) => s.id === id) + 1}`)
                    .join('、')}
                </span>
                <button className="primary-button" onClick={applyAdjustment}>
                  <Check size={16} />
                  更新剩余步骤
                </button>
                <button
                  className="text-button muted"
                  onClick={() => {
                    setAdjustment(null);
                  }}
                >
                  暂不调整
                </button>
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          <div className="quick-questions">
            {['怎么判断熟了？', '锅里出水了', '想少放辣椒', '没有米醋'].map((q) => (
              <button key={q} disabled={answering} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              aria-label="向 AI 提问"
              maxLength={300}
              placeholder="说说锅里的情况…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button aria-label="发送问题" disabled={answering || !question.trim()}>
              <Send size={18} />
            </button>
          </form>
        </Sheet>
      )}
      {sheet === 'model-switch' && (
        <Sheet title="选择模型" subtitle="演示配置" onClose={() => setSheet(null)}>
          <div className="model-switch-list">
            {state.models.map((model) => (
              <button
                className={state.modelId === model.id ? 'selected' : ''}
                key={model.id}
                onClick={() => {
                  setState((prev) => ({ ...prev, modelId: model.id }));
                  setSheet(null);
                  notify(`已切换到 ${model.name}（演示）`);
                }}
              >
                <span className="model-avatar">
                  <Sparkles size={21} />
                </span>
                <span>
                  <b>{model.name}</b>
                  <small>{model.model}</small>
                </span>
                {state.modelId === model.id && <Check size={19} />}
              </button>
            ))}
          </div>
          <button className="secondary-button full-width" onClick={() => navigate('settings')}>
            <Settings2 size={17} />
            管理模型配置
          </button>
        </Sheet>
      )}
      {sheet === 'model-edit' && modelDraft && (
        <Sheet
          title={state.models.some((m) => m.id === modelDraft.id) ? '编辑模型配置' : '添加模型配置'}
          subtitle="演示配置，不调用接口"
          onClose={() => setSheet(null)}
        >
          <form
            className="model-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveModel();
            }}
          >
            <label>
              配置名称
              <input
                required
                maxLength={40}
                value={modelDraft.name}
                placeholder="例如：常用模型"
                onChange={(e) => setModelDraft((m) => (m ? { ...m, name: e.target.value } : m))}
              />
            </label>
            <label>
              接口地址
              <input
                required
                type="url"
                value={modelDraft.url}
                placeholder="https://api.example.com/v1"
                onChange={(e) => setModelDraft((m) => (m ? { ...m, url: e.target.value } : m))}
              />
            </label>
            <label>
              API Key
              <span className="key-input">
                <input
                  autoComplete="off"
                  type={showKey ? 'text' : 'password'}
                  value={modelDraft.key}
                  placeholder="可留空"
                  onChange={(e) => setModelDraft((m) => (m ? { ...m, key: e.target.value } : m))}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <label>
              模型名称
              <input
                required
                value={modelDraft.model}
                placeholder="deepseek-chat"
                onChange={(e) => setModelDraft((m) => (m ? { ...m, model: e.target.value } : m))}
              />
            </label>
            {modelError && (
              <p className="form-error" role="alert">
                {modelError}
              </p>
            )}
            <p className="sheet-footnote">API Key 保存在当前浏览器，导出时排除。</p>
            <button className="primary-button full-width" type="submit">
              <Check size={18} />
              保存配置
            </button>
          </form>
        </Sheet>
      )}
      {sheet === 'data' && (
        <Sheet title="本地数据" subtitle="仅保存在当前浏览器" onClose={() => setSheet(null)}>
          <div className="data-stats">
            <span>
              <b>{state.guides.length}</b>份指南
            </span>
            <span>
              <b>{state.models.length}</b>套配置
            </span>
          </div>
          <div className="data-actions">
            <button className="secondary-button" onClick={exportData}>
              <ArrowDownToLine size={18} />
              导出数据（不含 API Key）
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                setConfirm({
                  title: '恢复最初的演示数据？',
                  description:
                    '将清除当前记录与模型配置，恢复示例指南和对话，无法撤销。',
                  label: '恢复演示数据',
                  action: () => {
                    setState(initialState());
                    setSheet(null);
                    navigate('home');
                    notify('已恢复最初的演示数据');
                  },
                })
              }
            >
              <RotateCcw size={18} />
              恢复演示数据
            </button>
            <button
              className="danger-button"
              onClick={() =>
                setConfirm({
                  title: '清除这台设备上的全部数据？',
                  description:
                    '将删除全部指南、心得、对话历史、计时器和模型配置（含 API Key），无法撤销。',
                  label: '清除全部数据',
                  action: () => {
                    setState({
                      guides: [],
                      models: [],
                      activeId: null,
                      modelId: '',
                      timers: [],
                      preferences: defaultPreferences(),
                      conversations: [],
                      activeConversationId: null,
                    });
                    setSheet(null);
                    navigate('home');
                    notify('本地数据已全部清除');
                  },
                })
              }
            >
              <Trash2 size={18} />
              清除全部本地数据
            </button>
          </div>
        </Sheet>
      )}
      {confirm && (
        <Sheet
          title={confirm.title}
          subtitle={confirm.description}
          onClose={() => setConfirm(null)}
          className="confirmation-sheet"
        >
          <div className="confirmation-actions">
            <button className="secondary-button" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="danger-button"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              {confirm.label}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export default App;
