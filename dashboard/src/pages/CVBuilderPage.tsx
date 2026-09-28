import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CVViewer } from '../components/CVViewer';
import { Shell } from '../components/Shell';
import { useCVStore, TailoredCVEntry, CVSyncState } from '../store/useCVStore';
import { Button, Notice, PanelCard, SectionTitle } from '../components/ui';
import { exportToPDF } from '../utils/exportPDF';
import { generateTailoredCV, getProfile } from '../api/backend';
import { setFieldByPath, removeAtPath } from '../utils/cvEdits';
import { generatedCvToCVData } from '../utils/cv';
import { TEMPLATES } from '../components/templates';
import { PaginatedCV } from '../components/PaginatedCV';

const formatDate = (iso: string) => {
  if (!iso) return 'earlier session';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

/** Autosave status for the CV that's open. Silent by design — the user is
 * never asked to press Save — but failure has to be visible, so every state
 * except the happy path says something. */
const SyncChip: React.FC<{ state: CVSyncState | undefined }> = ({ state }) => {
  if (state === 'saving') return <span className="text-[11px] text-ink-muted">Saving…</span>;
  if (state === 'error')
    return (
      <span className="text-[11px] text-note-error-text">
        Couldn&rsquo;t save — retrying. Your edits are safe on this device.
      </span>
    );
  if (state === 'dirty') return <span className="text-[11px] text-ink-muted">Unsaved changes…</span>;
  return <span className="text-[11px] text-forest">Saved to your account</span>;
};

export const CVBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const cvs = useCVStore((state) => state.cvs);
  const viewerCv = useCVStore((state) => state.viewerCv);
  const viewerCvId = useCVStore((state) => state.viewerCvId);
  const viewerTemplateId = useCVStore((state) => state.viewerTemplateId);
  const selectCV = useCVStore((state) => state.selectCV);
  const saveGeneratedCV = useCVStore((state) => state.saveGeneratedCV);
  const setTemplate = useCVStore((state) => state.setTemplate);
  const updateCV = useCVStore((state) => state.updateCV);
  const deleteCV = useCVStore((state) => state.deleteCV);

  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [paginationReady, setPaginationReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  const viewerEntry = cvs.find((c) => c.cvId === viewerCvId);

  const handlePages = useCallback((pageCount: number) => {
    setPageCount(pageCount);
    setPaginationReady(true);
  }, []);

  // In-place edits on the preview pages funnel into the same store action as
  // the left panel's textboxes, keeping both panels, localStorage, and the
  // backend autosave in sync.
  const handleCVEdit = useCallback(
    (path: string, value: string) => {
      if (!viewerCvId) return;
      updateCV(viewerCvId, (draft) => setFieldByPath(draft, path, value));
    },
    [viewerCvId, updateCV],
  );

  const handleCVRemove = useCallback(
    (path: string) => {
      if (!viewerCvId) return;
      updateCV(viewerCvId, (draft) => removeAtPath(draft, path));
    },
    [viewerCvId, updateCV],
  );

  // Newest first, and grouped by job so two attempts at the same posting sit
  // next to each other — that's the comparison having several CVs per job is
  // actually for.
  const sorted = [...cvs].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const groups = sorted.reduce<{ jobId: string | null; entries: TailoredCVEntry[] }[]>((acc, entry) => {
    const key = entry.jobId ?? '';
    const last = acc[acc.length - 1];
    if (last && (last.jobId ?? '') === key) last.entries.push(entry);
    else acc.push({ jobId: entry.jobId, entries: [entry] });
    return acc;
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportToPDF('cv-preview', 'tailored-cv');
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setExporting(false);
    }
  };

  // Regenerate replaces the open CV's content in place, keeping the same
  // cv_id. Forking a new CV on every click would leave three near-identical
  // copies after three clicks; new versions come from "Generate another
  // version" on the jobs page instead.
  const handleRegenerate = async () => {
    if (!viewerEntry) return;
    if (!viewerEntry.jobId) {
      setRegenerateError("This CV isn't tied to a saved job, so it can't be regenerated.");
      return;
    }

    setRegenerating(true);
    setRegenerateError(null);
    try {
      const data = await generateTailoredCV(viewerEntry.jobId);
      const profile = await getProfile().catch(() => null);
      updateCV(viewerEntry.cvId, (draft) => {
        Object.assign(draft, generatedCvToCVData(data.generated_cv, profile));
      }, true);
    } catch (e) {
      setRegenerateError(e instanceof Error ? e.message : 'Something went wrong regenerating this CV.');
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async (cvId: string) => {
    setDeleteError(null);
    setDeletingId(cvId);
    try {
      await deleteCV(cvId);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Something went wrong deleting that CV.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Shell wide>
      {viewerCv ? (
        <>
          <div className="mb-[18px] flex items-baseline justify-between gap-3">
            <div>
              <h1 className="m-0 font-display text-[28px] text-ink">Tailored CVs</h1>
              <div className="mt-1.5 flex items-baseline gap-2.5 text-xs text-ink-soft">
                <span>
                  {cvs.length === 1 ? '1 CV generated' : `${cvs.length} CVs generated`} — pick one
                  to review and export.
                </span>
                <SyncChip state={viewerEntry?.syncState} />
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={handleRegenerate} disabled={regenerating || exporting}>
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
              <Button onClick={handleExport} disabled={exporting || regenerating || !paginationReady}>
                {exporting ? 'Exporting…' : 'Export PDF'}
              </Button>
            </div>
          </div>

          {regenerateError && <Notice tone="error">{regenerateError}</Notice>}
          {deleteError && <Notice tone="error">{deleteError}</Notice>}

          {cvs.length > 1 && (
            <PanelCard>
              <SectionTitle>My tailored CVs</SectionTitle>
              <div className="flex flex-col gap-3">
                {groups.map((group) => (
                  <div key={group.jobId ?? 'unattributed'} className="flex flex-col gap-1.5">
                    {groups.length > 1 && (
                      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                        {group.entries[0]?.meta.companyName || 'Unattributed'}
                        {group.entries.length > 1 && (
                          <span className="ml-1.5 normal-case tracking-normal">
                            {group.entries.length} versions
                          </span>
                        )}
                      </div>
                    )}
                    {group.entries.map((entry) => {
                      const selected = entry.cvId === viewerCvId;
                      return (
                        <div
                          key={entry.cvId}
                          className={`flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 transition-colors ${
                            selected
                              ? 'border-forest bg-forest/[0.06]'
                              : 'border-sand bg-white hover:border-forest/50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => selectCV(entry.cvId)}
                            className="min-w-0 flex-1 cursor-pointer text-left"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[13px] font-medium text-ink">
                                {entry.meta.jobTitle || 'Untitled CV'}
                              </div>
                              {selected && <div className="text-[11px] font-medium text-forest">VIEWING</div>}
                            </div>
                            <div className="mt-0.5 text-xs text-ink-soft">
                              {entry.meta.companyName || '—'} · tailored{' '}
                              {formatDate(entry.generatedAt)} · edited {formatDate(entry.updatedAt)}
                            </div>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete the CV for ${entry.meta.jobTitle || 'this job'}`}
                            disabled={deletingId === entry.cvId}
                            onClick={() => handleDelete(entry.cvId)}
                            className="shrink-0 cursor-pointer rounded-md border border-sand-dark px-2 py-1 text-[11px] text-ink-muted transition-colors hover:border-note-error-border hover:text-note-error-text disabled:opacity-50"
                          >
                            {deletingId === entry.cvId ? '…' : 'Delete'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </PanelCard>
          )}
          {cvs.length === 1 && (
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                disabled={deletingId === viewerCvId}
                onClick={() => viewerCvId && handleDelete(viewerCvId)}
                className="cursor-pointer rounded-md border border-sand-dark px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-note-error-border hover:text-note-error-text disabled:opacity-50"
              >
                Delete this CV
              </button>
            </div>
          )}

          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">Template</span>
            {TEMPLATES.map((template) => {
              const selected = template.id === viewerTemplateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => viewerCvId && setTemplate(viewerCvId, template.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    selected
                      ? 'border-forest bg-forest/[0.06] text-forest'
                      : 'border-sand bg-white text-ink-soft hover:border-forest/50'
                  }`}
                >
                  {template.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-start gap-6">
            <CVViewer />
            <div className="flex flex-1 flex-col">
              <div id="cv-preview">
                <PaginatedCV
                  cv={viewerCv}
                  templateId={viewerTemplateId}
                  onPages={handlePages}
                  onEdit={handleCVEdit}
                  onRemove={handleCVRemove}
                />
              </div>
              {paginationReady && (
                <div className="mt-2 text-center text-[11px] text-ink-muted">
                  {pageCount > 1
                    ? `Spans ${pageCount} A4 pages — content after the first page continues below`
                    : 'Fits on a single A4 page'}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-[65vh] items-center justify-center">
          <div className="rounded-2xl border border-sand bg-white p-12 text-center shadow-card">
            <div className="mb-2 font-display text-[22px] text-ink">No tailored CV yet</div>
            <p className="mb-4 text-[13px] text-ink-soft">
              Generate a tailored CV from a saved job description, then it will show up here for
              review and export.
            </p>
            <Button onClick={() => navigate('/jobs')}>Go to my jobs</Button>
          </div>
        </div>
      )}
    </Shell>
  );
};
