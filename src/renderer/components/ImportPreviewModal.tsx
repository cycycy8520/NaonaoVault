import { AlertTriangle, ArrowRight, CheckCircle2, CopyPlus, GitMerge, RotateCcw, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { ApplyImportResult, ImportConflictStrategy, ImportPreview, ImportResolution } from '../lib/contracts';

interface ImportPreviewModalProps {
  preview: ImportPreview;
  onClose: () => void;
  onConfirm: (resolutions: ImportResolution[]) => Promise<ApplyImportResult | void>;
}

const strategyOptions: Array<{ value: ImportConflictStrategy; label: string }> = [
  { value: 'skip', label: '跳过' },
  { value: 'overwrite', label: '覆盖本地' },
  { value: 'keep-both', label: '保留两条' },
  { value: 'merge-fields', label: '合并字段' },
];

const statusStyles: Record<string, string> = {
  new: 'bg-emerald-500/12 text-emerald-300',
  unchanged: 'bg-slate-500/12 text-slate-300',
  'same-id-conflict': 'bg-amber-500/12 text-amber-300',
  duplicate: 'bg-sky-500/12 text-sky-300',
};

const statusLabels: Record<string, string> = {
  new: '新增',
  unchanged: '无变化',
  'same-id-conflict': '同 ID 冲突',
  duplicate: '疑似重复',
};

function buildInitialResolution(preview: ImportPreview): Record<string, ImportResolution> {
  return Object.fromEntries(
    preview.items
      .filter((item) => item.status === 'duplicate' || item.status === 'same-id-conflict')
      .map((item) => [
        item.importRecordId,
        {
          importRecordId: item.importRecordId,
          strategy: item.suggestedStrategy ?? 'keep-both',
          targetLocalRecordId: item.duplicateCandidates[0]?.localRecordId,
        },
      ]),
  );
}

const ImportPreviewModal = ({ preview, onClose, onConfirm }: ImportPreviewModalProps) => {
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>(() => buildInitialResolution(preview));
  const [isApplying, setIsApplying] = useState(false);

  const conflictItems = useMemo(
    () => preview.items.filter((item) => item.status === 'duplicate' || item.status === 'same-id-conflict'),
    [preview.items],
  );

  const updateResolution = (importRecordId: string, patch: Partial<ImportResolution>) => {
    setResolutions((state) => ({
      ...state,
      [importRecordId]: {
        importRecordId,
        strategy: state[importRecordId]?.strategy ?? 'keep-both',
        targetLocalRecordId: state[importRecordId]?.targetLocalRecordId,
        ...patch,
      },
    }));
  };

  const applyImport = async () => {
    setIsApplying(true);
    try {
      await onConfirm(Object.values(resolutions));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="modal-overlay z-[calc(var(--z-modal)+10)]" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[92vh] overflow-hidden bg-[var(--color-bg-elevated)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] animate-scaleIn"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">导入预览</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {preview.fileName || '已选择备份文件'}，先确认冲突处理，再执行导入。
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200">
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(92vh-84px)] space-y-5">
          <div className="grid grid-cols-5 gap-3">
            <SummaryCard label="总记录" value={preview.totalRecords} tone="neutral" />
            <SummaryCard label="新增" value={preview.newCount} tone="green" />
            <SummaryCard label="无变化" value={preview.unchangedCount} tone="neutral" />
            <SummaryCard label="同 ID 冲突" value={preview.sameIdConflictCount} tone="amber" />
            <SummaryCard label="疑似重复" value={preview.duplicateCount} tone="blue" />
          </div>

          <div className="card p-4 space-y-2">
            <div className="text-sm text-[var(--color-text-primary)]">
              来源 vault: <span className="font-mono text-xs">{preview.sourceVaultId}</span>
            </div>
            <div className="text-sm text-[var(--color-text-primary)]">
              当前 vault: <span className="font-mono text-xs">{preview.targetVaultId}</span>
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              {preview.sameVault ? '同 vault 导入会保留现有快照合并规则。' : '跨 vault 导入会按记录导入处理，不会直接套用对方的删除标记。'}
            </div>
          </div>

          {preview.warnings.length ? (
            <div className="space-y-2">
              {preview.warnings.map((warning) => (
                <div key={warning} className="card p-3 flex items-start gap-3 text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          ) : null}

          {conflictItems.length ? (
            <section className="space-y-3">
              <h3 className="text-base font-semibold text-[var(--color-text-primary)]">冲突处理</h3>
              {conflictItems.map((item) => {
                const resolution = resolutions[item.importRecordId];
                const candidateOptions = item.duplicateCandidates;

                return (
                  <div key={item.importRecordId} className="card p-4 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-semibold text-[var(--color-text-primary)]">{item.name}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${statusStyles[item.status]}`}>{statusLabels[item.status]}</span>
                        </div>
                        <div className="mt-1 text-sm text-[var(--color-text-secondary)] break-all">
                          {item.account || item.address || item.categoryId}
                        </div>
                        {item.matchedBy.length ? (
                          <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                            命中依据：{item.matchedBy.join('、')}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {candidateOptions.length ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                        <RecordPane
                          title="导入记录"
                          name={item.name}
                          account={item.account}
                          address={item.address}
                        />
                        <div className="pt-12">
                          <ArrowRight size={16} className="text-[var(--color-text-tertiary)]" />
                        </div>
                        <div className="space-y-3">
                          <label className="block">
                            <span className="block text-xs text-[var(--color-text-tertiary)] mb-1">本地目标</span>
                            <select
                              value={resolution?.targetLocalRecordId || candidateOptions[0]?.localRecordId || ''}
                              onChange={(event) => updateResolution(item.importRecordId, { targetLocalRecordId: event.target.value })}
                              className={selectClassName}
                            >
                              {candidateOptions.map((candidate) => (
                                <option key={candidate.localRecordId} value={candidate.localRecordId}>
                                  {candidate.name} · {(candidate.account || candidate.address || '无账号/地址')}
                                </option>
                              ))}
                            </select>
                          </label>
                          {candidateOptions
                            .filter((candidate) => candidate.localRecordId === (resolution?.targetLocalRecordId || candidateOptions[0]?.localRecordId))
                            .map((candidate) => (
                              <RecordPane
                                key={candidate.localRecordId}
                                title="本地记录"
                                name={candidate.name}
                                account={candidate.account}
                                address={candidate.address}
                                subtitle={`命中依据：${candidate.matchedBy.join('、')}`}
                              />
                            ))}
                        </div>
                      </div>
                    ) : null}

                    <label className="block">
                      <span className="block text-xs text-[var(--color-text-tertiary)] mb-1">处理策略</span>
                      <select
                        value={resolution?.strategy || item.suggestedStrategy || 'keep-both'}
                        onChange={(event) => updateResolution(item.importRecordId, { strategy: event.target.value as ImportConflictStrategy })}
                        className={selectClassName}
                      >
                        {strategyOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
                      <Hint icon={<RotateCcw size={12} />} text="跳过：忽略这条导入记录" />
                      <Hint icon={<CopyPlus size={12} />} text="保留两条：额外导入为新记录" />
                      <Hint icon={<CheckCircle2 size={12} />} text="覆盖本地：以导入内容替换目标记录" />
                      <Hint icon={<GitMerge size={12} />} text="合并字段：优先保留本地已有值，只补缺失字段" />
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          <div className="card p-4">
            <div className="text-sm text-[var(--color-text-secondary)]">
              无冲突的记录会直接导入；无变化的记录会跳过。
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={onClose} className={secondaryButtonClassName} disabled={isApplying}>
              取消
            </button>
            <button onClick={() => void applyImport()} className={primaryButtonClassName} disabled={isApplying}>
              {isApplying ? '导入中...' : '确认导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'green' | 'amber' | 'blue';
}) => {
  const toneClassName = {
    neutral: 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]',
    green: 'bg-emerald-500/12 text-emerald-300',
    amber: 'bg-amber-500/12 text-amber-300',
    blue: 'bg-sky-500/12 text-sky-300',
  }[tone];

  return (
    <div className={`rounded-[var(--radius-lg)] p-4 ${toneClassName}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
};

const RecordPane = ({
  title,
  name,
  account,
  address,
  subtitle,
}: {
  title: string;
  name: string;
  account?: string;
  address?: string;
  subtitle?: string;
}) => (
  <div className="rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3 space-y-1 min-h-24">
    <div className="text-xs text-[var(--color-text-tertiary)]">{title}</div>
    <div className="text-sm font-medium text-[var(--color-text-primary)] break-all">{name}</div>
    <div className="text-xs text-[var(--color-text-secondary)] break-all">{account || '无账号'}</div>
    <div className="text-xs text-[var(--color-text-secondary)] break-all">{address || '无地址'}</div>
    {subtitle ? <div className="pt-1 text-xs text-[var(--color-text-tertiary)]">{subtitle}</div> : null}
  </div>
);

const Hint = ({ icon, text }: { icon: ReactNode; text: string }) => (
  <div className="inline-flex items-center gap-1">
    {icon}
    <span>{text}</span>
  </div>
);

const selectClassName = `
  w-full h-10 px-3
  bg-[var(--color-bg-secondary)]
  border border-[var(--color-border)]
  rounded-[var(--radius-md)]
  text-sm text-[var(--color-text-primary)]
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

export default ImportPreviewModal;
