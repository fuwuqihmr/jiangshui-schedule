// Responsibility: read pixel dimensions from encoded PNG/JPEG bytes without SDK imports.
// Used to fail export rendering if Canvas backing-buffer size differs from the contract page size.

export interface EncodedImageSize {
  width: number;
  height: number;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0xff) << 24) | ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) | (bytes[offset + 3] & 0xff);
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

export function pngSizeOf(bytes: Uint8Array): EncodedImageSize | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) {
    return null;
  }
  const signature: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return null;
    }
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const width: number = u32be(bytes, 16);
  const height: number = u32be(bytes, 20);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width: width, height: height };
}

function isSofMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

export function jpegSizeOf(bytes: Uint8Array): EncodedImageSize | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset: number = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker: number = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length: number = u16be(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      return null;
    }
    if (isSofMarker(marker)) {
      if (offset + 9 > bytes.length) {
        return null;
      }
      const height: number = u16be(bytes, offset + 5);
      const width: number = u16be(bytes, offset + 7);
      if (width <= 0 || height <= 0) {
        return null;
      }
      return { width: width, height: height };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageSizeOf(bytes: Uint8Array, mime: string): EncodedImageSize | null {
  const type: string = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (type.indexOf('png') >= 0) {
    return pngSizeOf(bytes);
  }
  if (type.indexOf('jpeg') >= 0 || type.indexOf('jpg') >= 0) {
    return jpegSizeOf(bytes);
  }
  return null;
}