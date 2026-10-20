import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock3,
  Flame,
  Globe,
  Layers,
  List,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Send,
  Timer as TimerIcon,
} from 'lucide-react';
import { useApp } from '../../app/context';
import { db } from '../../storage/db';
import { commitCookingMessage, saveProposal, startTimer } from '../../storage/repository';
import { ingredientAmount, renderAction } from '../../domain/rules';
import {
  uid,
  type Content,
  type CookingSession,
  type RecipeVersion,
  type Usage,
} from '../../domain/schema';
import { askCooking } from '../../services/ai/cooking';
import { search, supportsSearch } from '../../services/ai/search';
import { Sheet } from '../../shared/Sheet';
import { Carousel } from './Carousel';
import { ActionButton } from '../../shared/ActionButton';

export function UsageList({ content, uses }: { content: Content; uses: Usage[] }) {
  const actual = uses.filter((u) => u.fraction > 0);
  return actual.length ? (
    <p className="step-usage">{actual.map((use) => ingredientAmount(content, use)).join(' · ')}</p>
  ) : null;
}
function TimerAction({
  sessionId,
  type,
  id,
  title,
  seconds,
}: {
  sessionId: string;
  type: 'prep' | 'step';
  id: string;
  title: string;
  seconds: number;
}) {
  const app = useApp();
  const existing = app.data.timers.find(
    (timer) => timer.sessionId === sessionId && timer.targetType === type && timer.targetId === id,
  );
  const duration = seconds >= 60 ? `${Math.round(seconds / 6) / 10} 分钟` : `${seconds} 秒`;
  return (
    <ActionButton
      className={type === 'step' ? 'step-timer' : 'timer-button'}
      pendingLabel="正在启动…"
      action={async () => {
        await startTimer(sessionId, type, id, title, seconds);
        app.showTimers();
      }}
    >
      <TimerIcon size={15} />
      {existing
        ? `${existing.status === 'paused' ? '已暂停' : existing.status === 'done' ? '时间到' : '计时中'} · 查看计时`
        : `启动计时 · ${duration}`}
    </ActionButton>
  );
}
function Note({ session, onClose }: { session: CookingSession; onClose: () => void }) {
  const app = useApp();
  const [note, setNote] = useState(session.note);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet title="这次的心得" onClose={onClose}>
      <textarea
        data-autofocus
        className="note-input"
        aria-label="心得内容"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="记下这次的做法，下次更顺手。"
      />
      <div className="character-count">{note.length} / 2000</div>
      <button
        className="primary wide"
        disabled={saving}
        aria-busy={saving}
        onClick={() => {
          setSaving(true);
          void app
            .safe(async () => {
              if (!(await db.sessions.update(session.id, { note })))
                throw new Error('制作记录已被删除');
              onClose();
            }, '心得已保存')
            .finally(() => setSaving(false));
        }}
      >
        {saving ? (
          <>
            <LoaderCircle size={16} className="spin" />
            正在保存…
          </>
        ) : (
          '保存心得'
        )}
      </button>
      <button className="secondary wide" onClick={onClose}>
        取消
      </button>
    </Sheet>
  );
}
function Questions({
  session,
  version,
  onClose,
}: {
  session: CookingSession;
  version: RecipeVersion;
  onClose: () => void;
}) {
  const app = useApp();
  const [question, setQuestion] = useState('');
  const [progressEditor, setProgressEditor] = useState(false);
  // 灶台边多数问题菜谱里就有答案，联网是可选件：默认开启，关掉后记住选择。
  const [webSearch, setWebSearch] = useState(
    () => localStorage.getItem('cookpilot-question-search') !== 'off',
  );
  const activeModel =
    app.data.models.find((m) => m.id === app.data.activeModelId) ?? app.data.models[0];
  const searchable = !!activeModel && supportsSearch(activeModel.url);
  const [selected, setSelected] = useState(
    session.execution.map((e) => `${e.targetType}:${e.targetId}`),
  );
  const messages =
    useLiveQuery(
      () => db.cookingMessages.where('sessionId').equals(session.id).sortBy('createdAt'),
      [session.id],
    ) ?? [];
  const content = version.content;
  const submit = async (input = question) => {
    const text = input.trim();
    if (!text || app.busy) return;
    await app.work(
      '正在询问 AI…',
      'question',
      session.id,
      async ({ task, model, signal, valid }) => {
        const fresh = await db.sessions.get(session.id);
        if (!fresh) throw new Error('制作记录不存在');
        const currentVersion = await db.versions.get(fresh.versionId);
        if (!currentVersion) throw new Error('版本不存在');
        await db.cookingMessages.add({
          id: uid(),
          sessionId: session.id,
          role: 'user',
          text,
          createdAt: Date.now(),
        });
        setQuestion('');
        const preferences = {
          ...app.data.preferences,
          avoidances: [currentVersion.preferences?.avoidances, app.data.preferences.avoidances]
            .filter(Boolean)
            .join('、'),
        };
        // 只注入与问题强相关的网页；分数太低（多为泛泛而谈）就让模型用菜谱自身作答。
        const references =
          webSearch && searchable
            ? await search(model, text, { signal, count: 3, minScore: 1.15, maxChars: 400 })
            : [];
        if (!valid()) return;
        const answer = await askCooking(
          model,
          text,
          {
            content: currentVersion.content,
            session: fresh,
            messages: await db.cookingMessages
              .where('sessionId')
              .equals(session.id)
              .sortBy('createdAt'),
            timers: app.data.timers.filter((t) => t.sessionId === session.id),
            preferences,
            strict:
              app.data.recipes.find((r) => r.id === session.recipeId)?.source === 'ai' &&
              !currentVersion.id.startsWith('legacy-'),
          },
          signal,
          references,
        );
        if (!valid()) return;
        await commitCookingMessage(task.id, {
          id: uid(),
          sessionId: session.id,
          role: 'assistant',
          text: answer.text,
          answer,
          baseVersionId: fresh.versionId,
          baseRevision: fresh.revision,
          proposalStatus: answer.proposal ? 'pending' : undefined,
          createdAt: Date.now(),
        });
      },
    );
  };
  const saveProgress = async () => {
    await db.transaction('rw', db.sessions, async () => {
      const fresh = await db.sessions.get(session.id);
      if (!fresh) throw new Error('制作记录不存在');
      if (fresh.versionId !== version.id) throw new Error('版本已改变，请重新核对进度');
      await db.sessions.update(session.id, {
        progressKnown: true,
        revision: fresh.revision + 1,
        execution: selected.map((key) => {
          const [targetType, targetId] = key.split(':');
          return { targetType: targetType as 'prep' | 'step', targetId, confirmedAt: Date.now() };
        }),
      });
    });
    setProgressEditor(false);
    app.notify('实际进度已确认，请重新发送调整要求');
  };
  return (
    <Sheet
      title="问问 AI"
      onClose={() => {
        if (app.busy) void app.cancel();
        onClose();
      }}
    >
      <div className="question-stage">
        {session.currentCard === 0
          ? '备菜阶段'
          : `正在查看：${content.steps[session.currentCard - 1]?.title}`}{' '}
        · v{version.number}
      </div>
      <button
        className="secondary wide"
        disabled={!!app.busy}
        onClick={() => {
          setSelected(session.execution.map((e) => `${e.targetType}:${e.targetId}`));
          setProgressEditor(!progressEditor);
        }}
      >
        确认实际执行进度
      </button>
      {progressEditor && (
        <div className="progress-editor">
          <p className="small muted">只勾选实际已经做过的操作。尚未开始则全部留空。</p>
          {[
            ...content.prep.map((p) => ({ ...p, type: 'prep' })),
            ...content.steps.map((s) => ({ ...s, type: 'step' })),
          ].map((action) => {
            const key = `${action.type}:${action.id}`;
            return (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, key] : selected.filter((k) => k !== key),
                    )
                  }
                />
                <span>
                  {action.type === 'prep' ? '备菜' : '烹饪'} · {action.title}
                </span>
              </label>
            );
          })}
          <ActionButton className="primary wide" pendingLabel="正在确认…" action={saveProgress}>
            确认这些进度
          </ActionButton>
        </div>
      )}
      <div className="cooking-messages" aria-live="polite">
        {!messages.length && <p className="empty-help">遇到状况，描述锅里发生了什么。</p>}
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <p className="message-text">{message.text}</p>
            {!!message.answer?.confirmations.length && (
              <button className="text-button" onClick={() => setProgressEditor(true)}>
                核对实际进度
                <ArrowLeft size={14} className="rotate" />
              </button>
            )}
            {message.answer?.proposal && (
              <div className="proposal">
                <h3>建议调整</h3>
                <p>{message.answer.proposal.explanation}</p>
                <ul>
                  {[...message.answer.proposal.prep, ...message.answer.proposal.steps].map((s) => (
                    <li key={s.id}>
                      {s.title}：
                      {renderAction(
                        {
                          ...content,
                          ingredients: content.ingredients.map(
                            (i) =>
                              message.answer?.proposal?.ingredients.find((p) => p.id === i.id) ?? i,
                          ),
                        },
                        s,
                      )}
                    </li>
                  ))}
                </ul>
                {message.proposalStatus === 'pending' ? (
                  <>
                    <ActionButton
                      className="primary wide"
                      disabled={!!app.busy}
                      pendingLabel="正在更新…"
                      success="已更新本次制作，原版本已保留"
                      action={() => saveProposal(message.id)}
                    >
                      确认更新本次做法
                    </ActionButton>
                    <button
                      className="secondary wide"
                      onClick={() => {
                        void app.safe(() =>
                          db.cookingMessages.update(message.id, { proposalStatus: 'cancelled' }),
                        );
                      }}
                    >
                      取消建议
                    </button>
                  </>
                ) : (
                  <p className="badge">
                    {message.proposalStatus === 'applied' ? '已应用' : '已取消'}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="quick-questions">
        {(session.currentCard === 0
          ? ['材料不够怎么办', '可以提前准备什么']
          : ['怎么判断熟了', '锅里出水了']
        ).map((q) => (
          <button
            key={q}
            disabled={!!app.busy}
            onClick={() => {
              void submit(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>
      <form
        className="question-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="烹饪问题"
          placeholder="描述问题或想调整的做法…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
          disabled={!!app.busy}
        />
        {searchable && (
          <button
            type="button"
            className="web-toggle"
            aria-label={webSearch ? '关闭联网查找' : '开启联网查找'}
            aria-pressed={webSearch}
            disabled={!!app.busy}
            onClick={() => {
              const next = !webSearch;
              setWebSearch(next);
              localStorage.setItem('cookpilot-question-search', next ? 'on' : 'off');
            }}
          >
            <Globe size={17} />
          </button>
        )}
        <button
          className="primary"
          aria-label="发送烹饪问题"
          disabled={!question.trim() || !!app.busy}
        >
          {app.busy ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
        </button>
      </form>
      {app.busy && (
        <p className="small muted" role="status">
          {app.busy}
        </p>
      )}
    </Sheet>
  );
}
export function Cooking() {
  const app = useApp();
  const sessionId = app.route.sessionId;
  // Read this one record instead of the whole table: ticking a checkbox must not reload history.
  const sessionSnapshot = useLiveQuery(
    async () => ({
      id: sessionId,
      session: sessionId ? await db.sessions.get(sessionId) : undefined,
    }),
    [sessionId],
  );
  const sessionLoaded = sessionSnapshot?.id === sessionId;
  const session = sessionLoaded ? sessionSnapshot?.session : undefined;
  const versionSnapshot = useLiveQuery(
    async () => ({
      id: session?.versionId,
      version: session ? await db.versions.get(session.versionId) : undefined,
    }),
    [session?.versionId],
  );
  const version = versionSnapshot?.id === session?.versionId ? versionSnapshot?.version : undefined;
  const [sheet, setSheet] = useState<'note' | 'questions' | 'steps' | 'versions' | null>(null);
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!session) return;
    setPendingChecks((previous) => {
      const remaining = Object.entries(previous).filter(
        ([id, checked]) => session.checked.includes(id) !== checked,
      );
      return remaining.length === Object.keys(previous).length
        ? previous
        : Object.fromEntries(remaining);
    });
  }, [session?.checked]);
  const versions = useLiveQuery(
    () =>
      sheet === 'versions' && session
        ? db.versions.where('recipeId').equals(session.recipeId).sortBy('number')
        : [],
    [sheet === 'versions', session?.recipeId],
  );
  if (!sessionLoaded || (session && versionSnapshot?.id !== session.versionId))
    return (
      <div className="boot" role="status">
        <LoaderCircle className="spin" size={24} />
        正在打开指南…
      </div>
    );
  if (!session || !version)
    return (
      <>
        <header className="root-header">
          <button className="icon-button" aria-label="返回" onClick={app.back}>
            <ArrowLeft />
          </button>
          <h1>烹饪指南</h1>
        </header>
        <div className="empty-state">
          <p>制作记录不存在或已被删除</p>
          <button
            className="primary"
            onClick={() => {
              void app.navigate({ page: 'home' });
            }}
          >
            返回首页
          </button>
        </div>
      </>
    );
  const content = version.content;
  const index = Math.min(content.steps.length, session.currentCard);
  const select = (currentCard: number) => {
    void app.safe(() => db.sessions.update(session.id, { currentCard }));
  };
  const isChecked = (id: string) => pendingChecks[id] ?? session.checked.includes(id);
  const check = (id: string, checked: boolean) => {
    setPendingChecks((previous) => ({ ...previous, [id]: checked }));
    void app
      .safe(() =>
        db.transaction('rw', db.sessions, async () => {
          const fresh = await db.sessions.get(session.id);
          if (!fresh) throw new Error('制作记录已被删除');
          await db.sessions.update(session.id, {
            checked: checked
              ? [...new Set([...fresh.checked, id])]
              : fresh.checked.filter((c) => c !== id),
          });
          return true;
        }),
      )
      .then((saved) => {
        if (!saved)
          setPendingChecks((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
          });
      });
  };
  const preparation = (
    <>
      <h1>准备好，再开火</h1>
      <section className="prep-section">
        <h2>要点</h2>
        {content.keyPoints.map((point) => (
          <p className="key-point" key={point}>
            {point}
          </p>
        ))}
      </section>
      <section className="prep-section">
        <h2>食材和调味辅料</h2>
        {(['主料', '调味'] as const).map((group) => (
          <table className="recipe-ingredient-table" key={group}>
            <caption>{group === '主料' ? '主要食材' : '调味与辅料'}</caption>
            <tbody>
              {content.ingredients
                .filter((i) => i.group === group)
                .map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {i.note && <small>{i.note}</small>}
                    </td>
                    <td>{i.quantity === null ? i.amountText : `${i.quantity}${i.unit}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
      </section>
      <section className="prep-section">
        <h2 className="prep-heading">
          备菜{' '}
          <span>
            {content.prep.filter((prep) => isChecked(prep.id)).length} / {content.prep.length}{' '}
            已备好
          </span>
        </h2>
        {content.prep.map((prep) => (
          <div className={`prep-item ${isChecked(prep.id) ? 'checked' : ''}`} key={prep.id}>
            <label className="prep-check">
              <input
                type="checkbox"
                aria-label={prep.title}
                checked={isChecked(prep.id)}
                disabled={pendingChecks[prep.id] !== undefined}
                onChange={(e) => check(prep.id, e.target.checked)}
              />
              <span>
                <strong>{prep.title}</strong>
                <p>{renderAction(content, prep)}</p>
              </span>
            </label>
            {prep.parallel && <p className="parallel-hint">{prep.parallel}</p>}
            {prep.seconds > 0 && (
              <TimerAction
                sessionId={session.id}
                type="prep"
                id={prep.id}
                title={prep.title}
                seconds={prep.seconds}
              />
            )}
          </div>
        ))}
      </section>
      <div className="preparation-footer">
        <Clock3 size={14} />
        {content.minutes} 分钟 · {content.conditions}
        <button
          className="version-chip"
          aria-label="查看版本历史"
          onClick={() => setSheet('versions')}
        >
          <Layers size={12} />v{version.number}
        </button>
      </div>
    </>
  );
  return (
    <>
      <div className="cooking-page">
        <header className="process-header">
          <button className="icon-button" aria-label="返回" onClick={app.back}>
            <ArrowLeft size={20} />
          </button>
          <h1>{content.title}</h1>
          <div className="process-actions">
            <button
              className="icon-button labeled"
              aria-label="心得"
              onClick={() => setSheet('note')}
            >
              <NotebookPen size={18} />
              <span>心得</span>
            </button>
            <button
              className="icon-button labeled"
              aria-label="问问 AI"
              onClick={() => setSheet('questions')}
            >
              <MessageCircle size={18} />
              <span>问 AI</span>
            </button>
            <button className="icon-button labeled" aria-label="计时器" onClick={app.showTimers}>
              <TimerIcon size={18} />
              <span>计时</span>
            </button>
            <button className="icon-button" aria-label="全部步骤" onClick={() => setSheet('steps')}>
              <List size={20} />
            </button>
          </div>
        </header>
        <Carousel
          index={index}
          labels={['准备', ...content.steps.map((s) => s.title)]}
          onSelect={select}
        >
          {[
            preparation,
            ...content.steps.map((step, i) => (
              <div key={step.id}>
                <h1 className="step-title">
                  <span className="step-index">
                    {i + 1}/{content.steps.length}
                  </span>
                  {step.title}
                  {step.heat && (
                    <span className="step-heat">
                      <Flame size={13} />
                      {step.heat}
                    </span>
                  )}
                </h1>
                <p className="step-action">{renderAction(content, step)}</p>
                <UsageList content={content} uses={step.uses} />
                {step.seconds > 0 && (
                  <TimerAction
                    sessionId={session.id}
                    type="step"
                    id={step.id}
                    title={step.title}
                    seconds={step.seconds}
                  />
                )}
                {step.signal && (
                  <div className="completion-signal">
                    <h3>
                      <Check size={13} />
                      完成信号
                    </h3>
                    <p>{step.signal}</p>
                  </div>
                )}
                {step.tip && (
                  <div className="step-tip">
                    <h3>留意</h3>
                    <p>{step.tip}</p>
                  </div>
                )}
              </div>
            )),
          ]}
        </Carousel>
      </div>
      {sheet === 'note' && <Note session={session} onClose={() => setSheet(null)} />}
      {sheet === 'questions' && (
        <Questions session={session} version={version} onClose={() => setSheet(null)} />
      )}
      {sheet === 'steps' && (
        <Sheet title="全部步骤" onClose={() => setSheet(null)}>
          {['准备', ...content.steps.map((s) => s.title)].map((title, i) => (
            <button
              className={`step-directory-row ${i === index ? 'active' : ''}`}
              aria-current={i === index ? 'step' : undefined}
              key={i}
              onClick={() => {
                select(i);
                setSheet(null);
              }}
            >
              <span>{i || '准'}</span>
              {title}
              {i === index && <Check size={17} />}
            </button>
          ))}
        </Sheet>
      )}
      {sheet === 'versions' && (
        <Sheet title="版本历史" onClose={() => setSheet(null)}>
          {(versions ?? [])
            .slice()
            .reverse()
            .map((v) => (
              <details className="version-history" key={v.id}>
                <summary>
                  <strong>
                    v{v.number}
                    {v.id === version.id ? ' · 本次使用' : ''}
                  </strong>
                  <span>{new Date(v.createdAt).toLocaleDateString('zh-CN')}</span>
                </summary>
                <p>{v.change}</p>
                {v.content.steps.map((s) => (
                  <p className="small muted" key={s.id}>
                    <strong>{s.title}</strong> · {renderAction(v.content, s)}
                  </p>
                ))}
              </details>
            ))}
        </Sheet>
      )}
    </>
  );
}
