import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import type { AgentHandoff } from '@udi/contracts';
import { Badge, Button, EmptyState, Field, sourceLabel } from '@udi/ui';
import { PixelRoom } from './PixelRoom.js';
import { Result, useResource } from './data.js';
import { CreateHandoff, HandoffDetail, scoped, usePage } from './persistence.js';

// Visual variation only. Session content always comes from persisted handoffs.
function bookStyle(id: string): CSSProperties {
  let hash = [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const colors = ['#c5ad76', '#8d9c7b', '#b76e54', '#d3c5a1', '#748c98', '#9b7b91'];
  return {
    '--book-width': `${34 + (hash % 33)}px`,
    '--book-height': `${174 + ((hash >>> 5) % 87)}px`,
    '--book-color': colors[hash % colors.length],
  } as CSSProperties;
}

export function SessionBookshelf({
  books,
  onSelect,
  latestId,
  navigation,
}: {
  books: AgentHandoff[];
  onSelect: (id: string) => void;
  latestId?: string | undefined;
  navigation?: { previous: () => void; next: () => void; canPrevious: boolean; canNext: boolean } | undefined;
}) {
  const booksPerShelf = 18;
  const shelfCount = Math.max(3, Math.ceil(books.length / booksPerShelf));
  return (
    <div className="library-shelves" aria-label="Session bookshelves">
      <div className="bookcase-crown">
        <span>THE SESSION ARCHIVE</span>
        <span aria-hidden="true">✦</span>
      </div>
      {Array.from({ length: shelfCount }, (_, index) => (
        <div className="wooden-shelf" key={index}>
          <div className="library-book-row" aria-label={`Shelf ${index + 1}`}>
            {books.slice(index * booksPerShelf, (index + 1) * booksPerShelf).map((book) => {
              const isLatest = book.id === latestId;
              return (
                <button
                  type="button"
                  className={`session-book ${isLatest ? 'latest-book' : ''}`}
                  key={book.id}
                  style={bookStyle(book.id)}
                  title={`${book.summary} · ${new Date(book.createdAt).toLocaleString()} · ${sourceLabel(book.provenance.sourceKind)}`}
                  aria-label={`Read saved session: ${book.summary}`}
                  onClick={() => onSelect(book.id)}
                >
                  <span className="book-binding" aria-hidden="true" />
                  <span className="book-volume" aria-hidden="true">
                    UDI
                  </span>
                  <strong>{book.summary}</strong>
                  <span className="book-date">
                    {new Date(book.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className={`book-seal ${isLatest ? 'latest' : ''}`} aria-hidden="true">
                    {isLatest ? '★ LATEST' : '✦'}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="wooden-shelf-edge">
            <span>ARCHIVE / {String(index + 1).padStart(2, '0')}</span>
          </div>
        </div>
      ))}
      <nav className="bookcase-base" aria-label="Shelf navigation">
        <button type="button" disabled={!navigation?.canPrevious} onClick={navigation?.previous}>
          <span aria-hidden="true">←</span> Previous shelf
        </button>
        <button type="button" disabled={!navigation?.canNext} onClick={navigation?.next}>
          Next shelf <span aria-hidden="true">→</span>
        </button>
      </nav>
    </div>
  );
}

export function Library({
  client,
  projectId,
  onConnect,
}: {
  client: DaemonClient;
  projectId: string | undefined;
  onConnect?: () => void;
}) {
  const page = usePage();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [loadingHermes, setLoadingHermes] = useState(false);
  const list = useResource(
    async () => {
      if (!projectId) return { items: [] };
      let result = await client.listHandoffs(projectId, page.options);
      scoped(result.items, projectId);
      if (result.items.length === 0) {
        try {
          await client.seedDemoSession(projectId);
          result = await client.listHandoffs(projectId, page.options);
          scoped(result.items, projectId);
        } catch {
          // If seeding unavailable, keep empty list
        }
      }
      return result;
    },
    [client, projectId, page.offset, page.revision],
    Boolean(projectId),
  );
  const items = list.state.status === 'ready' ? list.state.data.items : [];
  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [items],
  );
  const latestId = sortedItems[0]?.id;
  const books = sortedItems.filter((item) =>
    item.summary.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      list.retry();
    }, 2500);
    return () => clearInterval(timer);
  }, [projectId, list]);

  return (
    <section className="session-library" aria-label="Saved session library">
      <header className="library-welcome">
        <div
          className="library-librarian"
          role="img"
          aria-label="Pixel librarian agent carrying a book beside the archive shelves"
        >
          <PixelRoom room="library" />
        </div>
        <div>
          <p className="eyebrow">DECK 01 / THE SESSION ARCHIVE</p>
          <h2>Every session has a story.</h2>
          <p>Pull a book from the shelf. Pick up where you left off.</p>
          <Badge>Librarian · Archive keeper</Badge>
          <small className="library-note">Each book holds a saved project handoff.</small>
        </div>
        <div className="library-actions">
          <Button
            variant="secondary"
            disabled={!projectId || loadingHermes}
            onClick={async () => {
              if (!projectId) return;
              setLoadingHermes(true);
              try {
                await client.seedHermesSessions(projectId);
                await list.retry();
              } finally {
                setLoadingHermes(false);
              }
            }}
          >
            {loadingHermes ? 'Stacking…' : '📚 Stack Hermes Archive'}
          </Button>
          <Button
            variant="primary"
            disabled={!projectId}
            onClick={async () => {
              if (!projectId) return;
              await client.seedDemoSession(projectId);
              await list.retry();
            }}
          >
            ✦ Save New Session Slot
          </Button>
          <Button disabled={!projectId} onClick={list.retry}>
            Refresh shelves
          </Button>
        </div>
      </header>
      <div className="library-catalogue">
        <Field label="Find a book on this page">
          <input
            type="search"
            placeholder="Search saved sessions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!projectId}
          />
        </Field>
        <span>Hover to illuminate · Select a spine to read</span>
      </div>
      {!projectId ? (
        <div className="library-connection" role="status">
          <p>
            Select a project to load its saved sessions. If authentication is required, connect in
            Settings first.
          </p>
          {onConnect && <Button onClick={onConnect}>Connect library</Button>}
        </div>
      ) : (
        <Result value={list}>
          {() =>
            !books.length ? (
              <EmptyState
                title={
                  items.length
                    ? 'No matching books on this page'
                    : 'Your shelf is waiting for its first story'
                }
              >
                {items.length
                  ? 'Try another summary or browse the next shelf.'
                  : 'Save a reviewed session handoff to place your first book here.'}
              </EmptyState>
            ) : null
          }
        </Result>
      )}
      <SessionBookshelf
        books={books}
        onSelect={setSelected}
        latestId={latestId}
        navigation={{
          previous: page.previous,
          next: page.next,
          canPrevious: Boolean(projectId) && page.offset > 0 && list.state.status !== 'loading',
          canNext:
            Boolean(projectId) &&
            list.state.status === 'ready' &&
            items.length === page.options.limit &&
            page.offset < 1000000,
        }}
      />
      {projectId && list.state.status === 'ready' && (
        <div className="library-shelf-footer">
          <small>{items.length} saved handoffs loaded · Newest first</small>
          <small>Archive page {page.offset / page.options.limit + 1}</small>
        </div>
      )}
      {selected && projectId && (
        <HandoffDetail
          client={client}
          projectId={projectId}
          handoffId={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
      {saving && projectId && (
        <CreateHandoff
          client={client}
          projectId={projectId}
          onClose={() => setSaving(false)}
          onSaved={() => {
            setSaving(false);
            page.refresh();
          }}
        />
      )}
    </section>
  );
}
