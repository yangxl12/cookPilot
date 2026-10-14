import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../app/context';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const { back } = useApp();
  return (
    <header className="root-header">
      <button className="icon-button" aria-label="返回" onClick={back}>
        <ArrowLeft size={21} />
      </button>
      <h1>{title}</h1>
      <div>{children}</div>
    </header>
  );
}
