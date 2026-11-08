import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const MESSAGE_PAGE_SIZE = 40;

/** Keep message DOM bounded, including after browsing the whole conversation. */
export function MessageHistory<T>({
  messages,
  renderMessage,
}: {
  messages: T[];
  renderMessage: (message: T) => ReactNode;
}) {
  const [before, setBefore] = useState<number | null>(null);
  const end = Math.min(before ?? messages.length, messages.length);
  const start = Math.max(0, end - MESSAGE_PAGE_SIZE);
  const navigation = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useLayoutEffect(() => setBefore(null), [messages.length]);
  useLayoutEffect(() => {
    if (moved.current) {
      if (document.activeElement === document.body)
        navigation.current?.focus({ preventScroll: true });
      navigation.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      moved.current = false;
    }
  }, [before]);
  const move = (next: number | null) => {
    moved.current = true;
    setBefore(next);
  };
  return (
    <>
      {messages.length > MESSAGE_PAGE_SIZE && (
        <div
          ref={navigation}
          className="message-pagination"
          role="group"
          tabIndex={-1}
          aria-label="对话分页"
        >
          <button
            className="text-button"
            disabled={start === 0}
            onClick={() => move(Math.max(MESSAGE_PAGE_SIZE, end - MESSAGE_PAGE_SIZE))}
          >
            更早消息
          </button>
          <button
            className="text-button"
            disabled={end === messages.length}
            onClick={() =>
              move(end + MESSAGE_PAGE_SIZE >= messages.length ? null : end + MESSAGE_PAGE_SIZE)
            }
          >
            较新消息
          </button>
          {before !== null && (
            <button className="text-button" onClick={() => move(null)}>
              回到最新
            </button>
          )}
        </div>
      )}
      {messages.slice(start, end).map(renderMessage)}
    </>
  );
}
