// 职责：把渲染好的每页位图（JPEG 字节）拼成「每周一页」的横向 A4 PDF，对齐 web timetable-export.mjs 的二进制写法。
// 依赖方向：零 import（core 纯度门禁）；只做字节拼装，不引 PDF Kit，也不嵌入字体。
// 阶段：P5 导出与备份；位图由 platform/export 用 componentSnapshot + ImagePacker 产出（本文件只吃 JPEG 字节）。
// 待确认：JPEG 必须是 DeviceRGB（DCTDecode 不支持 RGBA）；中文字形全部已栅格化进位图，因此 PDF 不依赖字体。
// 已对齐：横向 A4 精确尺寸 841.89x595.28pt（web/timetable-export.mjs:638-640 同值），内容矩阵随页尺寸缩放；如需纵向可改 PDF_PAGE_WIDTH/HEIGHT 常量。

export const PDF_PAGE_WIDTH: number = 841.89;
export const PDF_PAGE_HEIGHT: number = 595.28;
export const PDF_MAX_PAGES: number = 200;
export const PDF_HEADER_TEXT: string = '%PDF-1.4';

export const CODE_PAGES_EMPTY: string = 'EXPORT_PAGES_EMPTY';
export const CODE_PAGES_TOO_MANY: string = 'EXPORT_PAGES_TOO_MANY';
export const CODE_PAGE_INVALID: string = 'EXPORT_PAGE_INVALID';

export interface PdfPageInput {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

// 工厂函数：ArkTS 要求对象字面量有明确目标类型，跨模块 new 页面输入统一从这里的接口生成。
export function makePdfPageInput(jpeg: Uint8Array, width: number, height: number): PdfPageInput {
  return { jpeg: jpeg, width: width, height: height };
}

export interface PdfValidation {
  ok: boolean;
  code: string;
}

export interface PdfPlan {
  pageCount: number;
  weeks: number[];
  width: number;
  height: number;
}

// 每周一页：整学期 PDF 的页序与周次一一对应，供 UI 显示「共 N 页」。
export function buildSemesterPdfPlan(totalWeeks: number): PdfPlan {
  const total: number = Number.isInteger(totalWeeks) && totalWeeks > 0 ? totalWeeks : 0;
  const weeks: number[] = [];
  for (let week = 1; week <= total; week++) {
    weeks.push(week);
  }
  return { pageCount: weeks.length, weeks, width: PDF_PAGE_WIDTH, height: PDF_PAGE_HEIGHT };
}

export function buildWeekPdfPlan(week: number): PdfPlan {
  const safe: number = Number.isInteger(week) && week > 0 ? week : 1;
  return { pageCount: 1, weeks: [safe], width: PDF_PAGE_WIDTH, height: PDF_PAGE_HEIGHT };
}

export function pdfPagesOverflow(pageCount: number): boolean {
  return !Number.isInteger(pageCount) || pageCount > PDF_MAX_PAGES;
}

export function validatePdfPages(pages: PdfPageInput[]): PdfValidation {
  if (!Array.isArray(pages) || pages.length === 0) {
    return { ok: false, code: CODE_PAGES_EMPTY };
  }
  if (pages.length > PDF_MAX_PAGES) {
    return { ok: false, code: CODE_PAGES_TOO_MANY };
  }
  for (const page of pages) {
    if (!page || !(page.jpeg instanceof Uint8Array) || page.jpeg.length === 0) {
      return { ok: false, code: CODE_PAGE_INVALID };
    }
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width <= 0 || page.height <= 0) {
      return { ok: false, code: CODE_PAGE_INVALID };
    }
  }
  return { ok: true, code: '' };
}

function asciiBytes(text: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function pad10(value: number): string {
  const text: string = String(Math.floor(value));
  return '0000000000'.slice(0, 10 - text.length) + text;
}

class ByteSink {
  private chunks: Uint8Array[] = [];
  private offset: number = 0;

  length(): number {
    return this.offset;
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.offset += bytes.length;
  }

  pushAscii(text: string): void {
    this.push(asciiBytes(text));
  }

  finish(): Uint8Array {
    const out: Uint8Array = new Uint8Array(this.offset);
    let cursor: number = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

// 生成 PDF 字节：每个输入页 = Page 对象 + 内容流 + 一张 DCTDecode 图像对象；尾部带 xref 与 startxref。
export function buildImagePdf(pages: PdfPageInput[]): Uint8Array {
  const check: PdfValidation = validatePdfPages(pages);
  if (!check.ok) {
    throw new Error(check.code);
  }
  const sink: ByteSink = new ByteSink();
  const offsets: number[] = [];
  const totalObjects: number = 2 + pages.length * 3;
  const kids: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    kids.push(String(3 + i * 3) + ' 0 R');
  }
  sink.pushAscii(PDF_HEADER_TEXT + '\n');
  sink.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  offsets.push(sink.length());
  sink.pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets.push(sink.length());
  sink.pushAscii('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + String(pages.length) + ' >>\nendobj\n');

  for (let i = 0; i < pages.length; i++) {
    const page: PdfPageInput = pages[i];
    const pageId: number = 3 + i * 3;
    const contentId: number = pageId + 1;
    const imageId: number = pageId + 2;
    // 内容坐标矩阵与 MediaBox 使用同一组尺寸，保证不出现「只改页尺寸导致内容错位」。
    const content: string = 'q ' + String(PDF_PAGE_WIDTH) + ' 0 0 ' + String(PDF_PAGE_HEIGHT) + ' 0 0 cm /Im0 Do Q\n';
    offsets.push(sink.length());
    sink.pushAscii(pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + String(PDF_PAGE_WIDTH) + ' ' + String(PDF_PAGE_HEIGHT) +
      '] /Resources << /XObject << /Im0 ' + String(imageId) + ' 0 R >> >> /Contents ' + String(contentId) + ' 0 R >>\nendobj\n');
    offsets.push(sink.length());
    sink.pushAscii(contentId + ' 0 obj\n<< /Length ' + String(content.length) + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    offsets.push(sink.length());
    sink.pushAscii(String(imageId) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + String(page.width) +
      ' /Height ' + String(page.height) + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
      String(page.jpeg.length) + ' >>\nstream\n');
    sink.push(page.jpeg);
    sink.pushAscii('\nendstream\nendobj\n');
  }

  const xrefOffset: number = sink.length();
  sink.pushAscii('xref\n0 ' + String(totalObjects + 1) + '\n');
  sink.pushAscii('0000000000 65535 f \n');
  for (const offset of offsets) {
    sink.pushAscii(pad10(offset) + ' 00000 n \n');
  }
  sink.pushAscii('trailer\n<< /Size ' + String(totalObjects + 1) + ' /Root 1 0 R >>\nstartxref\n' + String(xrefOffset) + '\n%%EOF\n');
  return sink.finish();
}
