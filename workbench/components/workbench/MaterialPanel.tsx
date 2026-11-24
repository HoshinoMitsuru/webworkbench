'use client';

import { useState } from 'react';
import type { DuplicateHint, MaterialRecord } from '@/lib/workspace-types';
import { api, formatBytes, formatDate } from './api';

interface Props {
  activityId: string;
  materials: MaterialRecord[];
  currentUserId: string;
  onReload: () => Promise<void>;
  onClose: () => void;
  onNotice: (message: string, kind?: 'info' | 'error') => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  doc: '文档',
  sheet: '表格',
  photo: '照片',
  link: '链接',
  other: '其他'
};

export default function MaterialPanel({
  activityId,
  materials,
  currentUserId,
  onReload,
  onClose,
  onNotice
}: Props) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('doc');
  const [visibility, setVisibility] = useState('shared');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState('');
  const [consentNote, setConsentNote] = useState('');
  const [textName, setTextName] = useState('');
  const [textBody, setTextBody] = useState('');
  const [textKind, setTextKind] = useState<'text' | 'link'>('text');
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateHint[]>([]);

  const isImageFile = file ? /\.(jpe?g|png)$/i.test(file.name) : false;
  const consentMissing = isImageFile && !consent;

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (consentMissing) {
      onNotice('图片资料需先选择授权情形：已取得监护人书面授权，或确认画面不含未成年人。', 'error');
      return;
    }
    setBusy(true);
    setDuplicates([]);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      form.append('visibility', visibility);
      form.append('note', note);
      form.append('consent', isImageFile ? consent : 'none');
      form.append('consentNote', consentNote);
      const result = await api<{ material: MaterialRecord; duplicates: DuplicateHint[] }>(
        `/api/activities/${activityId}/materials`,
        { method: 'POST', body: form }
      );
      setFile(null);
      setNote('');
      setConsent('');
      setConsentNote('');
      setDuplicates(result.duplicates);
      await onReload();
      onNotice(
        result.duplicates.length > 0
          ? '资料已上传。发现可能重复的文件，请先核对再决定是否保留。'
          : '资料已上传。'
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '上传失败', 'error');
    } finally {
      setBusy(false);
      event.currentTarget.reset();
    }
  }

  async function addText(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!textName.trim() || !textBody.trim() || busy) return;
    setBusy(true);
    setDuplicates([]);
    try {
      const result = await api<{ material: MaterialRecord; duplicates: DuplicateHint[] }>(
        `/api/activities/${activityId}/materials`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: textName,
            text: textBody,
            kind: textKind,
            visibility
          })
        }
      );
      setTextName('');
      setTextBody('');
      setDuplicates(result.duplicates);
      await onReload();
      onNotice(result.duplicates.length > 0 ? '已添加。发现相似资料，请核对。' : '已添加。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '添加失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility(material: MaterialRecord, next: string) {
    try {
      await api(`/api/materials/${material.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: next })
      });
      await onReload();
      onNotice(next === 'private' ? '已设为仅自己可见。' : '已设为活动内共享。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '设置失败', 'error');
    }
  }

  async function requestDelete(material: MaterialRecord) {
    const reason = window.prompt(`申请删除「${material.name}」，请填写原因：`, '');
    if (reason === null) return;
    try {
      await api(`/api/materials/${material.id}/deletion`, {
        method: 'POST',
        body: JSON.stringify({ action: 'request', reason })
      });
      await onReload();
      onNotice('已提交删除申请，批准前文件仍保留。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '申请失败', 'error');
    }
  }

  async function resolveDelete(material: MaterialRecord, action: 'approve' | 'reject') {
    try {
      await api(`/api/materials/${material.id}/deletion`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      await onReload();
      onNotice(action === 'approve' ? '已批准删除。' : '已拒绝删除请求。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '操作失败', 'error');
    }
  }

  return (
    <div className="wb-drawer-backdrop" role="dialog" aria-modal="true" aria-label="资料库" onClick={onClose}>
      <aside className="wb-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="wb-drawer-head">
          <div>
            <h2>本场资料库</h2>
            <p>共享资料供全组调用；私有资料只有你本人能看到。原始文件保留，不自动清理。</p>
          </div>
          <button className="wb-icon-btn" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="wb-tabs">
          <button type="button" className={`wb-tab${mode === 'file' ? ' active' : ''}`} onClick={() => setMode('file')}>
            上传文件
          </button>
          <button type="button" className={`wb-tab${mode === 'text' ? ' active' : ''}`} onClick={() => setMode('text')}>
            粘贴文本 / 链接
          </button>
        </div>

        {mode === 'file' ? (
          <form className="wb-upload" onSubmit={uploadFile}>
            <label className="wb-drop">
              <input
                type="file"
                accept=".txt,.md,.csv,.json,.pdf,.docx,.jpg,.jpeg,.png"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <strong>{file ? file.name : '选择文件'}</strong>
              <span>{file ? formatBytes(file.size) : '支持 DOCX、PDF、JPG、PNG、TXT、MD、CSV，单个不超过 25 MB'}</span>
            </label>
            <div className="wb-form-grid compact">
              <label className="wb-field">
                <span>分类</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wb-field">
                <span>可见范围</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                  <option value="shared">活动内共享</option>
                  <option value="private">仅自己可见</option>
                </select>
              </label>
            </div>
            <label className="wb-field">
              <span>一句话说明（可选）</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：场地确认函，王老师 11 月 20 日回复" />
            </label>
            {isImageFile ? (
              <div className="wb-consent-group">
                <strong>未成年人肖像授权（必选其一）</strong>
                <label className="wb-consent">
                  <input
                    type="radio"
                    name="consent"
                    checked={consent === 'guardian'}
                    onChange={() => setConsent('guardian')}
                  />
                  已取得监护人书面授权
                </label>
                <label className="wb-consent">
                  <input
                    type="radio"
                    name="consent"
                    checked={consent === 'no_minors'}
                    onChange={() => setConsent('no_minors')}
                  />
                  已确认画面不含未成年人
                </label>
                <label className="wb-field">
                  <span>授权说明（可选）</span>
                  <input
                    value={consentNote}
                    onChange={(event) => setConsentNote(event.target.value)}
                    placeholder="例如：监护人姓名、授权日期或备案编号"
                  />
                </label>
                {consentMissing ? <p className="wb-consent-hint">未选择授权情形前不能上传图片。</p> : null}
              </div>
            ) : null}
            <button className="btn btn-primary" type="submit" disabled={!file || busy || consentMissing}>
              {busy ? '上传中…' : '上传资料'}
            </button>
          </form>
        ) : (
          <form className="wb-upload" onSubmit={addText}>
            <div className="wb-form-grid compact">
              <label className="wb-field">
                <span>名称</span>
                <input value={textName} onChange={(event) => setTextName(event.target.value)} placeholder="例如：嘉宾确认信息" />
              </label>
              <label className="wb-field">
                <span>类型</span>
                <select value={textKind} onChange={(event) => setTextKind(event.target.value as 'text' | 'link')}>
                  <option value="text">文本资料</option>
                  <option value="link">链接</option>
                </select>
              </label>
            </div>
            <label className="wb-field">
              <span>{textKind === 'link' ? '链接与说明' : '内容'}</span>
              <textarea value={textBody} onChange={(event) => setTextBody(event.target.value)} rows={6} placeholder="粘贴已确认的信息。手机号、证件号等会在送入模型前自动脱敏。" />
            </label>
            <div className="wb-form-grid compact">
              <label className="wb-field">
                <span>可见范围</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                  <option value="shared">活动内共享</option>
                  <option value="private">仅自己可见</option>
                </select>
              </label>
            </div>
            <button className="btn btn-primary" type="submit" disabled={!textName.trim() || !textBody.trim() || busy}>
              {busy ? '保存中…' : '添加资料'}
            </button>
          </form>
        )}

        {duplicates.length > 0 ? (
          <div className="wb-dup-box">
            <strong>发现可能重复的资料</strong>
            <p>系统没有自动覆盖或删除，请人工核对后决定是否保留新上传的版本。</p>
            <ul>
              {duplicates.map((item) => (
                <li key={item.id}>
                  <span className={`wb-dup-tag ${item.kind}`}>{item.kind === 'exact' ? '完全相同' : `相似 ${Math.round(item.score * 100)}%`}</span>
                  <strong>{item.name}</strong>
                  <em>
                    {item.uploadedByName} 上传 · {formatDate(item.createdAt)}
                  </em>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="wb-drawer-sub">
          <h3>已上传资料（{materials.length}）</h3>
          <p>连续 7 天未被 AI 任务调用的资料会显示提醒。</p>
        </div>

        {materials.length === 0 ? (
          <p className="wb-empty small">还没有资料。</p>
        ) : (
          <ul className="wb-material-list">
            {materials.map((material) => (
              <li key={material.id} className={material.deleteState === 'requested' ? 'pending-delete' : ''}>
                <div className="wb-material-main">
                  <div className="wb-material-title">
                    <strong>{material.name}</strong>
                    <span className="wb-material-kind">
                      {material.kind === 'file' ? CATEGORY_LABEL[material.category] || '文件' : material.kind === 'link' ? '链接' : '文本'}
                    </span>
                    {material.isImage ? (
                      material.consent === 'guardian' ? (
                        <span className="wb-dup-tag ok">已取得监护人授权</span>
                      ) : material.consent === 'no_minors' ? (
                        <span className="wb-dup-tag ok">确认无未成年人</span>
                      ) : (
                        <span className="wb-dup-tag warn">未授权图片 · 不可用于生成</span>
                      )
                    ) : null}
                    {material.stale ? <span className="wb-dup-tag">7 天未调用</span> : null}
                    {material.visibility === 'private' && material.uploadedById === currentUserId ? (
                      <span className="wb-dup-tag">仅自己</span>
                    ) : null}
                  </div>
                  <div className="wb-material-meta">
                    <span>{material.uploadedByName}</span>
                    <span>{formatDate(material.createdAt)}</span>
                    {material.size > 0 ? <span>{formatBytes(material.size)}</span> : null}
                    <span>{material.parseStatus}</span>
                    <span>{material.lastUsedAt ? `最近调用 ${formatDate(material.lastUsedAt)}` : '尚未调用'}</span>
                  </div>
                  {material.note ? <p>{material.note}</p> : null}
                  {material.deleteState === 'requested' ? (
                    <div className="wb-delete-request">
                      待审批删除：{material.deleteRequestedByName} 申请
                      {material.deleteReason ? `（${material.deleteReason}）` : ''}
                      <div>
                        <button className="btn btn-sm" type="button" onClick={() => resolveDelete(material, 'reject')}>
                          拒绝
                        </button>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => resolveDelete(material, 'approve')}>
                          批准删除
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="wb-material-actions">
                  {material.kind === 'file' ? (
                    <a className="link-btn" href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer">
                      查看
                    </a>
                  ) : null}
                  <select
                    value={material.visibility}
                    onChange={(event) => changeVisibility(material, event.target.value)}
                    aria-label="可见范围"
                  >
                    <option value="shared">共享</option>
                    <option value="private">仅自己</option>
                  </select>
                  {material.deleteState === 'none' ? (
                    <button className="link-btn danger" type="button" onClick={() => requestDelete(material)}>
                      申请删除
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
