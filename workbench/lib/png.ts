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
export interface AiImageMeta {
  activityId?: string;
  taskId?: string;
  outputId?: string;
  model?: string;
}

/**
 * 简化实现：用 tEXt 块写入 ASCII 元数据。
 * 审核通过只免“显式”标注，这里写入的隐式标识与生成时间始终保留。
 */
export function withAiMetadata(buffer: ArrayBuffer, meta: AiImageMeta = {}): Blob {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) return new Blob([bytes], { type: 'image/png' });

  const entries: Array<[string, string]> = [
    ['Software', 'CGY Content Workbench'],
    ['Comment', 'AI-assisted draft. Human review required before publishing.'],
    ['DigitalSourceType', 'trainedAlgorithmicMedia'],
    ['AIGeneratedAt', new Date().toISOString()]
  ];
  if (meta.outputId) entries.push(['AIContentID', meta.outputId]);
  if (meta.activityId) entries.push(['AIActivityID', meta.activityId]);
  if (meta.taskId) entries.push(['AITaskID', meta.taskId]);
  if (meta.model) entries.push(['AIModel', meta.model]);

  const chunks = entries.map(([keyword, text]) => buildTextChunk(keyword, text));
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
