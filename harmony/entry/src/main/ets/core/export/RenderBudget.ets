// Responsibility: pure render budgets and canvas unit conversion for export rasterization.
// No imports (P1 purity): this file must stay runnable by Node type-stripping tests.
// Contract sizes come from CanvasLayout/PdfPages; keep these values in sync (tests assert it).

export const RENDER_MAX_PAGES: number = 200;
export const RENDER_MAX_WIDTH: number = 2520;
export const RENDER_MIN_HEIGHT: number = 1782;
export const RENDER_MAX_HEIGHT: number = 4096;
export const RENDER_BYTES_PER_PIXEL: number = 4;
export const RENDER_MAX_PAGE_BYTES: number = 64 * 1024 * 1024;
export const RENDER_MAX_IMAGE_BYTES: number = 32 * 1024 * 1024;

export const CODE_RENDER_BUDGET: string = 'EXPORT_RENDER_BUDGET_EXCEEDED';
export const CODE_PAGE_INVALID: string = 'EXPORT_PAGE_INVALID';
export const CODE_PAGES_EMPTY: string = 'EXPORT_PAGES_EMPTY';

export interface CanvasSize {
  width: number;
  height: number;
}

// ArkUI component sizes are vp; the backing bitmap is vp * density device pixels.
// vpPerPx is px2vp(1) (vp per physical px). Setting a canvas to pagePx * vpPerPx vp
// and drawing pagePx coordinates under ctx.scale(vpPerPx) yields exactly pagePx pixels.
export function safeVpPerPx(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function canvasSizeInVp(widthPx: number, heightPx: number, vpPerPx: number): CanvasSize {
  const ratio: number = safeVpPerPx(vpPerPx);
  const width: number = Number.isFinite(widthPx) && widthPx > 0 ? widthPx * ratio : 1;
  const height: number = Number.isFinite(heightPx) && heightPx > 0 ? heightPx * ratio : 1;
  return { width: width, height: height };
}

// Returns "" when the page fits, otherwise a stable code for the UI/workflow.
export function pageBudgetCode(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return CODE_PAGE_INVALID;
  }
  const bytes: number = width * height * RENDER_BYTES_PER_PIXEL;
  if (width > RENDER_MAX_WIDTH || height > RENDER_MAX_HEIGHT || bytes > RENDER_MAX_PAGE_BYTES) {
    return CODE_RENDER_BUDGET;
  }
  return '';
}

export function pageCountBudgetCode(count: number): string {
  if (!Number.isInteger(count) || count < 1) {
    return CODE_PAGES_EMPTY;
  }
  if (count > RENDER_MAX_PAGES) {
    return CODE_RENDER_BUDGET;
  }
  return '';
}

export function imageBytesBudgetExceeded(totalBytes: number, nextBytes: number): boolean {
  const total: number = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  const next: number = Number.isFinite(nextBytes) && nextBytes > 0 ? nextBytes : 0;
  return total + next > RENDER_MAX_IMAGE_BYTES;
}

// Device px2vp/vp2px round-trips can miss by 1-2 px. This tolerance only classifies
// rendered-vs-target size; it does not relax page/pixel budgets.
export const RENDER_SIZE_TOLERANCE: number = 2;
export const RENDER_SIZE_RETRY_LIMIT: number = 2;

export const SIZE_VERDICT_OK: string = 'ok';
export const SIZE_VERDICT_TOLERANCE: string = 'tolerance';
export const SIZE_VERDICT_SCALE: string = 'scale';
export const SIZE_VERDICT_REJECT: string = 'reject';

export interface RenderSizeCheck {
  verdict: string;
  deltaWidth: number;
  deltaHeight: number;
}

function absNumber(value: number): number {
  return value < 0 ? -value : value;
}

// Classify rendered bitmap vs target page:
// - ok / tolerance: emit as-is (tolerance logs WARN);
// - scale: correct canvas vp and retry, then emit best-effort scaled/cropped output;
// - reject: only for invalid or catastrophic (>2x / <0.5x) sizes.
export function classifyRenderSize(
  actualWidth: number,
  actualHeight: number,
  targetWidth: number,
  targetHeight: number
): RenderSizeCheck {
  if (!Number.isFinite(actualWidth) || !Number.isFinite(actualHeight) ||
    !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) ||
    actualWidth <= 0 || actualHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { verdict: SIZE_VERDICT_REJECT, deltaWidth: 0, deltaHeight: 0 };
  }
  const deltaWidth: number = actualWidth - targetWidth;
  const deltaHeight: number = actualHeight - targetHeight;
  if (deltaWidth === 0 && deltaHeight === 0) {
    return { verdict: SIZE_VERDICT_OK, deltaWidth: deltaWidth, deltaHeight: deltaHeight };
  }
  if (absNumber(deltaWidth) <= RENDER_SIZE_TOLERANCE && absNumber(deltaHeight) <= RENDER_SIZE_TOLERANCE) {
    return { verdict: SIZE_VERDICT_TOLERANCE, deltaWidth: deltaWidth, deltaHeight: deltaHeight };
  }
  if (actualWidth > targetWidth * 2 || actualHeight > targetHeight * 2 ||
    targetWidth > actualWidth * 2 || targetHeight > actualHeight * 2) {
    return { verdict: SIZE_VERDICT_REJECT, deltaWidth: deltaWidth, deltaHeight: deltaHeight };
  }
  return { verdict: SIZE_VERDICT_SCALE, deltaWidth: deltaWidth, deltaHeight: deltaHeight };
}

// Correct canvas vp by (targetPx - actualPx) * vpPerPx so the next render lands on target.
export function correctedCanvasVp(
  currentWidthVp: number,
  currentHeightVp: number,
  actualWidth: number,
  actualHeight: number,
  targetWidth: number,
  targetHeight: number,
  vpPerPx: number
): CanvasSize {
  const ratio: number = safeVpPerPx(vpPerPx);
  const width: number = currentWidthVp + (targetWidth - actualWidth) * ratio;
  const height: number = currentHeightVp + (targetHeight - actualHeight) * ratio;
  return {
    width: Number.isFinite(width) && width > 0 ? width : currentWidthVp,
    height: Number.isFinite(height) && height > 0 ? height : currentHeightVp
  };
}

export function isExportPageSize(width: number, height: number): boolean {
  return pageBudgetCode(width, height) === '';
}