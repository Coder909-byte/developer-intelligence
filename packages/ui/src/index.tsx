import type { PropsWithChildren } from 'react';
export function StatusPanel({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
