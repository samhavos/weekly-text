import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Config, SourceConfig } from './config.ts';
import { editUrl, GitHubError } from './github.ts';
import type { SprintView } from './schedule.ts';
import { useSprints } from './useSprints.ts';

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="message" role="status">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Names({ view }: { view: SprintView }) {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const fit = () => {
      for (const line of element.querySelectorAll<HTMLElement>('[data-fit]')) {
        line.style.fontSize = '';
        const width = line.clientWidth;
        if (width > 0 && line.scrollWidth > width) {
          const fontSize = Number.parseFloat(getComputedStyle(line).fontSize);
          line.style.fontSize = `${fontSize * (width - 1) / line.scrollWidth}px`;
        }
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);

  return (
    <div className="wallboard" ref={container}>
      <section className="history" aria-label="Previous sprint names">
        <ol>
          {view.history.map((name, index) => (
            <li
              key={index}
              style={{ fontSize: `calc(var(--history-size) / ${1 + index * 0.08})` }}
            >
              <span className="name" data-fit>{name}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="current" aria-label="Current sprint" aria-live="polite">
        <h1 className="name" data-fit>{view.current}</h1>
      </section>
    </div>
  );
}

export function EditLink({ config }: { config: SourceConfig }) {
  if (!config.repo || !config.edit) return null;
  return (
    <a className="edit-link" href={editUrl(config)} target="_blank" rel="noopener noreferrer">
      <span aria-hidden="true">&#9998; </span>Edit names
    </a>
  );
}

export default function App({ config }: { config: Config }) {
  const { view, error } = useSprints(config);
  return (
    <main>
      {!config.repo && !config.demo ? (
        <Message title="Your sprint names, here.">
          <p>Set <code>?repo=owner/name</code> to read your CSV from GitHub.</p>
          <p>
            Optional: <code>path</code>, <code>ref</code>, <code>token</code>, <code>stale</code>,{' '}
            <code>history</code>, <code>refresh</code>, <code>theme</code>, <code>edit</code>, <code>now</code>.
          </p>
          <a href="?demo=1&amp;now=2026-10-05">Preview with sample names</a>
        </Message>
      ) : view ? (
        <Names view={view} />
      ) : error ? (
        <Message title={error.message}>
          <p>{error instanceof GitHubError ? error.hint : 'Check your connection or CSV file and try again.'}</p>
        </Message>
      ) : (
        <Message title="Loading sprint names..." />
      )}
      <EditLink config={config} />
    </main>
  );
}
