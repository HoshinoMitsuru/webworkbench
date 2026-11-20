export default function ScriptPlaceholder() {
  return (
    <div className="panel">
      <div className="soon">
        <span className="soon-tag">二期功能</span>
        <h3>1 分钟视频脚本</h3>
        <p>
          用小红书或视频号发布活动回顾时，可以直接复用同一份活动资料，生成分镜、时长、画面提示与字幕。
          当前版本先保证文案与海报跑通，脚本留到二期。
        </p>
        <ul>
          <li>分镜表：镜号 / 时长 / 画面 / 字幕</li>
          <li>自动匹配已有活动照片与视频素材</li>
          <li>导出为可交给剪辑志愿者的清单</li>
        </ul>
      </div>
    </div>
  );
}
