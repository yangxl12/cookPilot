import { useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/context';
import { db } from '../../storage/db';
import { startTimer, toggleTimer } from '../../storage/repository';
import { formatTime, timerRemaining } from '../../domain/rules';
import { uid } from '../../domain/schema';
import { useTimerClock } from './TimerClock';
import { Sheet } from '../../shared/Sheet';

export function Timers({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const time = useTimerClock(app.data.timers.some((t) => t.status === 'running'));
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('5');
  const sessionId = app.route.sessionId;
  return (
    <Sheet title="计时器" onClose={onClose}>
      {!app.data.timers.length && (
        <p className="empty-help">还没有计时。从备菜或步骤中启动，或添加一个计时。</p>
      )}
      {app.data.timers.map((timer) => {
        const session = app.data.sessions.find((s) => s.id === timer.sessionId);
        const title = app.data.recipes.find((r) => r.id === session?.recipeId)?.name;
        const remaining = timerRemaining(timer, time);
        return (
          <div className={`timer-row ${remaining === 0 ? 'timer-done' : ''}`} key={timer.id}>
            <div>
              <strong>{timer.name}</strong>
              <p className="small muted">
                {title} ·{' '}
                {remaining === 0
                  ? '时间到，请观察食材状态'
                  : timer.status === 'paused'
                    ? '已暂停'
                    : '计时中'}
              </p>
            </div>
            <b className="timer-digits">{formatTime(remaining)}</b>
            {timer.status !== 'done' && remaining > 0 && (
              <button
                className="icon-button"
                aria-label={`${timer.status === 'running' ? '暂停' : '继续'}${timer.name}`}
                onClick={() => {
                  void app.safe(() => toggleTimer(timer.id));
                }}
              >
                {timer.status === 'running' ? <Pause size={18} /> : <Play size={18} />}
              </button>
            )}
            <button
              className="icon-button muted"
              aria-label={`取消${timer.name}计时`}
              onClick={() => {
                void app.safe(() => db.timers.delete(timer.id));
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        );
      })}
      {sessionId && (
        <form
          className="timer-form"
          onSubmit={(e) => {
            e.preventDefault();
            void app.safe(async () => {
              await startTimer(
                sessionId,
                'custom',
                uid(),
                name.trim() || '自定义计时',
                Math.round(Number(minutes) * 60),
              );
              setName('');
            });
          }}
        >
          <h3>添加计时</h3>
          <label>
            名称
            <input
              aria-label="计时名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="例如：焖煮"
            />
          </label>
          <label>
            时长（分钟）
            <input
              aria-label="计时时长"
              type="number"
              min="0.02"
              max="10080"
              step="any"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <button className="primary wide">
            <Plus size={17} />
            添加并开始
          </button>
        </form>
      )}
    </Sheet>
  );
}
