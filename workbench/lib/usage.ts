/**
 * 异常用量监测：不设硬上限，只在“短时高频/单次超长”时提示并轻微降速。
 * 内存实现，多实例部署下各自统计；生产可替换为 Redis 或日志告警。
 */
interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const MAX_INPUT_CHARS = 12_000;

export function isPaused(): boolean {
  return process.env.PAUSED === '1';
}

export function trackUsage(userKey: string, inputChars: number): { slowDown: boolean; notice?: string } {
  const now = Date.now();
  const bucket = buckets.get(userKey) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((stamp) => now - stamp < WINDOW_MS);
  bucket.timestamps.push(now);
  buckets.set(userKey, bucket);

  if (bucket.timestamps.length > MAX_REQUESTS_PER_WINDOW) {
    return {
      slowDown: true,
      notice: '检测到短时间重复提交，已自动放慢速度，避免误操作消耗额度。'
    };
  }

  if (inputChars > MAX_INPUT_CHARS) {
    return {
      slowDown: true,
      notice: '本次资料较长，生成会稍慢一些，请稍候。'
    };
  }

  return { slowDown: false };
}

export function trackLoginAttempt(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(`login:${key}`) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((stamp) => now - stamp < WINDOW_MS);
  bucket.timestamps.push(now);
  buckets.set(`login:${key}`, bucket);
  return bucket.timestamps.length <= 6;
}
