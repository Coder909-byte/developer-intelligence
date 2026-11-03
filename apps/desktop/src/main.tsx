import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@udi/client-sdk';
import { StatusPanel } from '@udi/ui';
import './styles.css';
const client = createClient({ baseUrl: import.meta.env.VITE_UDI_URL ?? 'http://127.0.0.1:4317' });
function App() {
  const [status, setStatus] = useState('Connection has not been checked.');
  const [loading, setLoading] = useState(false);
  async function check() {
    setLoading(true);
    try {
      const health = await client.health();
      setStatus(`Daemon ${health.version}: ${health.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Developer Intelligence</h1>
      <p className="my-4">Local project control center</p>
      <StatusPanel title="Daemon connection">
        <p role="status">{status}</p>
        <button
          className="mt-4 rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          disabled={loading}
          onClick={() => {
            void check();
          }}
        >
          {loading ? 'Checking…' : 'Check connection'}
        </button>
      </StatusPanel>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
