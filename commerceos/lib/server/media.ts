const supportedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

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
    return ascii(bytes, 4, 8) === 'ftyp' && (brand === 'avif' || brand === 'avis');
  }
  return false;
}

export async function validateImageUpload(
  file: File,
  maxBytes: number,
): Promise<boolean> {
  if (!supportedTypes.has(file.type) || file.size <= 0 || file.size > maxBytes) {
    return false;
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return header.length >= 12 && signatureMatches(file.type, header);
}

export function imageExtension(contentType: string): string {
  return contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] || 'bin';
}
