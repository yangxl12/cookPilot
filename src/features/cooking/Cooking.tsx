import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock3,
  Flame,
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
import { Sheet } from '../../shared/Sheet';
import { Carousel } from './Carousel';

export function UsageList({ content, uses }: { content: Content; uses: Usage[] }) {
  const actual = uses.filter((u) => u.fraction > 0);
  return actual.length ? (
    <div className="step-usage">
      <h3>本步用量</h3>
      <div>
        {actual.map((use) => (
          <span key={use.ingredientId}>{ingredientAmount(content, use)}</span>
        ))}
      </div>
    </div>
  ) : null;
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
        保存心得
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
  const [selected, setSelected] = useState(
    session.execution.map((e) => `${e.targetType}:${e.targetId}`),
  );
  const messages = app.data.cookingMessages
    .filter((m) => m.sessionId === session.id)
    .sort((a, b) => a.createdAt - b.createdAt);
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
          <button
            className="primary wide"
            onClick={() => {
              void app.safe(saveProgress);
            }}
          >
            确认这些进度
          </button>
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
                    <button
                      className="primary wide"
                      disabled={!!app.busy}
                      onClick={() => {
                        void app.safe(
                          () => saveProposal(message.id),
                          '已更新本次制作，原版本已保留',
                        );
                      }}
                    >
                      确认更新本次做法
                    </button>
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
  const { data } = app;
  const session = data.sessions.find((s) => s.id === app.route.sessionId);
  const version = data.versions.find((v) => v.id === session?.versionId);
  const [sheet, setSheet] = useState<'note' | 'questions' | 'steps' | 'versions' | null>(null);
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
  const timer = (type: 'prep' | 'step', id: string, title: string, seconds: number) => {
    void app.safe(async () => {
      await startTimer(session.id, type, id, title, seconds);
      app.showTimers();
    });
  };
  const check = (id: string, checked: boolean) => {
    void app.safe(() =>
      db.transaction('rw', db.sessions, async () => {
        const fresh = await db.sessions.get(session.id);
        if (!fresh) return;
        await db.sessions.update(session.id, {
          checked: checked
            ? [...new Set([...fresh.checked, id])]
            : fresh.checked.filter((c) => c !== id),
        });
      }),
    );
  };
  const preparation = (
    <>
      <div className="card-eyebrow">
        开始之前
        <button
          className="version-chip"
          aria-label="查看版本历史"
          onClick={() => setSheet('versions')}
        >
          <Layers size={12} />v{version.number}
        </button>
      </div>
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
        <h2>备菜</h2>
        {content.prep.map((prep) => (
          <div
            className={`prep-item ${session.checked.includes(prep.id) ? 'checked' : ''}`}
            key={prep.id}
          >
            <label className="prep-check">
              <input
                type="checkbox"
                aria-label={prep.title}
                checked={session.checked.includes(prep.id)}
                onChange={(e) => check(prep.id, e.target.checked)}
              />
              <span>
                <strong>{prep.title}</strong>
                <p>{renderAction(content, prep)}</p>
              </span>
            </label>
            {prep.parallel && <p className="parallel-hint">{prep.parallel}</p>}
            {prep.seconds > 0 && (
              <button
                className="timer-button"
                onClick={() => timer('prep', prep.id, prep.title, prep.seconds)}
              >
                <TimerIcon size={15} />
                计时 {Math.round((prep.seconds / 60) * 10) / 10} 分钟
              </button>
            )}
          </div>
        ))}
      </section>
      <div className="preparation-footer">
        <Clock3 size={14} />
        {content.minutes} 分钟 · {content.conditions}
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
                <div className="card-eyebrow">
                  第 {i + 1} 步
                  <span>
                    {i + 1} / {content.steps.length}
                  </span>
                </div>
                <h1>{step.title}</h1>
                {step.heat && (
                  <div className="heat">
                    <Flame size={16} />
                    {step.heat}
                  </div>
                )}
                <p className="step-action">{renderAction(content, step)}</p>
                <UsageList content={content} uses={step.uses} />
                {step.seconds > 0 && (
                  <button
                    className="timer-button step-timer"
                    onClick={() => timer('step', step.id, step.title, step.seconds)}
                  >
                    <TimerIcon size={18} />
                    启动计时 ·{' '}
                    {step.seconds >= 60
                      ? `${Math.round(step.seconds / 6) / 10} 分钟`
                      : `${step.seconds} 秒`}
                  </button>
                )}
                <div className="completion-signal">
                  <h3>
                    <Check size={17} />
                    完成信号
                  </h3>
                  <p>{step.signal}</p>
                </div>
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
          {data.versions
            .filter((v) => v.recipeId === session.recipeId)
            .sort((a, b) => b.number - a.number)
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
