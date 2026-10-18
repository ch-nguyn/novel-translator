const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// STORE keeps the first EPUB mimetype entry uncompressed, without extra fields.
export function zipFiles(files: { name: string; data: string | Uint8Array }[]): Blob {
  if (files.length >= 0xffff) throw new RangeError("Too many ZIP entries");
  const entries = files.map((file) => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    if (name.length > 0xffff || data.length >= 0xffffffff) throw new RangeError("ZIP entry is too large");
    return { name, data, crc: crc32(data) };
  });
  const directoryOffset = entries.reduce((size, file) => size + 30 + file.name.length + file.data.length, 0);
  const directorySize = entries.reduce((size, file) => size + 46 + file.name.length, 0);
  const size = directoryOffset + directorySize + 22;
  // This small writer does not emit ZIP64 headers.
  if (size >= 0xffffffff) throw new RangeError("ZIP archive is too large");
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let central = directoryOffset;
  for (const file of entries) {
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 12, 0x0021, true); // January 1, 1980
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.name.length, true);
    bytes.set(file.name, offset + 30);
    bytes.set(file.data, offset + 30 + file.name.length);

    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true);
    view.setUint16(central + 8, 0x0800, true);
    view.setUint16(central + 14, 0x0021, true);
    view.setUint32(central + 16, file.crc, true);
    view.setUint32(central + 20, file.data.length, true);
    view.setUint32(central + 24, file.data.length, true);
    view.setUint16(central + 28, file.name.length, true);
    view.setUint32(central + 42, offset, true);
    bytes.set(file.name, central + 46);
    offset += 30 + file.name.length + file.data.length;
    central += 46 + file.name.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, entries.length, true);
  view.setUint16(central + 10, entries.length, true);
  view.setUint32(central + 12, directorySize, true);
  view.setUint32(central + 16, directoryOffset, true);
  return new Blob([bytes.buffer], { type: "application/zip" });
}
