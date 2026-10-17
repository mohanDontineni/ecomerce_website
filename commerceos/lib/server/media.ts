const supportedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_HEADER_SCAN_BYTES = 1024 * 1024;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function signatureMatches(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (type === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  }
  if (type === 'image/avif') {
    const brand = ascii(bytes, 8, 12);
    return (
      ascii(bytes, 4, 8) === 'ftyp' && (brand === 'avif' || brand === 'avis')
    );
  }
  return false;
}

function uint24Little(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function imageDimensions(
  type: string,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png' && bytes.length >= 24) {
    if (ascii(bytes, 12, 16) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) return null;
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
        return null;
      }
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + segmentLength;
    }
    return null;
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === 'VP8X') {
      return {
        width: uint24Little(bytes, 24) + 1,
        height: uint24Little(bytes, 27) + 1,
      };
    }
    if (
      chunk === 'VP8 ' &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const packed = view.getUint32(21, true);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
    }
    return null;
  }
  if (type === 'image/avif') {
    for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
      if (ascii(bytes, offset, offset + 4) !== 'ispe') continue;
      return {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
      };
    }
  }
  return null;
}

export async function validateImageUpload(
  file: File,
  maxBytes: number,
): Promise<boolean> {
  if (
    !supportedTypes.has(file.type) ||
    file.size <= 0 ||
    file.size > maxBytes
  ) {
    return false;
  }
  const header = new Uint8Array(
    await file
      .slice(0, Math.min(file.size, MAX_HEADER_SCAN_BYTES))
      .arrayBuffer(),
  );
  if (header.length < 24 || !signatureMatches(file.type, header)) return false;
  const dimensions = imageDimensions(file.type, header);
  if (!dimensions) return false;
  const { width, height } = dimensions;
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

export function imageExtension(contentType: string): string {
  return contentType === 'image/jpeg'
    ? 'jpg'
    : contentType.split('/')[1] || 'bin';
}
