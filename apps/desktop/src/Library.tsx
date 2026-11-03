import { useState } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import { Badge, Button, EmptyState, Field, sourceLabel } from '@udi/ui';
import { PixelRoom } from './PixelRoom.js';
import { Result, useResource } from './data.js';
import { CreateHandoff, HandoffDetail, PageControls, scoped, usePage } from './persistence.js';

export function Library({ client, projectId }: { client: DaemonClient; projectId: string }) {
  const page = usePage();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState(false);
  const list = useResource(async () => {
    const result = await client.listHandoffs(projectId, page.options);
    scoped(result.items, projectId);
    return result;
  }, [client, projectId, page.offset, page.revision]);
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
          <p>
            Your librarian keeps the shelves ready. Open a book to revisit a saved handoff, its
            decisions and next steps.
          </p>
          <Badge>Librarian · Archive keeper</Badge>
          <small className="library-note">
            Decorative librarian · Books are persisted project handoffs
          </small>
        </div>
        <div className="library-actions">
          <Button variant="primary" onClick={() => setSaving(true)}>
            Save session handoff
          </Button>
          <Button onClick={list.retry}>Refresh shelves</Button>
        </div>
      </header>
      <div className="library-catalogue">
        <Field label="Find a book on this page">
          <input
            type="search"
            placeholder="Search saved summaries"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <span>Hover to illuminate · Select to read</span>
      </div>
      <Result value={list}>
        {({ items }) => {
          const books = items.filter((item) =>
            item.summary.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          );
          return (
            <>
              <div className="library-shelves" aria-label="Session bookshelves">
                {books.length ? (
                  <div className="library-book-row">
                    {books.map((book) => (
                      <button
                        className="session-book"
                        key={book.id}
                        aria-label={`Read saved session: ${book.summary}`}
                        onClick={() => setSelected(book.id)}
                      >
                        <span className="book-binding" aria-hidden="true" />
                        <span className="book-volume">SESSION / {book.id.slice(0, 8)}</span>
                        <strong>{book.summary}</strong>
                        <span className="book-rule" aria-hidden="true" />
                        <span className="book-date">
                          {new Date(book.createdAt).toLocaleDateString()}
                        </span>
                        <span className="book-provenance">
                          {sourceLabel(book.provenance.sourceKind)}
                        </span>
                        <span className="book-open">Open book ↗</span>
                      </button>
                    ))}
                  </div>
                ) : (
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
                )}
              </div>
              <div className="library-shelf-footer">
                <small>{items.length} saved handoffs loaded · Project-scoped archive</small>
                <PageControls page={page} count={items.length} />
              </div>
            </>
          );
        }}
      </Result>
      {selected && (
        <HandoffDetail
          client={client}
          projectId={projectId}
          handoffId={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
      {saving && (
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
