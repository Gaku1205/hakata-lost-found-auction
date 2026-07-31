type PaginationProps = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

export const Pagination = ({ page, totalPages, onChange }: PaginationProps): JSX.Element | null => {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="ページ送り">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        前へ
      </button>
      <div className="pagination__pages">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="chip-filter"
            aria-current={n === page ? 'page' : undefined}
            aria-pressed={n === page}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        次へ
      </button>
    </nav>
  );
};
