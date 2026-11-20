const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTextChunk(keyword: string, text: string): Uint8Array {
  const payload = new TextEncoder().encode(`${keyword}\0${text}`);
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
  return chunk;
}

/** 在 PNG 的 IEND 之前写入文本元数据，作为 AI 生成内容的隐式标识 */
export function withAiMetadata(buffer: ArrayBuffer): Blob {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) return new Blob([bytes], { type: 'image/png' });

  const chunks = [
    buildTextChunk('Software', 'CGY Content Workbench'),
    buildTextChunk('Comment', 'AI-assisted draft. Human review required before publishing.')
  ];
  const insertAt = bytes.length - 12;
  const total = bytes.length + chunks.reduce((sum, item) => sum + item.length, 0);

  const output = new Uint8Array(total);
  output.set(bytes.subarray(0, insertAt), 0);
  let offset = insertAt;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  output.set(bytes.subarray(insertAt), offset);

  return new Blob([output], { type: 'image/png' });
}
