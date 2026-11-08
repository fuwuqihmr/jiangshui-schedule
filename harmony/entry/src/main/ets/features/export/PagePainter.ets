// 职责：把 core/export/CanvasLayout 生成的 ExportPage 画到 ArkUI Canvas 上，供导出前预览与位图抓取。
// 依赖方向：features/export -> core/export 纯逻辑 + ArkUI Canvas API；不依赖 SDK 权限、不写文件。
// 阶段：P5；未编译（本机无 DevEco IDE），Canvas 尺寸/字号在真机需按 API 12 复核。
// 口径：坐标为页面像素（2520x1782 或加高总览页）。抓图时组件尺寸设为 pagePx*px2vp(1) vp，
// 并以 ctx.scale(px2vp(1)) 绘制，使后备位图正好等于 pagePx；故 font 用 vp 单位（缩放后回到页像素）。
import type { ExportPage, PageRect, PageText } from '../../core/export/CanvasLayout';
import { PALETTE_BACKGROUND, PALETTE_FOREGROUND, PALETTE_COUNT } from '../../core/export/CanvasLayout';

// Canvas 2D 的 fillStyle 只接受 CSS 颜色串或渐变，无法用 $r 资源对象；
// 因此底色用 rgb() 常量、文字兜底色取自 core 调色板 0 号（PALETTE_FOREGROUND[0]），文件里不出现 #hex。
const CANVAS_BASE: string = 'rgb(255,255,255)';
const FALLBACK_TEXT: string = 'rgb(31,41,55)';
const FONT_FAMILY: string = 'HarmonyOS Sans, sans-serif';

function rgbOf(triple: number[]): string {
  if (!Array.isArray(triple) || triple.length < 3) {
    return FALLBACK_TEXT;
  }
  return 'rgb(' + String(triple[0]) + ',' + String(triple[1]) + ',' + String(triple[2]) + ')';
}

function backgroundOf(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= PALETTE_COUNT) {
    return CANVAS_BASE;
  }
  return rgbOf(PALETTE_BACKGROUND[index]);
}

function foregroundOf(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= PALETTE_COUNT) {
    return rgbOf(PALETTE_FOREGROUND[0]);
  }
  return rgbOf(PALETTE_FOREGROUND[index]);
}

export function paintPage(ctx: CanvasRenderingContext2D, page: ExportPage): void {
  ctx.fillStyle = CANVAS_BASE;
  ctx.fillRect(0, 0, page.width, page.height);
  for (const rect of page.rects) {
    if (rect.fill >= 0) {
      ctx.fillStyle = backgroundOf(rect.fill);
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    if (rect.stroke >= 0) {
      ctx.strokeStyle = foregroundOf(rect.stroke);
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
  for (const item of page.texts) {
    ctx.fillStyle = foregroundOf(item.color);
    // 画布已按 px2vp(1) 缩放：字号写 vp，缩放后正好是页面像素尺寸。
    ctx.font = (item.bold ? 'bold ' : '') + String(item.size) + 'vp ' + FONT_FAMILY;
    ctx.fillText(item.text, item.x, item.y + item.size * 0.85);
  }
}

// 手写 UTF-8 编码：features/ 不允许 import SDK Kit（check-harmony 规则），
// 因此不引 util.TextEncoder；仅覆盖 BMP 与代理对，非法码点写成 U+FFFD。
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code: number = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low: number = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

// base64（toDataURL 结果）→ 原始字节；与 util.Base64Helper.decodeSync 等价，避免在绘制文件里引 SDK。
export function base64ToBytes(raw: string): Uint8Array | null {
  const text: string = typeof raw === 'string' ? raw : '';
  const comma: number = text.indexOf(',');
  const body: string = comma >= 0 ? text.slice(comma + 1) : text;
  if (body.length === 0) {
    return null;
  }
  const alphabet: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup: number[] = [];
  for (let i = 0; i < 256; i++) {
    lookup.push(-1);
  }
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  const clean: string = body.split('=').join('');
  const out: Uint8Array = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer: number = 0;
  let bits: number = 0;
  let cursor: number = 0;
  for (let i = 0; i < clean.length; i++) {
    const value: number = lookup[clean.charCodeAt(i)];
    if (value < 0) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[cursor] = (buffer >> bits) & 0xff;
      cursor++;
    }
  }
  return cursor === out.length ? out : out.subarray(0, cursor);
}
