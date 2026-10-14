import { useEffect, useRef, useState } from 'react';
import { Timer as TimerIcon } from 'lucide-react';
import { useApp } from '../../app/context';
import { db } from '../../storage/db';
import { formatTime, timerRemaining } from '../../domain/rules';

// Only timer UI ticks, and only while visible with an active countdown.
export function useTimerClock(running: boolean) {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(interval);
      setTime(Date.now());
      if (running && !document.hidden) interval = setInterval(() => setTime(Date.now()), 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [running]);
  return time;
}

export function TimerClock() {
  const { data, route, notify, showTimers } = useApp();
  const time = useTimerClock(data.timers.some((timer) => timer.status === 'running'));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    for (const timer of data.timers) {
      if (timer.status !== 'running' || timerRemaining(timer, time) > 0) continue;
      void db
        .transaction('rw', db.timers, async () => {
          const fresh = await db.timers.get(timer.id);
          if (fresh?.status !== 'running' || timerRemaining(fresh) > 0) return false;
          await db.timers.update(timer.id, {
            status: 'done',
            remaining: 0,
            deadline: null,
            notified: true,
          });
          return true;
        })
        .then((completed) => {
          if (completed && mounted.current) notify(`${timer.name} 时间到，请观察食材状态`);
        })
        .catch(() => {
          if (mounted.current) notify('计时状态保存失败，请重试');
        });
    }
  }, [data.timers, time, notify]);
  if (!data.timers.length || route.page === 'cook') return null;
  const running = data.timers.find(
    (timer) => timer.status === 'running' && timerRemaining(timer, time) > 0,
  );
  return (
    <button className="timer-floating" aria-label="打开所有计时器" onClick={showTimers}>
      <TimerIcon size={16} />
      {running ? formatTime(timerRemaining(running, time)) : '计时器'}
      <span>{data.timers.length}</span>
    </button>
  );
}
