// 职责：手写 UTF-8 编解码纯逻辑。
// 背景：门禁只允许平台层 import @ohos/@kit 且白名单不含 @ohos.util / @kit.ArkTS，
//       因此文本解码不能用系统 TextDecoder，必须由 core 自带。
// 行为：剥离 UTF-8 BOM；非法/截断序列替换为 U+FFFD 并前进一个字节；支持 1-4 字节与代理对。

const REPLACEMENT_CODE_POINT: number = 0xFFFD;

function appendCodePoint(chunks: string[], codePoint: number): void {
  if (codePoint <= 0xFFFF) {
    chunks.push(String.fromCharCode(codePoint));
    return;
  }
  const value: number = codePoint - 0x10000;
  chunks.push(String.fromCharCode(0xD800 + (value >> 10)));
  chunks.push(String.fromCharCode(0xDC00 + (value & 0x3FF)));
}

function isContinuation(value: number): boolean {
  return value >= 0x80 && value <= 0xBF;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return index < bytes.length ? bytes[index] : -1;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (bytes === null || bytes === undefined || bytes.length === 0) {
    return '';
  }
  let start: number = 0;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    start = 3;
  }
  const chunks: string[] = [];
  let i: number = start;
  while (i < bytes.length) {
    const b0: number = bytes[i];
    if (b0 < 0x80) {
      chunks.push(String.fromCharCode(b0));
      i += 1;
      continue;
    }
    if (b0 >= 0xC2 && b0 <= 0xDF) {
      const b1: number = byteAt(bytes, i + 1);
      if (isContinuation(b1)) {
        appendCodePoint(chunks, ((b0 & 0x1F) << 6) | (b1 & 0x3F));
        i += 2;
        continue;
      }
      chunks.push(String.fromCharCode(REPLACEMENT_CODE_POINT));
      i += 1;
      continue;
    }
    if (b0 >= 0xE0 && b0 <= 0xEF) {
      const b1: number = byteAt(bytes, i + 1);
      const b2: number = byteAt(bytes, i + 2);
      const validFirst: boolean = (b0 === 0xE0) ? (b1 >= 0xA0 && b1 <= 0xBF) :
        (b0 === 0xED) ? (b1 >= 0x80 && b1 <= 0x9F) : isContinuation(b1);
      if (validFirst && isContinuation(b2)) {
        appendCodePoint(chunks, ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
        i += 3;
        continue;
      }
      chunks.push(String.fromCharCode(REPLACEMENT_CODE_POINT));
      i += 1;
      continue;
    }
    if (b0 >= 0xF0 && b0 <= 0xF4) {
      const b1: number = byteAt(bytes, i + 1);
      const b2: number = byteAt(bytes, i + 2);
      const b3: number = byteAt(bytes, i + 3);
      const validFirst: boolean = (b0 === 0xF0) ? (b1 >= 0x90 && b1 <= 0xBF) :
        (b0 === 0xF4) ? (b1 >= 0x80 && b1 <= 0x8F) : isContinuation(b1);
      if (validFirst && isContinuation(b2) && isContinuation(b3)) {
        const codePoint: number = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) |
          ((b2 & 0x3F) << 6) | (b3 & 0x3F);
        if (codePoint >= 0x10000 && codePoint <= 0x10FFFF) {
          appendCodePoint(chunks, codePoint);
          i += 4;
          continue;
        }
      }
      chunks.push(String.fromCharCode(REPLACEMENT_CODE_POINT));
      i += 1;
      continue;
    }
    chunks.push(String.fromCharCode(REPLACEMENT_CODE_POINT));
    i += 1;
  }
  return chunks.join('');
}

export function utf8ByteLength(text: string): number {
  const input: string = text === null || text === undefined ? '' : text;
  let total: number = 0;
  for (let i = 0; i < input.length; i++) {
    const code: number = input.charCodeAt(i);
    if (code < 0x80) {
      total += 1;
    } else if (code < 0x800) {
      total += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < input.length) {
      const next: number = input.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        total += 4;
        i += 1;
      } else {
        total += 3;
      }
    } else {
      total += 3;
    }
  }
  return total;
}
