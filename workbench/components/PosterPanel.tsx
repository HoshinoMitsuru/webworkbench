'use client';

import { useEffect, useRef, useState } from 'react';
import { drawPoster, POSTER_HEIGHT, POSTER_WIDTH, type PosterTemplate } from '@/lib/poster';
import { withAiMetadata } from '@/lib/png';
import type { ActivityInput } from '@/lib/types';

interface Props {
  activity: ActivityInput;
  template: PosterTemplate;
  onTemplateChange: (template: PosterTemplate) => void;
  showAiMark: boolean;
  onShowAiMarkChange: (value: boolean) => void;
}

const TEMPLATES: Array<{ key: PosterTemplate; label: string; hint: string }> = [
  { key: 'sky', label: '天空版', hint: '品牌蓝底 + 奶油卡片' },
  { key: 'soil', label: '土壤版', hint: '深棕底 + 橙色强调' },
  { key: 'paper', label: '纸张版', hint: '米色底 + 蓝色标题带' }
];

export default function PosterPanel({
  activity,
  template,
  onTemplateChange,
  showAiMark,
  onShowAiMarkChange
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPoster(canvas, template, {
      title: activity.name,
      subtitle: activity.highlights || activity.audience,
      date: activity.date,
      location: activity.location,
      signup: activity.signup,
      project: activity.project,
      organizer: activity.organizer,
      showAiMark
    });
  }, [activity, template, showAiMark]);

  async function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('导出失败');
      const withMeta = withAiMetadata(await blob.arrayBuffer());
      const url = URL.createObjectURL(withMeta);
      const link = document.createElement('a');
      const safeName = (activity.name || 'C公益活动海报').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      link.href = url;
      link.download = `${safeName}-${template}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="poster-layout">
      <div className="poster-preview">
        <canvas ref={canvasRef} aria-label="海报预览" />
      </div>

      <div className="poster-side">
        <div className="panel">
          <div className="panel-head">
            <h2>海报样式</h2>
            <p>3:4 竖版，导出 {POSTER_WIDTH}×{POSTER_HEIGHT} PNG</p>
          </div>
          <div className="panel-body">
            <div className="template-grid">
              {TEMPLATES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`template-btn${template === item.key ? ' active' : ''}`}
                  onClick={() => onTemplateChange(item.key)}
                  title={item.hint}
                >
                  <div className={`template-swatch swatch-${item.key}`} />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="switch-row" style={{ marginTop: 8 }}>
              <span>角落显示「AI 辅助生成」标识</span>
              <button
                type="button"
                className={`switch${showAiMark ? ' on' : ''}`}
                onClick={() => onShowAiMarkChange(!showAiMark)}
                aria-label="切换 AI 标识"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 14 }}
              onClick={download}
              disabled={downloading}
            >
              {downloading ? '导出中…' : '下载 PNG'}
            </button>

            <div className="poster-meta" style={{ marginTop: 12 }}>
              海报文案取自左侧表单，缺项显示为「待补充」。二维码位置为预留框，正式发布前需替换为报名二维码。
              <br />
              导出的 PNG 会在文件元数据中写入 AI 辅助生成标识。
            </div>
          </div>
        </div>

        <div className="notice">
          Logo 位置当前以文字字标占位。拿到机构提供的 Logo 源文件与标准色值后，替换 {POSTER_WIDTH}×{POSTER_HEIGHT} 画布左上角的品牌区即可。
        </div>
      </div>
    </div>
  );
}
