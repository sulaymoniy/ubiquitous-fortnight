import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, FileText } from 'lucide-react';
import { workspaceApi } from '../api/workspace';
import { useWorkspace } from './WorkspaceProvider';
export function SearchPalette() {
  const { searchOpen, closeSearch, navigate } = useWorkspace();
  return searchOpen ? <SearchDialog close={closeSearch} navigate={navigate} /> : null;
}
function SearchDialog({
  close,
  navigate,
}: {
  close: () => void;
  navigate: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [debounced, setDebounced] = useState(''),
    [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
      setIndex(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);
  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => workspaceApi.search(debounced, signal),
    enabled: !!debounced,
  });
  const results = search.data?.results.filter((result) => result.kind === 'page') ?? [];
  async function open(id: string) {
    await navigate(id);
    close();
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex(
              (i) =>
                (i + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(results.length, 1)) %
                Math.max(results.length, 1),
            );
          }
          if (event.key === 'Enter' && results[index]) {
            event.preventDefault();
            void open(results[index]!.pageId);
          }
          if (event.key === 'Escape') close();
          if (event.key === 'Tab') {
            const elements = dialog.current?.querySelectorAll<HTMLElement>('button, input');
            const first = elements?.[0],
              last = elements?.[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="search-input">
          <Search size={20} />
          <input
            aria-label="Search pages"
            autoFocus
            maxLength={200}
            placeholder="Search your pages and ideas…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-button" aria-label="Close search" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="search-results" role="listbox" aria-label="Search results">
          {!debounced ? (
            <p className="search-empty">Find a note, a page, or a thought you saved.</p>
          ) : search.isPending || search.isFetching ? (
            <p className="search-empty" role="status">
              Searching…
            </p>
          ) : search.isError ? (
            <div className="search-empty" role="alert">
              Search is unavailable.{' '}
              <button onClick={() => void search.refetch()}>Try again</button>
            </div>
          ) : !results.length ? (
            <p className="search-empty">No pages found. Try another word.</p>
          ) : (
            results.map((result, i) => (
              <button
                key={result.id}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'highlighted' : ''}
                onClick={() => void open(result.pageId)}
              >
                <FileText size={17} />
                <span>
                  <strong>{result.title || 'Untitled'}</strong>
                  <small>{result.snippet}</small>
                </span>
              </button>
            ))
          )}
        </div>
        <footer>↑ ↓ to navigate · Enter to open · Esc to close</footer>
      </div>
    </div>
  );
}
