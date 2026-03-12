import { useMemo, useState, type ReactNode } from 'react';
import { Bot, Copy, ExternalLink, Eye, KeyRound, Search, X } from 'lucide-react';
import { AssistantQueryResult } from '../lib/contracts';
import { useStore } from '../store';

const AssistantModal = () => {
  const { closeAssistant, records, openRecordModal, showToast } = useStore();
  const [question, setQuestion] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [result, setResult] = useState<AssistantQueryResult | null>(null);
  const [revealed, setRevealed] = useState<Record<string, { password?: string; key?: string }>>({});

  const recordMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);

  const runQuery = async () => {
    if (!question.trim()) {
      showToast('请输入问题', 'error');
      return;
    }

    setIsQuerying(true);
    try {
      const response = await window.api.assistantQuery(question);
      if (!response.success || !response.result) {
        throw new Error(response.error || '查询失败');
      }
      setResult(response.result);
      setRevealed({});
    } catch (error) {
      showToast(error instanceof Error ? error.message : '查询失败', 'error');
    } finally {
      setIsQuerying(false);
    }
  };

  const copyValue = async (text: string, label: string) => {
    try {
      const response = await window.api.copySensitiveToClipboard(text);
      if (!response.success) {
        throw new Error(response.error || '复制失败');
      }
      showToast(`${label}已复制`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '复制失败', 'error');
    }
  };

  const revealSecret = async (recordId: string, field: 'password' | 'key') => {
    const confirmed = window.confirm(`确认在本地显示该记录的${field === 'password' ? '密码' : 'Key'}？`);
    if (!confirmed) {
      return;
    }

    try {
      const response = await window.api.revealSecret(recordId, field);
      if (!response.success) {
        throw new Error(response.error || '显示失败');
      }
      setRevealed((state) => ({
        ...state,
        [recordId]: {
          ...state[recordId],
          [field]: response.value,
        },
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '显示失败', 'error');
    }
  };

  const openExternal = async (target: string) => {
    try {
      const response = await window.api.openExternal(target);
      if (!response.success) {
        throw new Error(response.error || '打开链接失败');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开链接失败', 'error');
    }
  };

  const openMatchedRecord = (recordId: string) => {
    const record = recordMap.get(recordId);
    if (!record) {
      return;
    }
    closeAssistant();
    openRecordModal(record);
  };

  const maskedValue = (revealedValue: string | undefined, available: boolean) => {
    if (revealedValue) {
      return revealedValue;
    }
    return available ? '••••••••' : '无';
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]" onClick={closeAssistant}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-[var(--color-bg-elevated)] border-l border-[var(--color-border)] shadow-[var(--shadow-xl)] animate-slideDown"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">AI 助手</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">AI 先基于脱敏后的名称、分类、地址域名和字段标签检索记录，再由你决定是否在本地显示密码或 Key。</p>
          </div>
          <button onClick={closeAssistant} className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200">
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void runQuery();
                  }
                }}
                placeholder="例如：Gitee 的账号是什么"
                className="w-full h-10 pl-8 pr-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] transition-colors duration-200"
              />
            </div>
            <button onClick={() => void runQuery()} className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-200 text-sm font-medium" disabled={isQuerying}>
              {isQuerying ? '查询中...' : '查询'}
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto h-[calc(100%-137px)]">
          {result ? (
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--color-text-primary)] mb-2">
                  <Bot size={16} />
                  <span className="font-medium">回答</span>
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-6">{result.answer}</p>
              </div>

              {result.results.map((match) => {
                const revealedPassword = revealed[match.recordId]?.password;
                const revealedKey = revealed[match.recordId]?.key;

                return (
                  <div key={match.recordId} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-[var(--color-text-primary)]">{match.name}</h3>
                        <p className="text-sm text-[var(--color-text-secondary)] mt-1">{match.categoryName || match.categoryId}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-2">命中字段：{match.matchedFields.join('、') || '名称'}</p>
                      </div>
                      <button
                        onClick={() => openMatchedRecord(match.recordId)}
                        className="px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)]"
                      >
                        打开记录
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <ResultField
                        label="账号"
                        value={match.account || '无'}
                        onCopy={match.account ? () => void copyValue(match.account!, '账号') : undefined}
                      />
                      <ResultField
                        label="地址"
                        value={match.address || '无'}
                        onCopy={match.address ? () => void copyValue(match.address!, '地址') : undefined}
                        onOpen={match.address ? () => void openExternal(match.address!) : undefined}
                      />
                      <ResultField
                        label="密码"
                        value={maskedValue(revealedPassword, match.hasPassword)}
                        mono
                        actions={[
                          match.hasPassword ? (
                            <button
                              key="reveal-password"
                              onClick={() => void revealSecret(match.recordId, 'password')}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]"
                            >
                              <Eye size={12} />
                              {revealedPassword ? '重新显示' : '显示密码'}
                            </button>
                          ) : null,
                          revealedPassword ? (
                            <button
                              key="copy-password"
                              onClick={() => void copyValue(revealedPassword, '密码')}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]"
                            >
                              <Copy size={12} />
                              复制密码
                            </button>
                          ) : null,
                        ]}
                      />
                      <ResultField
                        label="Key"
                        value={maskedValue(revealedKey, match.hasKey)}
                        mono
                        actions={[
                          match.hasKey ? (
                            <button
                              key="reveal-key"
                              onClick={() => void revealSecret(match.recordId, 'key')}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]"
                            >
                              <KeyRound size={12} />
                              {revealedKey ? '重新显示' : '显示 Key'}
                            </button>
                          ) : null,
                          revealedKey ? (
                            <button
                              key="copy-key"
                              onClick={() => void copyValue(revealedKey, 'Key')}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]"
                            >
                              <Copy size={12} />
                              复制 Key
                            </button>
                          ) : null,
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center px-6 text-center text-sm text-[var(--color-text-tertiary)] leading-6">
              输入问题后开始检索本地记录。模型只接收脱敏后的名称、分类、地址域名和字段标签等元数据，账号、密码、Key 明文不会离开本地保险库。
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

const ResultField = ({
  label,
  value,
  mono,
  onCopy,
  onOpen,
  actions,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  onOpen?: () => void;
  actions?: Array<ReactNode | null>;
}) => (
  <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)]">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
        <div className={`mt-1 text-sm text-[var(--color-text-primary)] break-all ${mono ? 'font-mono' : ''}`}>
          {value}
        </div>
      </div>
      {onCopy || onOpen ? (
        <div className="flex shrink-0 items-center gap-1">
          {onOpen ? (
            <button
              onClick={onOpen}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
              title={`打开${label}`}
            >
              <ExternalLink size={14} className="text-[var(--color-text-secondary)]" />
            </button>
          ) : null}
          {onCopy ? (
            <button
              onClick={onCopy}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
              title={`复制${label}`}
            >
              <Copy size={14} className="text-[var(--color-text-secondary)]" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
    {actions?.filter(Boolean).length ? (
      <div className="flex flex-wrap gap-3">
        {actions}
      </div>
    ) : null}
  </div>
);

export default AssistantModal;
