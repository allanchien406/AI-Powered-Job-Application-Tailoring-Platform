import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ModernTemplate } from '../components/ModernTemplate';
import { CVViewer } from '../components/CVViewer';
import { Shell } from '../components/Shell';
import { useCVStore, TailoredCVEntry } from '../store/useCVStore';
import { Button, PanelCard, SectionTitle } from '../components/ui';
import { exportToPDF } from '../utils/exportPDF';

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
  const cvs = useCVStore((state) => state.cvs);
  const viewerCv = useCVStore((state) => state.viewerCv);
  const viewerJobId = useCVStore((state) => state.viewerJobId);
  const selectCV = useCVStore((state) => state.selectCV);

  const [exporting, setExporting] = useState(false);

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
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>

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

          <div className="flex items-start gap-6">
            <CVViewer />
            <div className="flex flex-1 justify-center">
              <div id="cv-preview">
                <ModernTemplate cv={viewerCv} />
              </div>
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