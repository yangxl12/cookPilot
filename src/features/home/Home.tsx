import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BookOpen,
  ChefHat,
  ChevronDown,
  Clock3,
  LoaderCircle,
  Menu,
  MessageSquarePlus,
  Settings2,
} from 'lucide-react';
import { useApp } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { commitGeneration, findExisting, reuseRecipe } from '../../storage/repository';
import { uid, type Candidate, type Content, type Conversation } from '../../domain/schema';
import { restrictionConflict, identity, effectivePreferences } from '../../domain/rules';
import { recommend, generate } from '../../services/ai/cooking';
import { ActionButton } from '../../shared/ActionButton';

export function Home() {
  const app = useApp();
  const { data, busy } = app;
  const conversationSnapshot = useLiveQuery(
    async () => ({
      id: data.activeConversationId,
      conversation: data.activeConversationId
        ? await db.conversations.get(data.activeConversationId)
        : undefined,
    }),
    [data.activeConversationId],
  );
  const conversationReady =
    !data.activeConversationId || conversationSnapshot?.id === data.activeConversationId;
  const conversation =
    conversationSnapshot?.id === data.activeConversationId
      ? conversationSnapshot.conversation
      : undefined;
  const recipesByName = useMemo(() => {
    const names = new Map<string, (typeof data.recipes)[number]>();
    for (const recipe of data.recipes)
      if (recipe.source === 'ai')
        for (const name of [recipe.name, ...recipe.aliases])
          if (!names.has(identity(name))) names.set(identity(name), recipe);
    return names;
  }, [data.recipes]);
  const recipeIds = useMemo(
    () => [
      ...new Set(
        conversation?.messages.flatMap(
          (message) =>
            message.candidates?.flatMap((candidate) => {
              const recipe = recipesByName.get(identity(candidate.name));
              return recipe ? [recipe.id] : [];
            }) ?? [],
        ) ?? [],
      ),
    ],
    [conversation, recipesByName],
  );
  const latestVersions = useLiveQuery(
    async () =>
      new Map(
        (
          await Promise.all(
            recipeIds.map((id) =>
              db.versions
                .where('[recipeId+number]')
                .between([id, Dexie.minKey], [id, Dexie.maxKey])
                .last(),
            ),
          )
        )
          .filter((v) => v !== undefined)
          .map((v) => [v.recipeId, v]),
      ),
    [recipeIds],
  );
  const preferences = useMemo(
    () =>
      effectivePreferences(
        data.preferences,
        conversation?.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.text)
          .join('\n') ?? '',
      ),
    [data.preferences, conversation],
  );
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<{
    taskId: string;
    content: Content;
    candidate: Candidate;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setPrompt(''), [data.activeConversationId]);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [prompt]);
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    const root = document.documentElement;
    let height = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      if (next === height) return;
      const pinned = window.innerHeight + window.scrollY >= root.scrollHeight - 160;
      const delta = next - height;
      height = next;
      root.style.setProperty('--composer-h', `${next}px`);
      // Keep the newest message above the composer while it grows.
      if (pinned && delta > 0) window.scrollBy({ top: delta, behavior: 'instant' });
    });
    observer.observe(element);
    root.style.setProperty('--composer-h', `${height}px`);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--composer-h');
    };
  }, [app.composerHost]);
  useEffect(() => {
    bottom.current?.scrollIntoView({
      block: 'end',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [conversation?.messages.length, busy]);
  const requireModel = () => {
    if (!data.models.length) {
      app.notify('请先添加模型配置');
      void app.navigate({ page: 'settings' });
      return false;
    }
    return true;
  };
  const submit = async () => {
    if (!conversationReady || !prompt.trim() || busy || !requireModel()) return;
    const text = prompt.trim();
    const id = conversation?.id ?? uid();
    const assistantId = uid();
    await app.work('正在分析…', 'recommend', id, async ({ task, model, signal, valid }) => {
      await db.transaction('rw', [db.conversations, db.settings], async () => {
        const previous = await db.conversations.get(id);
        const current: Conversation = previous ?? {
          id,
          title: text.slice(0, 28),
          createdAt: Date.now(),
          lastSentAt: Date.now(),
          messages: [],
        };
        current.lastSentAt = Date.now();
        current.messages.push(
          { id: uid(), role: 'user', text, createdAt: Date.now() },
          {
            id: assistantId,
            taskId: task.id,
            role: 'assistant',
            text: '正在分析…',
            status: 'pending',
            createdAt: Date.now(),
          },
        );
        await db.conversations.put(current);
        await setSetting('activeConversationId', id);
      });
      setPrompt('');
      try {
        const saved = await db.conversations.get(id);
        const history = saved!.messages
          .filter(
            (m) => m.status !== 'pending' && m.status !== 'failed' && m.status !== 'interrupted',
          )
          .map((m) => ({ role: m.role, content: m.text }));
        const restrictions = effectivePreferences(
          data.preferences,
          saved!.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.text)
            .join('\n'),
        );
        const result = await recommend(
          model,
          history,
          restrictions,
          data.recipes.filter((r) => r.source === 'ai').map((r) => r.name),
          signal,
        );
        if (!valid()) return;
        await db.transaction('rw', [db.tasks, db.conversations], async () => {
          if ((await db.tasks.get(task.id))?.status !== 'pending') return;
          const current = await db.conversations.get(id);
          if (!current) return;
          current.messages = current.messages.map((m) =>
            m.id === assistantId
              ? { ...m, text: result.text, candidates: result.candidates, status: 'done' }
              : m,
          );
          await db.conversations.put(current);
          await db.tasks.update(task.id, { status: 'done' });
        });
      } catch (error) {
        await db.conversations
          .where('id')
          .equals(id)
          .modify((c) => {
            c.messages = c.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    status: signal.aborted ? 'interrupted' : 'failed',
                    text: signal.aborted ? '请求已取消，可继续发送。' : '分析失败，可重新发送。',
                  }
                : m,
            );
          });
        throw error;
      }
    });
  };
  const select = async (candidate: Candidate) => {
    if (!conversationReady || busy) return;
    const reused = await app.safe(() => reuseRecipe(candidate.name, preferences));
    if (reused) {
      app.notify('沿用已保存版本的用量与做法；可在问问 AI 中请求调整');
      await app.navigate({ page: 'cook', sessionId: reused.id });
      return;
    }
    if (await findExisting(candidate.name)) return; // Existing conflict already explained; never generate a bypass duplicate.
    if (!requireModel()) return;
    setDraft(null);
    await app.work(
      `正在生成 ${candidate.name}…`,
      'generate',
      conversation?.id ?? '',
      async ({ task, model, signal, valid }) => {
        const content = await generate(
          model,
          candidate,
          conversation?.messages
            .filter((m) => m.status !== 'pending')
            .map((m) => `${m.role}: ${m.text}`)
            .join('\n') ?? '',
          preferences,
          signal,
          conversation?.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.text)
            .join('\n') ?? '',
        );
        if (!valid()) return;
        setDraft({ taskId: task.id, content, candidate });
        const session = await commitGeneration(task.id, content, candidate, preferences);
        setDraft(null);
        if (valid()) {
          app.notify('菜谱已保存');
          await app.navigate({ page: 'cook', sessionId: session.id });
        }
      },
      candidate,
    );
  };
  const composerPane = (
    <div className="home-composer" ref={composer}>
      <form
        className="prompt-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={field}
          rows={1}
          aria-label="描述做菜需求"
          placeholder={conversation ? '换个想法，或继续聊聊…' : '有番茄和鸡蛋，做点什么？'}
          maxLength={1000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!!busy || !conversationReady}
          onFocus={() => {
            bottom.current?.scrollIntoView({
              block: 'end',
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="prompt-submit"
          aria-label="发送消息"
          aria-busy={!!busy}
          disabled={!!busy || !conversationReady || !prompt.trim()}
        >
          {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={21} />}
        </button>
      </form>
      {busy && (
        <div className="busy-line" role="status">
          {busy}
          <button
            onClick={() => {
              void app.safe(async () => {
                await app.cancel();
                app.notify('已取消，可继续发送');
              });
            }}
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
  return (
    <>
      <header className="home-header">
        <div className="header-identity">
          <button
            className="icon-button"
            aria-label="打开菜单"
            aria-expanded={app.menuOpen}
            aria-controls="cookpilot-drawer"
            onClick={app.showMenu}
          >
            <Menu size={21} />
          </button>
          <a className="brand" href="#home">
            <ChefHat size={24} strokeWidth={1.7} />
            <span>CookPilot</span>
          </a>
        </div>
        <div className="home-controls">
          <button
            className="icon-button"
            aria-label="新建对话"
            onClick={() => {
              void app.safe(async () => {
                await app.cancel();
                await setSetting('activeConversationId', null);
                setPrompt('');
                setDraft(null);
              }, '已新建对话');
            }}
          >
            <MessageSquarePlus size={20} />
          </button>
          <button className="model-pill" onClick={app.showModels}>
            <span>{data.models.find((m) => m.id === data.activeModelId)?.name ?? '选择模型'}</span>
            <ChevronDown size={12} />
          </button>
          <button
            className="icon-button"
            aria-label="通用设置"
            disabled={!!busy}
            onClick={app.showPreferences}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <main className="home">
        {!conversation && (
          <div className="home-welcome">
            <h1>想做什么菜？</h1>
            <p>说说食材和口味，一起决定这顿吃什么。</p>
            <button
              className="home-browse text-button"
              onClick={() => void app.navigate({ page: 'recipes' })}
            >
              <BookOpen size={17} />
              逛逛菜谱大全
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {conversation && (
          <div className="discovery-conversation" aria-label="做菜灵感对话">
            {conversation.messages.map((message) => (
              <div className={`message ${message.role}`} key={message.id}>
                {message.role === 'assistant' && (
                  <span className="discovery-author">
                    <ChefHat size={18} /> CookPilot
                  </span>
                )}
                <p className="message-text">
                  {message.status === 'pending' && (
                    <LoaderCircle size={15} className="spin inline" />
                  )}
                  {message.text}
                </p>
                {message.candidates?.map((candidate, index) => {
                  const recipe = recipesByName.get(identity(candidate.name));
                  const version = recipe ? latestVersions?.get(recipe.id) : undefined;
                  const conflict = version
                    ? restrictionConflict(version.content, preferences)
                    : candidate.blocked;
                  return (
                    <article className="recommendation" key={`${message.id}-${index}`}>
                      <div className="recommendation-heading">
                        <h2>{candidate.name}</h2>
                        {version && <span className="badge">已有 · v{version.number}</span>}
                      </div>
                      <div className="recommendation-meta">
                        <Clock3 size={13} />
                        {candidate.minutes} 分钟<span>{candidate.difficulty}</span>
                      </div>
                      <p className="muted small">{candidate.summary}</p>
                      {conflict && <p className="warning">{conflict}</p>}
                      <ActionButton
                        className="primary recommendation-select"
                        disabled={!!busy || !!conflict}
                        pendingLabel={version ? '正在打开…' : '正在生成…'}
                        action={() => select(candidate)}
                      >
                        {version ? '使用已有菜谱' : '生成菜谱'}
                        <ArrowRight size={15} />
                      </ActionButton>
                    </article>
                  );
                })}
              </div>
            ))}
            <div
              ref={bottom}
              style={{ scrollMarginBottom: 'calc(var(--composer-h, 120px) + 12px)' }}
            />
          </div>
        )}
        {draft && !busy && (
          <div className="save-retry">
            <p>指南已生成，但尚未保存。</p>
            <button
              className="primary"
              onClick={() => {
                void app.safe(async () => {
                  const session = await commitGeneration(
                    draft.taskId,
                    draft.content,
                    draft.candidate,
                    preferences,
                  );
                  setDraft(null);
                  await app.navigate({ page: 'cook', sessionId: session.id });
                });
              }}
            >
              重试保存（不重新生成）
            </button>
          </div>
        )}
      </main>
      {app.composerHost ? createPortal(composerPane, app.composerHost) : composerPane}
    </>
  );
}
