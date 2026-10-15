import { useRef, useState, type ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useApp } from '../app/context';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  action: () => Promise<unknown>;
  pendingLabel: string;
  success?: string;
};

export function ActionButton({
  action,
  pendingLabel,
  success,
  children,
  disabled,
  type = 'button',
  ...props
}: Props) {
  const { safe } = useApp();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={async () => {
        if (locked.current) return;
        locked.current = true;
        setPending(true);
        try {
          await safe(action, success);
        } finally {
          locked.current = false;
          setPending(false);
        }
      }}
    >
      {pending ? (
        <>
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
          {pendingLabel && <span>{pendingLabel}</span>}
        </>
      ) : (
        children
      )}
    </button>
  );
}
