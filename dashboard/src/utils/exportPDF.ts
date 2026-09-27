import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Export the CV preview to a real multi-page A4 PDF.
 *
 * The preview is already paginated into fixed 210×297mm `.cv-page` frames by
 * `PaginatedCV` (which mirrors exactly what the editor shows), so this just
 * prints each frame onto its own A4 page at full size — nothing is stretched
 * or squashed to fit. If no page frames exist (no template mounted) it falls
 * back to snapshotting the whole container as a single page.
 */
export async function exportToPDF(containerId: string, filename: string): Promise<void> {
  const container = document.getElementById(containerId);
  if (!container) throw new Error('CV preview element not found');

  const pageFrames = Array.from(container.querySelectorAll<HTMLElement>('.cv-page'));
  const sources = pageFrames.length > 0 ? pageFrames : [container];

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < sources.length; i++) {
    const canvas = await html2canvas(sources[i], {
      // 2× = ~190 DPI on A4: crisp on screen and in print, without the
      // tens-of-MB PDFs that 3× multi-page exports produced.
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    const imgData = canvas.toDataURL('image/png');

    if (i > 0) pdf.addPage('a4', 'portrait');
    // Page frames are already A4-shaped, so full-bleed is a 1:1 capture.
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  }

  pdf.save(`${filename || 'cv'}.pdf`);
}