import type { ActivityInput } from '@/lib/types';

interface ActivityFormProps {
  activity: ActivityInput;
  onChange: <K extends keyof ActivityInput>(key: K, value: ActivityInput[K]) => void;
}

export default function ActivityForm({ activity, onChange }: ActivityFormProps) {
  return (
    <>
      <div className="form-section">
        <h3>基本信息</h3>
        <div className="field">
          <label htmlFor="name">
            活动名称 <span className="required">必填</span>
          </label>
          <input
            id="name"
            value={activity.name}
            onChange={(event) => onChange('name', event.target.value)}
            placeholder="例：游拾计划·秋日城市漫游"
            maxLength={200}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="project">项目线</label>
            <select id="project" value={activity.project} onChange={(event) => onChange('project', event.target.value)}>
              <option>游拾计划</option>
              <option>一日职业体验</option>
              <option>青桥计划</option>
              <option>其他</option>
            </select>
          </div>
          <div className="field">
            <label>内容类型</label>
            <div className="segmented">
              <button
                type="button"
                className={activity.postType === 'recruit' ? 'active' : ''}
                onClick={() => onChange('postType', 'recruit')}
              >
                招募
              </button>
              <button
                type="button"
                className={activity.postType === 'review' ? 'active' : ''}
                onClick={() => onChange('postType', 'review')}
              >
                回顾
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="form-section">
        <h3>事实字段</h3>
        <div className="field">
          <label htmlFor="date">时间</label>
          <input
            id="date"
            value={activity.date}
            onChange={(event) => onChange('date', event.target.value)}
            placeholder="例：2026年11月28日（周六）14:00–17:30"
            maxLength={200}
          />
        </div>
        <div className="field">
          <label htmlFor="location">地点</label>
          <input
            id="location"
            value={activity.location}
            onChange={(event) => onChange('location', event.target.value)}
            placeholder="例：银川市金凤区阅海公园东门集合"
            maxLength={300}
          />
        </div>
        <div className="field">
          <label htmlFor="audience">对象</label>
          <input
            id="audience"
            value={activity.audience}
            onChange={(event) => onChange('audience', event.target.value)}
            placeholder="例：在银川的高校学生与青年志愿者，共 30 人"
            maxLength={300}
          />
        </div>
        <div className="field">
          <label htmlFor="signup">报名方式</label>
          <input
            id="signup"
            value={activity.signup}
            onChange={(event) => onChange('signup', event.target.value)}
            placeholder="例：扫描海报二维码填写报名表，11月25日截止"
            maxLength={400}
          />
        </div>
      </div>

      <div className="form-section">
        <h3>内容素材</h3>
        <div className="field">
          <label htmlFor="highlights">亮点 / 现场细节</label>
          <textarea
            id="highlights"
            value={activity.highlights}
            onChange={(event) => onChange('highlights', event.target.value)}
            placeholder="活动做什么、现场发生了什么、有什么值得说的细节"
            maxLength={3000}
          />
        </div>
        <div className="field">
          <label htmlFor="notes">补充说明（可选）</label>
          <textarea
            id="notes"
            value={activity.notes}
            onChange={(event) => onChange('notes', event.target.value)}
            placeholder="注意事项、交通提示、是否需要自备物品等"
            maxLength={4000}
          />
        </div>
      </div>

      <div className="form-section">
        <h3>输出设置</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tone">语气</label>
            <select id="tone" value={activity.tone} onChange={(event) => onChange('tone', event.target.value)}>
              <option>温暖克制</option>
              <option>轻松口语</option>
              <option>正式书面</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="organizer">主办方</label>
            <input
              id="organizer"
              value={activity.organizer}
              onChange={(event) => onChange('organizer', event.target.value)}
              maxLength={200}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sensitive">需脱敏词（逗号分隔，可选）</label>
          <input
            id="sensitive"
            value={activity.sensitive}
            onChange={(event) => onChange('sensitive', event.target.value)}
            placeholder="例：张三、某某大学"
            maxLength={500}
          />
          <span className="hint">姓名、学校、电话会在进入模型前替换为占位符；成稿中的〔姓名〕请人工填回。</span>
        </div>
      </div>
    </>
  );
}
