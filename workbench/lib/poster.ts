export type PosterTemplate = 'sky' | 'soil' | 'paper';

export interface PosterData {
  title: string;
  subtitle: string;
  date: string;
  location: string;
  signup: string;
  project: string;
  organizer: string;
  showAiMark: boolean;
}

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1440;

const FONT_FAMILY = '"PingFang SC","Noto Sans SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';
const INK = '#5A2D0C';
const MUTED = '#8F7358';
const CREAM = '#FFFDF6';
const ORANGE = '#FC9B00';
const SKY = '#79D3F2';
const LEAF = '#9BD500';

interface Palette {
  background: string;
  primary: string;
  secondary: string;
  info: string;
  label: string;
  card: string | null;
  qrBackground: string;
  qrBorder: string;
  footer: string;
  brandText: string;
}

const PALETTES: Record<PosterTemplate, Palette> = {
  sky: {
    background: SKY,
    primary: INK,
    secondary: MUTED,
    info: INK,
    label: MUTED,
    card: CREAM,
    qrBackground: '#FFFFFF',
    qrBorder: '#D8C7A6',
    footer: INK,
    brandText: INK
  },
  soil: {
    background: INK,
    primary: '#FFFDF6',
    secondary: '#E8D3B8',
    info: '#FFFDF6',
    label: '#D8BFA0',
    card: null,
    qrBackground: '#FFFDF6',
    qrBorder: '#E8D3B8',
    footer: '#FFFDF6',
    brandText: '#FFFDF6'
  },
  paper: {
    background: '#F6F1E3',
    primary: INK,
    secondary: MUTED,
    info: INK,
    label: MUTED,
    card: null,
    qrBackground: '#FFFFFF',
    qrBorder: '#D8C7A6',
    footer: INK,
    brandText: INK
  }
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    if (char === '\n') {
      lines.push(current);
      current = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const candidate = current + char;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const joined = lines.join('');
    if (joined.length < text.replace(/\n/g, '').length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function fitTitleSize(title: string): number {
  if (title.length <= 12) return 82;
  if (title.length <= 18) return 70;
  if (title.length <= 26) return 60;
  return 52;
}

function drawBrand(ctx: CanvasRenderingContext2D, palette: Palette, y: number) {
  ctx.save();
  ctx.lineWidth = 8;
  ctx.strokeStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(112, y + 18, 32, Math.PI * 0.62, Math.PI * 0.38, false);
  ctx.stroke();

  ctx.strokeStyle = SKY;
  ctx.beginPath();
  ctx.arc(112, y + 18, 20, Math.PI * 0.4, Math.PI * 1.45, false);
  ctx.stroke();

  ctx.fillStyle = LEAF;
  ctx.beginPath();
  ctx.arc(136, y + 4, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.brandText;
  ctx.font = `700 38px ${FONT_FAMILY}`;
  ctx.fillText('C公益', 162, y + 24);
  ctx.font = `400 22px ${FONT_FAMILY}`;
  ctx.globalAlpha = 0.72;
  ctx.fillText('攒劲青年', 162, y + 54);
  ctx.globalAlpha = 1;

  ctx.textAlign = 'right';
  ctx.font = `400 22px ${FONT_FAMILY}`;
  ctx.globalAlpha = 0.65;
  ctx.fillText('向下扎根 · 向上生长', POSTER_WIDTH - 72, y + 26);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, palette: Palette, template: PosterTemplate) {
  ctx.save();
  ctx.font = `600 24px ${FONT_FAMILY}`;
  const width = ctx.measureText(text).width + 44;
  const fill = template === 'paper' ? '#E3F5FC' : template === 'soil' ? ORANGE : '#E3F5FC';
  const color = template === 'soil' ? '#FFFFFF' : INK;
  roundRect(ctx, x, y, width, 52, 26);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 22, y + 35);
  ctx.restore();
}

function drawInfoRow(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  palette: Palette
) {
  ctx.save();
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(x + 7, y + 12, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.label;
  ctx.font = `500 20px ${FONT_FAMILY}`;
  ctx.fillText(label, x + 28, y + 4);

  ctx.fillStyle = palette.info;
  ctx.font = `500 28px ${FONT_FAMILY}`;
  const lines = wrapText(ctx, value || '待补充', maxWidth, 2);
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 28, y + 38 + index * 36);
  });
  ctx.restore();
}

function drawQr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  palette: Palette,
  template: PosterTemplate,
  label: string
) {
  ctx.save();
  roundRect(ctx, x, y, size, size, 18);
  ctx.fillStyle = palette.qrBackground;
  ctx.fill();
  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.qrBorder;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = template === 'soil' ? MUTED : palette.qrBorder;
  ctx.font = `500 22px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('二维码位', x + size / 2, y + size / 2 - 4);
  ctx.font = `400 17px ${FONT_FAMILY}`;
  ctx.fillText(label, x + size / 2, y + size / 2 + 26);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawAiMark(ctx: CanvasRenderingContext2D, palette: Palette, y: number) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = palette.footer;
  ctx.font = `400 18px ${FONT_FAMILY}`;
  ctx.fillText('AI 辅助生成 · 发布前请人工核对', 72, y);
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D, data: PosterData, palette: Palette, y: number) {
  ctx.save();
  ctx.fillStyle = palette.footer;
  ctx.globalAlpha = 0.82;
  ctx.font = `400 24px ${FONT_FAMILY}`;
  const slogan = '向下扎根，向上生长';
  ctx.fillText(slogan, 72, y);
  ctx.textAlign = 'right';
  ctx.fillText(data.organizer || 'C公益', POSTER_WIDTH - 72, y);
  ctx.restore();
}

function drawSky(ctx: CanvasRenderingContext2D, data: PosterData, palette: Palette) {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(980, 120, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(60, 1360, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawBrand(ctx, palette, 72);

  ctx.save();
  roundRect(ctx, 54, 168, 972, 1110, 48);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.restore();

  drawTag(ctx, data.project || 'C公益', 104, 224, palette, 'sky');

  const titleSize = fitTitleSize(data.title);
  ctx.fillStyle = palette.primary;
  ctx.font = `700 ${titleSize}px ${FONT_FAMILY}`;
  const titleLines = wrapText(ctx, data.title || '活动主标题', 800, 3);
  const titleTop = 330;
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 104, titleTop + index * (titleSize + 18));
  });

  const afterTitle = titleTop + titleLines.length * (titleSize + 18) + 8;

  ctx.fillStyle = palette.secondary;
  ctx.font = `400 27px ${FONT_FAMILY}`;
  const subtitleLines = wrapText(ctx, data.subtitle || '', 760, 3);
  subtitleLines.forEach((line, index) => {
    ctx.fillText(line, 104, afterTitle + index * 42);
  });

  ctx.strokeStyle = '#E7DCC5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(104, 952);
  ctx.lineTo(976, 952);
  ctx.stroke();

  drawInfoRow(ctx, '活动时间', data.date, 104, 1000, 560, palette);
  drawInfoRow(ctx, '活动地点', data.location, 104, 1104, 560, palette);
  drawInfoRow(ctx, '报名方式', data.signup, 104, 1208, 560, palette);

  drawQr(ctx, 760, 1030, 196, palette, 'sky', '扫码报名');

  drawFooter(ctx, data, palette, 1350);
  if (data.showAiMark) drawAiMark(ctx, palette, 1396);
}

function drawSoil(ctx: CanvasRenderingContext2D, data: PosterData, palette: Palette) {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.save();
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(1160, -40, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = LEAF;
  ctx.beginPath();
  ctx.arc(80, 1420, 240, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawBrand(ctx, palette, 72);
  drawTag(ctx, data.project || 'C公益', 72, 218, palette, 'soil');

  const titleSize = fitTitleSize(data.title);
  ctx.fillStyle = palette.primary;
  ctx.font = `700 ${titleSize}px ${FONT_FAMILY}`;
  const titleLines = wrapText(ctx, data.title || '活动主标题', 880, 3);
  let cursor = 340;
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 72, cursor + index * (titleSize + 18));
  });
  cursor += titleLines.length * (titleSize + 18) + 10;

  ctx.fillStyle = ORANGE;
  ctx.fillRect(72, cursor, 128, 8);
  cursor += 60;

  ctx.fillStyle = palette.secondary;
  ctx.font = `400 28px ${FONT_FAMILY}`;
  const subtitleLines = wrapText(ctx, data.subtitle || '', 800, 3);
  subtitleLines.forEach((line, index) => {
    ctx.fillText(line, 72, cursor + index * 44);
  });

  const infoTop = 900;
  drawInfoRow(ctx, '活动时间', data.date, 72, infoTop, 560, palette);
  drawInfoRow(ctx, '活动地点', data.location, 72, infoTop + 112, 560, palette);
  drawInfoRow(ctx, '报名方式', data.signup, 72, infoTop + 224, 560, palette);

  drawQr(ctx, 760, 940, 210, palette, 'soil', '扫码报名');

  drawFooter(ctx, data, palette, 1330);
  if (data.showAiMark) drawAiMark(ctx, palette, 1396);
}

function drawPaper(ctx: CanvasRenderingContext2D, data: PosterData, palette: Palette) {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, POSTER_WIDTH, 300);

  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(900, 40, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = LEAF;
  ctx.fillRect(0, 300, POSTER_WIDTH, 14);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 314, 260, 14);

  drawBrand(ctx, { ...palette, brandText: INK }, 58);
  drawTag(ctx, data.project || 'C公益', 72, 356, palette, 'paper');

  const titleSize = fitTitleSize(data.title);
  ctx.fillStyle = palette.primary;
  ctx.font = `700 ${titleSize}px ${FONT_FAMILY}`;
  const titleLines = wrapText(ctx, data.title || '活动主标题', 900, 3);
  const titleTop = 460;
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 72, titleTop + index * (titleSize + 16));
  });

  const afterTitle = titleTop + titleLines.length * (titleSize + 16) + 6;
  ctx.fillStyle = palette.secondary;
  ctx.font = `400 27px ${FONT_FAMILY}`;
  const subtitleLines = wrapText(ctx, data.subtitle || '', 820, 3);
  subtitleLines.forEach((line, index) => {
    ctx.fillText(line, 72, afterTitle + index * 42);
  });

  ctx.strokeStyle = '#E7DCC5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 940);
  ctx.lineTo(1008, 940);
  ctx.stroke();

  drawInfoRow(ctx, '活动时间', data.date, 72, 990, 560, palette);
  drawInfoRow(ctx, '活动地点', data.location, 72, 1094, 560, palette);
  drawInfoRow(ctx, '报名方式', data.signup, 72, 1198, 560, palette);

  drawQr(ctx, 780, 1000, 196, palette, 'paper', '扫码报名');

  drawFooter(ctx, data, palette, 1350);
  if (data.showAiMark) drawAiMark(ctx, palette, 1396);
}

export function drawPoster(
  canvas: HTMLCanvasElement,
  template: PosterTemplate,
  data: PosterData
): void {
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  ctx.textBaseline = 'alphabetic';
  const palette = PALETTES[template];

  if (template === 'soil') drawSoil(ctx, data, palette);
  else if (template === 'paper') drawPaper(ctx, data, palette);
  else drawSky(ctx, data, palette);
}
