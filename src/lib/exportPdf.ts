import type jsPDF from 'jspdf';
import { WorkInstruction, getCategoryLabel, getStepImages, getImageCaption } from '@/types/instruction';

export async function exportToPdf(instruction: WorkInstruction): Promise<void> {
  try {
    const pdf = await buildPdf(instruction);
    pdf.save(`${instruction.title}.pdf`);
  } catch (err) {
    console.error('exportToPdf failed:', err);
    throw err;
  }
}

export async function buildPdfBuffer(instruction: WorkInstruction): Promise<ArrayBuffer> {
  const pdf = await buildPdf(instruction);
  return pdf.output('arraybuffer');
}

function setStyle(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, styles);
}

function createEl(tag: string, styles: Partial<CSSStyleDeclaration>, parent: HTMLElement): HTMLElement {
  const el = document.createElement(tag);
  setStyle(el, styles);
  parent.appendChild(el);
  return el;
}

function buildHtmlElement(instruction: WorkInstruction): HTMLDivElement {
  const container = document.createElement('div');
  setStyle(container, {
    position: 'absolute',
    left: '-9999px',
    top: '0',
    width: '794px',
    background: '#FFFFFF',
    fontFamily: 'Arial, sans-serif',
    color: '#1F2937',
    lineHeight: '1.6',
    fontSize: '13px',
  });

  // Title banner
  const titleBanner = createEl('div', {
    background: 'linear-gradient(135deg, #1E40AF, #2563EB, #3B82F6)',
    padding: '28px 40px',
    textAlign: 'center',
  }, container);
  const titleText = createEl('div', {
    color: '#FFFFFF',
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '1px',
  }, titleBanner);
  titleText.textContent = instruction.title;
  const titleSub = createEl('div', {
    color: 'rgba(255,255,255,0.8)',
    fontSize: '12px',
    marginTop: '6px',
    letterSpacing: '0.5px',
  }, titleBanner);
  titleSub.textContent = '作業手順書';

  // Meta bar
  const metaBar = createEl('div', {
    background: '#F8FAFC',
    padding: '10px 40px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    color: '#6B7280',
    borderBottom: '1px solid #E5E7EB',
  }, container);

  const categoryColors: Record<string, { bg: string; text: string }> = {
    pc_work: { bg: '#DBEAFE', text: '#1D4ED8' },
    packing: { bg: '#FFEDD5', text: '#C2410C' },
  };
  const catColor = categoryColors[instruction.category] || categoryColors.pc_work;
  const badge = createEl('span', {
    background: catColor.bg,
    color: catColor.text,
    padding: '3px 12px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
  }, metaBar);
  badge.textContent = getCategoryLabel(instruction.category);

  const dateInfo = createEl('span', {
    color: '#9CA3AF',
    fontSize: '10px',
  }, metaBar);
  dateInfo.textContent = `作成: ${new Date(instruction.createdAt).toLocaleDateString('ja-JP')}  |  更新: ${new Date(instruction.updatedAt).toLocaleDateString('ja-JP')}`;

  // Description
  if (instruction.description) {
    const descSection = createEl('div', {
      padding: '16px 40px',
      borderBottom: '1px solid #F3F4F6',
    }, container);
    const descText = createEl('div', {
      fontSize: '13px',
      color: '#374151',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: '1.7',
    }, descSection);
    descText.textContent = instruction.description;
  }

  // Steps
  const sortedSteps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const stepsContainer = createEl('div', {
    padding: '8px 0 20px 0',
  }, container);

  for (const step of sortedSteps) {
    const stepCard = createEl('div', {
      margin: '12px 32px',
      border: '1px solid #E5E7EB',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }, stepsContainer);

    // Step header
    const stepHeader = createEl('div', {
      background: '#EFF6FF',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      borderBottom: '2px solid #BFDBFE',
    }, stepCard);

    const numberBadge = createEl('div', {
      width: '32px',
      height: '32px',
      minWidth: '32px',
      background: '#2563EB',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#FFFFFF',
      fontSize: '14px',
      fontWeight: 'bold',
    }, stepHeader);
    numberBadge.textContent = String(step.orderIndex + 1);

    const stepTitle = createEl('div', {
      fontSize: '16px',
      fontWeight: 'bold',
      color: '#1E3A5F',
    }, stepHeader);
    stepTitle.textContent = step.title;

    // Step body
    const stepBody = createEl('div', {
      padding: '16px',
    }, stepCard);

    // Step description
    if (step.description) {
      const stepDesc = createEl('div', {
        fontSize: '13px',
        color: '#374151',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: '1.7',
        marginBottom: '12px',
      }, stepBody);
      stepDesc.textContent = step.description;
    }

    // Images
    const stepImages = getStepImages(step);
    for (let imgIdx = 0; imgIdx < stepImages.length; imgIdx++) {
      const imgWrapper = createEl('div', {
        textAlign: 'center',
        marginBottom: '12px',
        padding: '8px',
        background: '#F9FAFB',
        borderRadius: '6px',
        border: '1px solid #F3F4F6',
      }, stepBody);
      const img = document.createElement('img');
      img.src = stepImages[imgIdx];
      setStyle(img, {
        maxWidth: '100%',
        height: 'auto',
        borderRadius: '4px',
        display: 'block',
        margin: '0 auto',
      });
      imgWrapper.appendChild(img);
      const caption = getImageCaption(step, imgIdx);
      if (caption) {
        const captionEl = createEl('div', {
          fontSize: '11px',
          color: '#6B7280',
          marginTop: '6px',
          textAlign: 'center',
        }, imgWrapper);
        captionEl.textContent = caption;
      }
    }

    // Caution
    if (step.caution) {
      const cautionBox = createEl('div', {
        background: '#FEF3C7',
        borderLeft: '4px solid #F59E0B',
        borderRadius: '0 6px 6px 0',
        padding: '10px 14px',
        marginBottom: '12px',
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
      }, stepBody);
      const cautionIcon = createEl('span', {
        fontSize: '14px',
        lineHeight: '1.5',
      }, cautionBox);
      cautionIcon.textContent = '\u26A0';
      const cautionContent = createEl('div', {}, cautionBox);
      const cautionLabel = createEl('div', {
        fontSize: '11px',
        fontWeight: 'bold',
        color: '#92400E',
        marginBottom: '2px',
      }, cautionContent);
      cautionLabel.textContent = '\u6CE8\u610F';
      const cautionText = createEl('div', {
        fontSize: '12px',
        color: '#B45309',
        lineHeight: '1.5',
        wordBreak: 'break-word',
      }, cautionContent);
      cautionText.textContent = step.caution;
    }

  }

  // Footer
  const footer = createEl('div', {
    padding: '12px 40px 20px',
    textAlign: 'right',
    fontSize: '11px',
    color: '#9CA3AF',
    borderTop: '1px solid #F3F4F6',
  }, container);
  footer.textContent = `\u5168 ${sortedSteps.length} \u30B9\u30C6\u30C3\u30D7`;

  return container;
}

async function buildPdf(instruction: WorkInstruction): Promise<jsPDF> {
  // Render inside an iframe to isolate from Tailwind CSS v4's lab()/oklch() colors
  // which html2canvas cannot parse
  const iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '794px';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) throw new Error('Failed to create iframe document');

    iframeDoc.open();
    iframeDoc.write('<!DOCTYPE html><html><head></head><body style="margin:0;padding:0;"></body></html>');
    iframeDoc.close();

    const container = buildHtmlElement(instruction);
    container.style.position = 'static';
    container.style.left = '';
    iframeDoc.body.appendChild(container);

    // Wait for images to load
    const images = container.querySelectorAll('img');
    await Promise.all(
      Array.from(images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          })
      )
    );

    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#FFFFFF',
      logging: false,
    });

    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.95);

    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const imgHeight = (canvas.height / canvas.width) * imgWidth;
    const pageHeight = 297;

    let position = 0;
    let pageIndex = 0;

    while (position < imgHeight) {
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(
        imgDataUrl,
        'JPEG',
        0,
        -position,
        imgWidth,
        imgHeight
      );
      position += pageHeight;
      pageIndex++;
    }

    return pdf;
  } finally {
    iframe.remove();
  }
}
