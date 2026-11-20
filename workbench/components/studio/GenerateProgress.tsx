import { PROGRESS_STEPS } from '@/lib/studio-config';

interface GenerateProgressProps {
  step: number;
}

export default function GenerateProgress({ step }: GenerateProgressProps) {
  return (
    <div className="panel">
      <div className="panel-body">
        <div className="progress">
          {PROGRESS_STEPS.map((label, index) => (
            <div
              key={label}
              className={`progress-step${index < step ? ' done' : index === step ? ' active' : ''}`}
            >
              <span className="dot">{index < step ? '✓' : ''}</span>
              {label}
            </div>
          ))}
        </div>
        <div className="poster-meta">通常需要 10–30 秒。生成过程可随时中止。</div>
      </div>
    </div>
  );
}
