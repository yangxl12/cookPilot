import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
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
import { restrictionConflict, nameMatches, effectivePreferences } from '../../domain/rules';
import { recommend, generate } from '../../services/ai/cooking';

export function Home() {
  const app = useApp();
  const { data, busy } = app;
  const conversation = data.conversations.find((c) => c.id === data.activeConversationId);
  const preferences = effectivePreferences(
    data.preferences,
    conversation?.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
      .join('\n') ?? '',
  );
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<{
    taskId: string;
    content: Content;
    candidate: Candidate;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
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
    if (!prompt.trim() || busy || !requireModel()) return;
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
    if (busy) return;
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
  return (
    <>
      <header className="home-header">
        <div className="header-identity">
          <button className="icon-button" aria-label="打开菜单" onClick={app.showMenu}>
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
              });
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
      <main className={`home ${conversation ? 'home-conversation' : ''}`}>
        {!conversation && (
          <div className="home-welcome">
            <h1>想做什么菜？</h1>
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
                  const recipe = data.recipes.find(
                    (r) => r.source === 'ai' && nameMatches(candidate.name, [r.name, ...r.aliases]),
                  );
                  const version = data.versions
                    .filter((v) => v.recipeId === recipe?.id)
                    .sort((a, b) => b.number - a.number)[0];
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
                      <button
                        className="recommendation-select"
                        disabled={!!busy || !!conflict}
                        onClick={() => {
                          void app.safe(() => select(candidate));
                        }}
                      >
                        {version ? '使用已有菜谱' : '生成菜谱'}
                        <ArrowRight size={15} />
                      </button>
                    </article>
                  );
                })}
              </div>
            ))}
            <div ref={bottom} />
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
        <div className="home-composer">
          <form
            className="prompt-input"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              aria-label="描述做菜需求"
              placeholder={
                conversation ? '换个想法，或继续聊聊…' : '比如：有番茄和鸡蛋，想吃点简单的'
              }
              maxLength={1000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!!busy}
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
              disabled={!!busy || !prompt.trim()}
            >
              {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={21} />}
            </button>
          </form>
          {busy && (
            <div className="busy-line" role="status">
              {busy}
              <button
                onClick={() => {
                  void app.cancel();
                }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
