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
import {
  appendMessages,
  migrateConversation,
  recentMessages,
  updateMessage,
  messageTables,
} from '../../storage/messages';
import { useMessagePage } from '../../shared/useMessagePage';
import { commitGeneration, reuseRecipe, latestVersion } from '../../storage/repository';
import { uid, type Candidate, type Content, type RecipeVersion } from '../../domain/schema';
import { restrictionConflict, identity, effectivePreferences } from '../../domain/rules';
import { TaskTimeoutError } from '../../services/ai/budget';
import { MessageHistory } from '../../shared/MessageHistory';
import { HomeComposer } from './HomeComposer';
import { ActionButton } from '../../shared/ActionButton';

export function Home() {
  const app = useApp();
  const { data, busy } = app;
  const conversationSnapshot = useLiveQuery(async () => {
    return {
      id: data.activeConversationId,
      conversation: data.activeConversationId
        ? await db.conversations.get(data.activeConversationId)
        : undefined,
    };
  }, [data.activeConversationId]);
  useEffect(() => {
    if (data.activeConversationId)
      void app.safe(() => migrateConversation(data.activeConversationId!));
  }, [data.activeConversationId, app.safe]);
  const conversationReady =
    !data.activeConversationId ||
    (conversationSnapshot?.id === data.activeConversationId &&
      !conversationSnapshot.conversation?.messages.length);
  const conversation =
    conversationSnapshot?.id === data.activeConversationId
      ? conversationSnapshot.conversation
      : undefined;
  const messagePage = useMessagePage('conversation', data.activeConversationId ?? '');
  const messages = conversationReady ? messagePage.messages : [];
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
        messages.flatMap(
          (message) =>
            message.candidates?.flatMap((candidate) => {
              const recipe = recipesByName.get(identity(candidate.name));
              return recipe ? [recipe.id] : [];
            }) ?? [],
        ) ?? [],
      ),
    ],
    [messages, recipesByName],
  );
  const latestVersions = useLiveQuery(async () => {
    const rows = await Promise.all(recipeIds.map(latestVersion));
    const latest = new Map<string, RecipeVersion>();
    for (const version of rows) if (version) latest.set(version.recipeId, version);
    return latest;
  }, [recipeIds]);
  const preferences = useMemo(
    () => effectivePreferences(data.preferences, conversation?.requirements ?? ''),
    [data.preferences, conversation],
  );
  const [draft, setDraft] = useState<{
    taskId: string;
    content: Content;
    candidate: Candidate;
  } | null>(null);
  const [composerRevision, setComposerRevision] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({
      block: 'end',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [conversation?.messageCount, busy]);
  const requireModel = () => {
    if (!data.models.length) {
      app.notify('请先添加模型配置');
      void app.navigate({ page: 'settings' });
      return false;
    }
    return true;
  };
  const submit = async (input: string, clear: () => void) => {
    if (!conversationReady || !input.trim() || busy || !requireModel()) return;
    const text = input.trim();
    const id = conversation?.id ?? uid();
    const assistantId = uid();
    await app.work('正在分析…', 'recommend', id, async ({ task, model, signal, valid }) => {
      const { recommend } = await import('../../services/ai/cooking');
      if (!valid()) return;
      await db.transaction('rw', [db.tasks, ...messageTables, db.settings], async () => {
        if ((await db.tasks.get(task.id))?.status !== 'pending') return;
        await appendMessages(
          { id, title: text.slice(0, 28), createdAt: Date.now(), lastSentAt: Date.now() },
          [
            { id: uid(), role: 'user', text, createdAt: Date.now() },
            {
              id: assistantId,
              taskId: task.id,
              role: 'assistant',
              text: '正在分析…',
              status: 'pending',
              createdAt: Date.now(),
            },
          ],
        );
        await setSetting('activeConversationId', id);
      });
      if (!valid()) return;
      messagePage.latest();
      clear();
      try {
        const saved = await db.conversations.get(id);
        const history = (await recentMessages(id))
          .filter((m) => !m.status || m.status === 'done')
          .map((m) => ({ role: m.role, content: m.text }));
        history.unshift({ role: 'user', content: `明确要求：${saved?.requirements ?? ''}` });
        const restrictions = effectivePreferences(data.preferences, saved?.requirements ?? '');
        const result = await recommend(
          model,
          history,
          restrictions,
          data.recipes.filter((r) => r.source === 'ai').map((r) => r.name),
          signal,
        );
        if (!valid()) return;
        await db.transaction('rw', [db.tasks, ...messageTables], async () => {
          if ((await db.tasks.get(task.id))?.status !== 'pending') return;
          if (!(await db.conversations.get(id))) return;
          await updateMessage(assistantId, {
            text: result.text,
            candidates: result.candidates,
            status: 'done',
          });
          await db.tasks.update(task.id, { status: 'done' });
        });
      } catch (error) {
        const cancelled = signal.aborted && !(signal.reason instanceof TaskTimeoutError);
        await updateMessage(assistantId, {
          status: cancelled ? 'interrupted' : 'failed',
          text: cancelled ? '请求已取消，可继续发送。' : '分析失败，可重新发送。',
        });
        throw error;
      }
    });
  };
  const select = async (candidate: Candidate) => {
    if (!conversationReady || busy) return;
    let conflict = false;
    const reused = await app.safe(async () => {
      try {
        return await reuseRecipe(candidate.name, preferences);
      } catch (error) {
        conflict = true;
        throw error;
      }
    });
    if (reused) {
      app.notify('沿用已保存版本的用量与做法；可在问问 AI 中请求调整');
      await app.navigate({ page: 'cook', sessionId: reused.id });
      return;
    }
    if (conflict) return;
    if (!requireModel()) return;
    setDraft(null);
    await app.work(
      `正在生成 ${candidate.name}…`,
      'generate',
      conversation?.id ?? '',
      async ({ task, model, signal, valid, stage }) => {
        const [{ generate }, { search }] = await Promise.all([
          import('../../services/ai/cooking'),
          import('../../services/ai/search'),
        ]);
        stage('正在核对做法…');
        const references = await search(model, `${candidate.name} 做法 食材用量`, { signal });
        if (!valid()) return;
        stage(`正在生成 ${candidate.name}…`);
        const content = await generate(
          model,
          candidate,
          `${conversation?.requirements ?? ''}\n${(await recentMessages(conversation?.id ?? '')).map((m) => `${m.role}: ${m.text}`).join('\n')}`,
          preferences,
          signal,
          conversation?.requirements ?? '',
          references,
        );
        if (!valid()) return;
        setDraft({ taskId: task.id, content, candidate });
        const session = await commitGeneration(task.id, content, candidate, preferences);
        setDraft(null);
        if (valid()) {
          app.notify(
            references.length ? `菜谱已保存 · 联网核对 ${references.length} 篇` : '菜谱已保存',
          );
          await app.navigate({ page: 'cook', sessionId: session.id });
        }
      },
      candidate,
    );
  };
  const composerPane = (
    <HomeComposer
      key={`${data.activeConversationId ?? 'new'}:${composerRevision}`}
      ready={conversationReady}
      hasConversation={!!conversation}
      bottom={bottom}
      onSubmit={submit}
    />
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
                setComposerRevision((revision) => revision + 1);
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
            {conversationReady ? messagePage.controls : <p role="status">正在读取对话…</p>}
            <MessageHistory
              key={conversation.id}
              messages={messages}
              renderMessage={(message) => (
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
              )}
            />
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
