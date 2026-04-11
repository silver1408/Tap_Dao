import { useEffect } from "react";

function ProposalPreviewModal({
  isOpen,
  proposal,
  onClose,
  onSummarize,
  onRefreshSummary,
  summaryState,
  isLoading,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !proposal) return null;

  const hasSummary = Boolean(summaryState?.summary);
  const hasError = Boolean(summaryState?.error);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-preview-title"
      >
        {proposal.imageUrl ? (
          <div className="modal-hero-wrapper">
            <img src={proposal.imageUrl} alt="" className="modal-hero-image" />
          </div>
        ) : null}

        <header className="modal-header">
          <h3 id="proposal-preview-title">{proposal.title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close proposal preview"
          >
            ×
          </button>
        </header>

        <div className="modal-meta">
          <span>{proposal.category}</span>
          <span>{proposal.fundsRequested} tokens</span>
          <span>{proposal.votes} votes</span>
        </div>

        <div className="modal-description">
          <p>{proposal.description || "No detailed description provided."}</p>
        </div>

        {/* <div className="modal-summary-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={onSummarize}
            disabled={isLoading}
          >
            {isLoading ? "Summarizing..." : "Summarize Problem"}
          </button>
          {hasSummary ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={onRefreshSummary}
              disabled={isLoading}
            >
              Refresh
            </button>
          ) : null}
        </div> */}

        {isLoading ? (
          <div className="summary-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>Generating a concise problem summary...</p>
          </div>
        ) : null}

        {hasSummary ? (
          <section className="summary-box">
            <h4>Problem Summary</h4>
            <p>{summaryState.summary}</p>
          </section>
        ) : null}

        {hasError ? (
          <section className="summary-error" role="alert">
            <p>{summaryState.error}</p>
          </section>
        ) : null}
      </section>
    </div>
  );
}

export default ProposalPreviewModal;
