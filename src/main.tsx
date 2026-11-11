import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { EditLink, Message } from './App.tsx';
import { ConfigError, parseConfig, parseSource } from './config.ts';
import type { SourceConfig } from './config.ts';
import './style.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('The app root element is missing.');
const root = createRoot(rootElement);
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
document.documentElement.dataset.theme = theme === 'dark' || theme === 'light' ? theme : 'auto';
let source: SourceConfig | undefined;

try {
  source = parseSource(params);
  const config = parseConfig(location.search);
  root.render(<StrictMode><App config={config} /></StrictMode>);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  root.render(
    <main>
      <Message title="Check the panel URL">
        <p>{error.message}</p>
      </Message>
      {source && <EditLink config={source} />}
    </main>,
  );
}
