import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
} from 'docx';
import { saveAs } from 'file-saver';
import { WorkInstruction, getCategoryLabel, getStepImages, getImageCaption } from '@/types/instruction';

function parseDataUrl(dataUrl: string): { buffer: Uint8Array; extension: 'png' | 'jpg' } {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
  if (!match) return { buffer: new Uint8Array(), extension: 'png' };
  const mimeType = match[1];
  const base64 = match[2];
  const extension = mimeType === 'jpeg' || mimeType === 'jpg' ? 'jpg' : 'png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { buffer: bytes, extension };
}

const COLORS = {
  primary: '2563EB',
  primaryLight: 'DBEAFE',
  white: 'FFFFFF',
  dark: '1F2937',
  gray: '6B7280',
  grayLight: 'F3F4F6',
  cautionBg: 'FEF3C7',
  cautionText: 'B45309',
};

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 },
  right: { style: BorderStyle.NONE, size: 0 },
};

function createStepHeaderTable(index: number, title: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 },
      insideHorizontal: { style: BorderStyle.NONE, size: 0 },
      insideVertical: { style: BorderStyle.NONE, size: 0 },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 800, type: WidthType.DXA },
            shading: { type: ShadingType.SOLID, color: COLORS.primary },
            verticalAlign: 'center',
            borders: noBorder,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: String(index + 1),
                    bold: true,
                    size: 28,
                    color: COLORS.white,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            shading: { type: ShadingType.SOLID, color: COLORS.primaryLight },
            verticalAlign: 'center',
            borders: noBorder,
            children: [
              new Paragraph({
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: `  ${title}`,
                    bold: true,
                    size: 24,
                    color: COLORS.dark,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function exportToWord(instruction: WorkInstruction): Promise<void> {
  const sortedSteps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      shading: { type: ShadingType.SOLID, color: COLORS.primary },
      children: [
        new TextRun({
          text: instruction.title,
          bold: true,
          size: 36,
          color: COLORS.white,
          font: 'Arial',
        }),
      ],
    }),
  );

  // Category & date
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      shading: { type: ShadingType.SOLID, color: COLORS.grayLight },
      children: [
        new TextRun({
          text: `カテゴリ: ${getCategoryLabel(instruction.category)}`,
          size: 20,
          color: COLORS.dark,
          font: 'Arial',
        }),
        new TextRun({
          text: `  作成: ${new Date(instruction.createdAt).toLocaleDateString('ja-JP')}  更新: ${new Date(instruction.updatedAt).toLocaleDateString('ja-JP')}`,
          size: 18,
          color: COLORS.gray,
          font: 'Arial',
        }),
      ],
    }),
  );

  // Description
  if (instruction.description) {
    children.push(
      new Paragraph({
        spacing: { before: 100, after: 200 },
        children: [
          new TextRun({
            text: instruction.description,
            size: 21,
            color: COLORS.dark,
            font: 'Arial',
          }),
        ],
      }),
    );
  }

  // Steps
  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];

    // Separator before each step (except first)
    if (i > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 200 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
          },
          children: [],
        }),
      );
    }

    // Step header
    children.push(createStepHeaderTable(i, step.title));

    // Description
    if (step.description) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [
            new TextRun({
              text: step.description,
              size: 21,
              color: COLORS.dark,
              font: 'Arial',
            }),
          ],
        }),
      );
    }

    // Images
    const stepImgs = getStepImages(step);
    for (let imgIdx = 0; imgIdx < stepImgs.length; imgIdx++) {
      const { buffer, extension } = parseDataUrl(stepImgs[imgIdx]);
      if (buffer.length > 0) {
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 40 },
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: buffer,
                transformation: { width: 500, height: 300 },
                type: extension,
              }),
            ],
          }),
        );
        const caption = getImageCaption(step, imgIdx);
        if (caption) {
          children.push(
            new Paragraph({
              spacing: { before: 0, after: 80 },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: caption,
                  size: 18,
                  italics: true,
                  color: COLORS.gray,
                  font: 'Arial',
                }),
              ],
            }),
          );
        }
      }
    }

    // Caution
    if (step.caution) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 80 },
          shading: { type: ShadingType.SOLID, color: COLORS.cautionBg },
          border: {
            left: { style: BorderStyle.SINGLE, size: 6, color: 'F59E0B' },
          },
          children: [
            new TextRun({
              text: `  注意: ${step.caution}`,
              bold: true,
              size: 20,
              color: COLORS.cautionText,
              font: 'Arial',
            }),
          ],
        }),
      );
    }

  }

  // Footer
  children.push(
    new Paragraph({
      spacing: { before: 300 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: `全 ${sortedSteps.length} ステップ`,
          size: 18,
          color: COLORS.gray,
          italics: true,
          font: 'Arial',
        }),
      ],
    }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${instruction.title}_手順書.docx`);
}
