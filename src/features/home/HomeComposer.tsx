import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useApp } from '../../app/context';

export function HomeComposer({
  ready,
  hasConversation,
  bottom,
  onSubmit,
}: {
  ready: boolean;
  hasConversation: boolean;
  bottom: RefObject<HTMLDivElement | null>;
  onSubmit: (text: string, clear: () => void) => Promise<void>;
}) {
  const app = useApp();
  const busy = app.busy;
  const [prompt, setPrompt] = useState('');
  const composer = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
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
  }, []);
  return (
    <div className="home-composer" ref={composer}>
      <form
        className="prompt-input"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(prompt, () => setPrompt(''));
        }}
      >
        <textarea
          ref={field}
          rows={1}
          aria-label="描述做菜需求"
          placeholder={hasConversation ? '换个想法，或继续聊聊…' : '有番茄和鸡蛋，做点什么？'}
          maxLength={1000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!!busy || !ready}
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
              void onSubmit(prompt, () => setPrompt(''));
            }
          }}
        />
        <button
          className="prompt-submit"
          aria-label="发送消息"
          aria-busy={!!busy}
          disabled={!!busy || !ready || !prompt.trim()}
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
}
