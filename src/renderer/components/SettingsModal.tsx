import { useEffect, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Save, Upload, X } from 'lucide-react';
import { useStore } from '../store';
import {
  AISettings,
  AuditLogEntry,
  ImportPreview,
  ImportResolution,
  SecuritySettings,
  SyncSettings,
  SyncStatus,
} from '../lib/contracts';
import ImportPreviewModal from './ImportPreviewModal';

interface SettingsModalProps {
  onDataChanged: () => Promise<void>;
  onSecuritySettingsChanged: (settings: SecuritySettings) => void;
}

const defaultAISettings: AISettings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  searchMode: 'extended',
};

const defaultSyncSettings: SyncSettings = {
  remoteUrl: '',
  branch: 'main',
  localDir: '',
  snapshotFileName: 'vault.svlt',
};

const defaultSecuritySettings: SecuritySettings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
};

function parseNumberSetting(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, numeric);
}

function formatAuditAction(action: string): string {
  const mapping: Record<string, string> = {
    CREATE: '创建记录',
    UPDATE: '更新记录',
    DELETE: '删除记录',
  };
  return mapping[action] || action;
}

const SettingsModal = ({ onDataChanged, onSecuritySettingsChanged }: SettingsModalProps) => {
  const { closeSettingsModal, showToast } = useStore();
  const [aiSettings, setAISettings] = useState<AISettings>(defaultAISettings);
  const [syncSettings, setSyncSettings] = useState<SyncSettings>(defaultSyncSettings);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(defaultSecuritySettings);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ configured: false });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isSavingAI, setIsSavingAI] = useState(false);
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const [isSavingSync, setIsSavingSync] = useState(false);
  const [isRunningSync, setIsRunningSync] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      const [aiResponse, syncResponse, autoLockMinutes, clipboardClearSeconds, recentAuditLogs] = await Promise.all([
        window.api.getAISettings(),
        window.api.getSyncStatus(),
        window.api.getSetting('autoLockMinutes'),
        window.api.getSetting('clipboardClearSeconds'),
        window.api.getAuditLogs(12),
      ]);

      if (aiResponse.success) {
        setAISettings({
          baseUrl: aiResponse.settings.baseUrl || '',
          model: aiResponse.settings.model || '',
          apiKey: aiResponse.settings.apiKey || '',
          searchMode: aiResponse.settings.searchMode === 'local' ? 'local' : 'extended',
        });
      }

      if (syncResponse.success) {
        setSyncStatus(syncResponse.status);
        setSyncSettings({
          remoteUrl: syncResponse.status.remoteUrl || '',
          branch: syncResponse.status.branch || 'main',
          localDir: syncResponse.status.localDir || '',
          snapshotFileName: syncResponse.status.snapshotFileName || 'vault.svlt',
        });
      }

      setSecuritySettings({
        autoLockMinutes: parseNumberSetting(autoLockMinutes, defaultSecuritySettings.autoLockMinutes),
        clipboardClearSeconds: parseNumberSetting(clipboardClearSeconds, defaultSecuritySettings.clipboardClearSeconds),
      });
      setAuditLogs((recentAuditLogs || []) as AuditLogEntry[]);
    };

    loadSettings().catch((error) => {
      showToast(error instanceof Error ? error.message : '加载设置失败', 'error');
    });
  }, [showToast]);

  useEffect(() => () => {
    if (pendingImportId) {
      void window.api.discardImportBackup(pendingImportId);
    }
  }, [pendingImportId]);

  const closeImportPreview = async () => {
    if (pendingImportId) {
      await window.api.discardImportBackup(pendingImportId);
    }
    setPendingImportId(null);
    setImportPreview(null);
  };

  const closeModal = () => {
    if (pendingImportId) {
      void window.api.discardImportBackup(pendingImportId);
      setPendingImportId(null);
      setImportPreview(null);
    }
    closeSettingsModal();
  };

  const saveAISettings = async () => {
    setIsSavingAI(true);
    try {
      const result = await window.api.setAISettings(aiSettings);
      if (!result.success) {
        throw new Error(result.error || '保存 AI 配置失败');
      }
      showToast('AI 配置已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存 AI 配置失败', 'error');
    } finally {
      setIsSavingAI(false);
    }
  };

  const testAIConnection = async () => {
    setIsTestingAI(true);
    try {
      const result = await window.api.testAIConnection();
      if (!result.success) {
        throw new Error(result.error || '测试失败');
      }
      showToast('模型连接正常', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '模型连接失败', 'error');
    } finally {
      setIsTestingAI(false);
    }
  };

  const exportBackup = async () => {
    const result = await window.api.exportBackup();
    if (result.success) {
      showToast('已导出加密备份', 'success');
      return;
    }
    if (!result.canceled) {
      showToast(result.error || '导出失败', 'error');
    }
  };

  const importBackup = async () => {
    const result = await window.api.prepareImportBackup();
    if (result.success) {
      setPendingImportId(result.importId);
      setImportPreview(result.preview);
      return;
    }
    if (!result.canceled) {
      showToast(result.error || '导入失败', 'error');
    }
  };

  const applyImportPlan = async (resolutions: ImportResolution[]) => {
    if (!pendingImportId) {
      throw new Error('导入会话已失效，请重新选择备份文件。');
    }

    const result = await window.api.applyImportBackup(pendingImportId, resolutions);
    if (!result.success) {
      throw new Error(result.error || '导入失败');
    }

    await onDataChanged();
    setAuditLogs((await window.api.getAuditLogs(12)) as AuditLogEntry[]);
    setPendingImportId(null);
    setImportPreview(null);
    showToast(
      `导入完成：新增 ${result.importedCount}，覆盖 ${result.overwrittenCount}，合并 ${result.mergedCount}，跳过 ${result.skippedCount}`,
      'success',
    );
    return result;
  };

  const saveSecuritySettings = async () => {
    setIsSavingSecurity(true);
    try {
      await Promise.all([
        window.api.setSetting('autoLockMinutes', String(securitySettings.autoLockMinutes)),
        window.api.setSetting('clipboardClearSeconds', String(securitySettings.clipboardClearSeconds)),
      ]);
      onSecuritySettingsChanged(securitySettings);
      showToast('安全设置已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存安全设置失败', 'error');
    } finally {
      setIsSavingSecurity(false);
    }
  };

  const saveSyncSettings = async () => {
    setIsSavingSync(true);
    try {
      const result = await window.api.configureSync(syncSettings);
      if (!result.success) {
        throw new Error(result.error || '保存同步配置失败');
      }
      setSyncStatus(result.status);
      showToast('同步配置已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存同步配置失败', 'error');
    } finally {
      setIsSavingSync(false);
    }
  };

  const runSync = async () => {
    setIsRunningSync(true);
    try {
      const result = await window.api.runSync();
      if (!result.success) {
        throw new Error(result.error || '同步失败');
      }
      setSyncStatus(result.status);
      await onDataChanged();
      setAuditLogs((await window.api.getAuditLogs(12)) as AuditLogEntry[]);
      showToast('同步完成', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '同步失败', 'error');
    } finally {
      setIsRunningSync(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="w-full max-w-4xl max-h-[92vh] overflow-hidden bg-[var(--color-bg-elevated)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] animate-scaleIn"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">设置与同步</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">AI 配置、加密备份和 Git 同步</p>
          </div>
          <button onClick={closeModal} className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200">
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(92vh-80px)] grid grid-cols-2 gap-6">
          <section className="card p-5">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">AI 设置</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">采用 OpenAI-compatible 接口。默认开启扩展 AI 检索，仅发送脱敏后的名称、分类、地址域名和字段标签等结构化元数据，不发送账号、密码、Key 明文。</p>
            <div className="space-y-3">
              <Field label="Base URL">
                <input value={aiSettings.baseUrl} onChange={(event) => setAISettings((state) => ({ ...state, baseUrl: event.target.value }))} className={inputClassName} placeholder="https://api.example.com/v1" />
              </Field>
              <Field label="Model">
                <input value={aiSettings.model} onChange={(event) => setAISettings((state) => ({ ...state, model: event.target.value }))} className={inputClassName} placeholder="gpt-4.1-mini" />
              </Field>
              <Field label="API Key">
                <input value={aiSettings.apiKey} onChange={(event) => setAISettings((state) => ({ ...state, apiKey: event.target.value }))} className={`${inputClassName} font-mono`} placeholder="sk-..." />
              </Field>
              <Field label="检索模式">
                <select
                  value={aiSettings.searchMode || 'extended'}
                  onChange={(event) => setAISettings((state) => ({ ...state, searchMode: event.target.value as AISettings['searchMode'] }))}
                  className={inputClassName}
                >
                  <option value="extended">扩展 AI 检索（默认）</option>
                  <option value="local">仅本地检索</option>
                </select>
              </Field>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-4">扩展 AI 检索会把去敏后的记录元数据交给模型做语义召回和排序；敏感值仍然只在本地保管和展示。</p>

            <div className="flex gap-3 mt-4">
              <button onClick={saveAISettings} className={primaryButtonClassName} disabled={isSavingAI}>
                <Save size={14} />
                {isSavingAI ? '保存中...' : '保存'}
              </button>
              <button onClick={testAIConnection} className={secondaryButtonClassName} disabled={isTestingAI}>
                <RefreshCw size={14} className={isTestingAI ? 'animate-spin' : ''} />
                {isTestingAI ? '测试中...' : '测试连接'}
              </button>
            </div>
          </section>

          <section className="card p-5">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">安全偏好</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">控制自动锁定和敏感剪贴板自动清空。</p>
            <div className="space-y-3">
              <Field label="自动锁定（分钟，0 为禁用）">
                <input
                  type="number"
                  min="0"
                  value={securitySettings.autoLockMinutes}
                  onChange={(event) => setSecuritySettings((state) => ({ ...state, autoLockMinutes: parseNumberSetting(event.target.value, 0) }))}
                  className={inputClassName}
                />
              </Field>
              <Field label="剪贴板清空（秒，0 为禁用）">
                <input
                  type="number"
                  min="0"
                  value={securitySettings.clipboardClearSeconds}
                  onChange={(event) => setSecuritySettings((state) => ({ ...state, clipboardClearSeconds: parseNumberSetting(event.target.value, 0) }))}
                  className={inputClassName}
                />
              </Field>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={saveSecuritySettings} className={primaryButtonClassName} disabled={isSavingSecurity}>
                <Save size={14} />
                {isSavingSecurity ? '保存中...' : '保存安全设置'}
              </button>
            </div>
          </section>

          <section className="card p-5">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">加密备份</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">导出或导入 `.svlt` 加密快照文件。</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={exportBackup} className={secondaryButtonClassName}>
                <Download size={14} />
                导出备份
              </button>
              <button onClick={importBackup} className={secondaryButtonClassName}>
                <Upload size={14} />
                预览并导入
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-4">现在会先显示导入预览，再决定跳过、覆盖、保留两条或合并字段。</p>
          </section>

          <section className="card p-5">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">最近活动</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">当前保存的最近审计日志。</p>

            {auditLogs.length ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div key={log.id} className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">{formatAuditAction(log.action)}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                    </div>
                    {log.record_id ? (
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">记录 ID: {log.record_id}</div>
                    ) : null}
                    {log.details ? (
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)] break-all">{log.details}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
                暂无审计日志。
              </div>
            )}
          </section>

          <section className="card p-5 col-span-2">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">Git 同步</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">调用系统 Git 的已登录能力执行 pull / commit / push。</p>

            <div className="grid grid-cols-2 gap-4">
              <Field label="远程仓库地址">
                <input value={syncSettings.remoteUrl} onChange={(event) => setSyncSettings((state) => ({ ...state, remoteUrl: event.target.value }))} className={inputClassName} placeholder="https://github.com/you/repo.git" />
              </Field>
              <Field label="分支">
                <input value={syncSettings.branch} onChange={(event) => setSyncSettings((state) => ({ ...state, branch: event.target.value }))} className={inputClassName} placeholder="main" />
              </Field>
              <Field label="本地工作目录">
                <input value={syncSettings.localDir} onChange={(event) => setSyncSettings((state) => ({ ...state, localDir: event.target.value }))} className={inputClassName} placeholder=".\\git-sync 或 D:\\secure-vault-sync" />
              </Field>
              <Field label="快照文件名">
                <input value={syncSettings.snapshotFileName} onChange={(event) => setSyncSettings((state) => ({ ...state, snapshotFileName: event.target.value }))} className={inputClassName} placeholder="vault.svlt" />
              </Field>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
              远程仓库地址请填写 GitHub / Gitee 仓库地址，或另一个专门用于同步的仓库目录；不要和“本地工作目录”填成同一个文件夹。本地工作目录支持相对路径，例如 `.\git-sync`。在干净便携包里，它会落到 `user-data\git-sync`。
            </p>

            <div className="flex gap-3 mt-4">
              <button onClick={saveSyncSettings} className={primaryButtonClassName} disabled={isSavingSync}>
                <Save size={14} />
                {isSavingSync ? '保存中...' : '保存同步配置'}
              </button>
              <button onClick={runSync} className={secondaryButtonClassName} disabled={isRunningSync}>
                <RefreshCw size={14} className={isRunningSync ? 'animate-spin' : ''} />
                {isRunningSync ? '同步中...' : '立即同步'}
              </button>
            </div>

            <div className="mt-4 p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text-secondary)] space-y-1">
              <div>最近运行：{syncStatus.lastRunAt ? new Date(syncStatus.lastRunAt).toLocaleString('zh-CN') : '未运行'}</div>
              <div>最近成功：{syncStatus.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString('zh-CN') : '暂无'}</div>
              <div>
                <div>最近错误：</div>
                <div className="mt-1 whitespace-pre-line break-all">{syncStatus.lastError || '无'}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
      {importPreview && pendingImportId ? (
        <ImportPreviewModal
          preview={importPreview}
          onClose={() => void closeImportPreview()}
          onConfirm={applyImportPlan}
        />
      ) : null}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block">
    <span className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{label}</span>
    {children}
  </label>
);

const inputClassName = `
  w-full h-10 px-3
  bg-[var(--color-bg-secondary)]
  border border-[var(--color-border)]
  rounded-[var(--radius-md)]
  text-sm text-[var(--color-text-primary)]
  placeholder:text-[var(--color-text-tertiary)]
  focus:border-[var(--color-accent)]
  transition-colors duration-200
`;

const primaryButtonClassName = `
  inline-flex items-center gap-2 px-4 py-2
  rounded-[var(--radius-md)]
  bg-[var(--color-accent)] text-white
  hover:bg-[var(--color-accent-hover)]
  transition-colors duration-200
  text-sm font-medium
`;

const secondaryButtonClassName = `
  inline-flex items-center gap-2 px-4 py-2
  rounded-[var(--radius-md)]
  bg-[var(--color-bg-secondary)]
  border border-[var(--color-border)]
  text-[var(--color-text-primary)]
  hover:bg-[var(--color-bg-tertiary)]
  transition-colors duration-200
  text-sm font-medium
`;

export default SettingsModal;
