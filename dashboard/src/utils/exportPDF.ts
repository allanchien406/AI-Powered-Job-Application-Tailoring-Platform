import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export async function exportToPDF(elementId: string, filename: string): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) throw new Error('CV preview element not found');

  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');

  // A4 dimensions in mm
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${filename || 'cv'}.pdf`);
}