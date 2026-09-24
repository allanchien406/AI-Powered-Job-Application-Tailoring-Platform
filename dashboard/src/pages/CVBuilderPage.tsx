import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CVViewer } from '../components/CVViewer';
import { Shell } from '../components/Shell';
import { useCVStore, TailoredCVEntry } from '../store/useCVStore';
import { Button, Notice, PanelCard, SectionTitle } from '../components/ui';
import { exportToPDF } from '../utils/exportPDF';
import { generateTailoredCV, getProfile } from '../api/backend';
import { setFieldByPath, removeAtPath } from '../utils/cvEdits';
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

export const CVBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const email = useCVStore((state) => state.email);
  const cvs = useCVStore((state) => state.cvs);
  const viewerCv = useCVStore((state) => state.viewerCv);
  const viewerJobId = useCVStore((state) => state.viewerJobId);
  const viewerTemplateId = useCVStore((state) => state.viewerTemplateId);
  const selectCV = useCVStore((state) => state.selectCV);
  const saveGeneratedCV = useCVStore((state) => state.saveGeneratedCV);
  const setTemplate = useCVStore((state) => state.setTemplate);
  const updateCV = useCVStore((state) => state.updateCV);

  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [paginationReady, setPaginationReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  const handlePages = useCallback((pageCount: number) => {
    setPageCount(pageCount);
    setPaginationReady(true);
  }, []);

  // In-place edits on the preview pages funnel into the same store action as
  // the left panel's textboxes, keeping both sides and localStorage in sync.
  const handleCVEdit = useCallback(
    (path: string, value: string) => {
      if (!viewerJobId) return;
      updateCV(viewerJobId, (draft) => setFieldByPath(draft, path, value));
    },
    [viewerJobId, updateCV],
  );

  const handleCVRemove = useCallback(
    (path: string) => {
      if (!viewerJobId) return;
      updateCV(viewerJobId, (draft) => removeAtPath(draft, path));
    },
    [viewerJobId, updateCV],
  );

  const sorted = [...cvs].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

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

  const handleRegenerate = async () => {
    if (!viewerJobId) return;
    const entry = cvs.find((c) => c.jobId === viewerJobId);
    if (!entry) return;

    setRegenerating(true);
    setRegenerateError(null);
    try {
      const data = await generateTailoredCV(email, viewerJobId);
      const profile = await getProfile(email).catch(() => null);
      saveGeneratedCV(profile, data.generated_cv, viewerJobId, entry.jobRef);
    } catch (e) {
      setRegenerateError(e instanceof Error ? e.message : 'Something went wrong regenerating this CV.');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Shell wide>
      {viewerCv ? (
        <>
          <div className="mb-[18px] flex items-baseline justify-between gap-3">
            <div>
              <h1 className="m-0 font-display text-[28px] text-ink">Tailored CVs</h1>
              <div className="mt-1.5 text-xs text-ink-soft">
                {cvs.length === 1 ? '1 CV generated' : `${cvs.length} CVs generated`} — pick one to
                review and export.
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

          {cvs.length > 1 && (
            <PanelCard>
              <SectionTitle>My tailored CVs</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {sorted.map((entry: TailoredCVEntry) => {
                  const selected = entry.jobId === viewerJobId;
                  return (
                    <button
                      key={entry.jobId}
                      type="button"
                      onClick={() => selectCV(entry.jobId)}
                      className={`w-full rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
                        selected ? 'border-forest bg-forest/[0.06]' : 'border-sand bg-white hover:border-forest/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-medium text-ink">{entry.meta.jobTitle}</div>
                          <div className="mt-0.5 text-xs text-ink-soft">
                            {entry.meta.companyName} · tailored {formatDate(entry.generatedAt)}
                          </div>
                        </div>
                        {selected && <div className="text-[11px] font-medium text-forest">VIEWING</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </PanelCard>
          )}

          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">Template</span>
            {TEMPLATES.map((template) => {
              const selected = template.id === viewerTemplateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => viewerJobId && setTemplate(viewerJobId, template.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    selected ? 'border-forest bg-forest/[0.06] text-forest' : 'border-sand bg-white text-ink-soft hover:border-forest/50'
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