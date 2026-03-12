import { useState, type ReactNode } from 'react';
import { Check, Layers3, Sparkles, Wand2, X } from 'lucide-react';
import { useStore } from '../store';
import { CaptureBatchResult, CaptureDraft, CaptureDraftResult, normalizeRecord } from '../lib/contracts';

const SmartCaptureModal = () => {
  const {
    categories,
    addRecord,
    closeSmartCapture,
    showToast,
  } = useStore();

  const [rawText, setRawText] = useState('');
  const [captureResult, setCaptureResult] = useState<CaptureBatchResult | null>(null);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedDraft = captureResult?.drafts[selectedDraftIndex] ?? null;

  const parseDraft = async () => {
    if (!rawText.trim()) {
      showToast('请先粘贴原始文本', 'error');
      return;
    }

    setIsParsing(true);
    try {
      const response = await window.api.captureDraft(rawText);
      if (!response.success || !response.draft) {
        throw new Error(response.error || '智能录入失败');
      }
      setCaptureResult(response.draft as CaptureBatchResult);
      setSelectedDraftIndex(0);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '智能录入失败', 'error');
    } finally {
      setIsParsing(false);
    }
  };

  const buildRecordPayload = (draft: CaptureDraft) => ({
    ...draft,
    customFields: draft.customFields
      .filter((field) => field.fieldName.trim())
      .map((field, index) => ({
        fieldName: field.fieldName,
        fieldValue: field.fieldValue || '',
        fieldType: 'text',
        sortOrder: index,
      })),
  });

  const createRecordFromDraft = async (draft: CaptureDraft) => {
    const response = await window.api.createRecord(buildRecordPayload(draft));
    if (!response.success || !response.record) {
      throw new Error(response.error || '保存失败');
    }
    addRecord(normalizeRecord(response.record));
  };

  const removeDraftAt = (index: number) => {
    setCaptureResult((current) => {
      if (!current) {
        return current;
      }

      const drafts = current.drafts.filter((_, draftIndex) => draftIndex !== index);
      return drafts.length > 0 ? { ...current, drafts } : null;
    });
    setSelectedDraftIndex((current) => Math.max(0, Math.min(current, (captureResult?.drafts.length ?? 1) - 2)));
  };

  const saveSelectedDraft = async () => {
    if (!selectedDraft) {
      return;
    }

    setIsSaving(true);
    try {
      await createRecordFromDraft(selectedDraft.draft);
      const remaining = (captureResult?.drafts.length ?? 1) - 1;
      removeDraftAt(selectedDraftIndex);

      if (remaining <= 0) {
        showToast('智能录入已创建记录', 'success');
        closeSmartCapture();
      } else {
        showToast(`已创建 1 条记录，剩余 ${remaining} 条待保存`, 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveAllDrafts = async () => {
    if (!captureResult?.drafts.length) {
      return;
    }

    setIsSaving(true);
    const draftsToSave = [...captureResult.drafts];
    let savedCount = 0;

    try {
      for (const draftResult of draftsToSave) {
        await createRecordFromDraft(draftResult.draft);
        savedCount += 1;
      }

      showToast(`已批量创建 ${savedCount} 条记录`, 'success');
      closeSmartCapture();
    } catch (error) {
      setCaptureResult((current) => current ? { ...current, drafts: current.drafts.slice(savedCount) } : current);
      setSelectedDraftIndex(0);
      const message = error instanceof Error ? error.message : '批量保存失败';
      showToast(`已创建 ${savedCount} 条，剩余 ${draftsToSave.length - savedCount} 条未保存：${message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSelectedDraft = (patch: Partial<CaptureDraft>) => {
    setCaptureResult((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft, index) => (
          index === selectedDraftIndex
            ? { ...draft, draft: { ...draft.draft, ...patch } }
            : draft
        )),
      };
    });
  };

  const updateCustomField = (index: number, fieldName: string, fieldValue: string) => {
    setCaptureResult((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft, draftIndex) => (
          draftIndex === selectedDraftIndex
            ? {
              ...draft,
              draft: {
                ...draft.draft,
                customFields: draft.draft.customFields.map((field, fieldIndex) => (
                  fieldIndex === index ? { ...field, fieldName, fieldValue } : field
                )),
              },
            }
            : draft
        )),
      };
    });
  };

  return (
    <div className="modal-overlay" onClick={closeSmartCapture}>
      <div
        className="w-full max-w-6xl max-h-[92vh] bg-[var(--color-bg-elevated)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] overflow-hidden animate-scaleIn"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">智能录入</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">敏感值先在本地提取和保管，云模型只整理脱敏后的结构化信息，支持拆分为多条草稿。</p>
          </div>
          <button onClick={closeSmartCapture} className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200">
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_1.1fr] h-[calc(92vh-84px)] max-h-[calc(92vh-84px)] min-h-0">
          <section className="p-6 border-r border-[var(--color-border)] overflow-y-auto min-h-0">
            <div className="flex items-center gap-2 mb-3 text-[var(--color-text-primary)]">
              <Sparkles size={16} />
              <h3 className="font-semibold">原始文本</h3>
            </div>
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="粘贴一段账号、密码、网址混杂的文本。支持类似“GitHub + 多个账号/密码”这样的批量录入。"
              className="w-full min-h-[320px] p-4 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] resize-y"
            />
            <button onClick={parseDraft} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-200 disabled:opacity-60" disabled={isParsing}>
              <Wand2 size={14} className={isParsing ? 'animate-pulse' : ''} />
              {isParsing ? '解析中...' : '解析并生成草稿'}
            </button>
          </section>

          <section className="flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between mb-3 px-6 pt-6">
              <div>
                <h3 className="font-semibold text-[var(--color-text-primary)]">结构化草稿</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">可逐条修正，也可批量创建。账号、密码、Key 会在本地保管，模型只参与去敏后的结构整理。</p>
              </div>
              {selectedDraft?.usedModel ? (
                <span className="px-2 py-1 rounded-full text-xs bg-[var(--color-accent-light)] text-[var(--color-accent)]">使用了云模型整理</span>
              ) : null}
            </div>

            {captureResult && selectedDraft ? (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
                  {captureResult.warnings.length ? (
                    <div className="p-3 rounded-[var(--radius-md)] bg-[rgba(255,149,0,0.12)] text-sm text-[var(--color-text-primary)] space-y-1">
                      {captureResult.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}

                  {captureResult.drafts.length > 1 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                        <Layers3 size={14} />
                        已识别 {captureResult.drafts.length} 条草稿
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {captureResult.drafts.map((draft, index) => (
                          <button
                            key={`${draft.draft.name}-${index}`}
                            onClick={() => setSelectedDraftIndex(index)}
                            className={`text-left p-3 rounded-[var(--radius-md)] border transition-colors duration-200 ${
                              index === selectedDraftIndex
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                                : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                            }`}
                          >
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">
                              {index + 1}. {draft.draft.name || '未命名记录'}
                            </div>
                            <div className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">
                              {draft.draft.account || draft.draft.address || '待补充账号或地址'}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedDraft.warnings.length ? (
                    <div className="p-3 rounded-[var(--radius-md)] bg-[rgba(255,149,0,0.12)] text-sm text-[var(--color-text-primary)] space-y-1">
                      {selectedDraft.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}

                  {selectedDraft.draft.reasoning ? (
                    <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text-secondary)]">
                      {selectedDraft.draft.reasoning}
                    </div>
                  ) : null}

                  <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-3">
                    <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">来源片段</div>
                    <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-text-primary)] font-[inherit]">{selectedDraft.rawText}</pre>
                  </div>

                  <Field label="名称">
                    <input value={selectedDraft.draft.name} onChange={(event) => updateSelectedDraft({ name: event.target.value })} className={inputClassName} />
                  </Field>
                  <Field label="分类">
                    <select value={selectedDraft.draft.categoryId} onChange={(event) => updateSelectedDraft({ categoryId: event.target.value })} className={inputClassName}>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name} {category.icon}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="地址">
                    <input value={selectedDraft.draft.address || ''} onChange={(event) => updateSelectedDraft({ address: event.target.value })} className={inputClassName} />
                  </Field>
                  <Field label="账号">
                    <input value={selectedDraft.draft.account || ''} onChange={(event) => updateSelectedDraft({ account: event.target.value })} className={inputClassName} />
                  </Field>
                  <Field label="密码">
                    <input value={selectedDraft.draft.password || ''} onChange={(event) => updateSelectedDraft({ password: event.target.value })} className={`${inputClassName} font-mono`} />
                  </Field>
                  <Field label="Key">
                    <input value={selectedDraft.draft.key || ''} onChange={(event) => updateSelectedDraft({ key: event.target.value })} className={`${inputClassName} font-mono`} />
                  </Field>

                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-primary)] mb-2">自定义字段</div>
                    {selectedDraft.draft.customFields.length ? (
                      <div className="space-y-2">
                        {selectedDraft.draft.customFields.map((field, index) => (
                          <div key={`${field.fieldName}-${index}`} className="grid grid-cols-2 gap-2">
                            <input
                              value={field.fieldName}
                              onChange={(event) => updateCustomField(index, event.target.value, field.fieldValue || '')}
                              className={inputClassName}
                              placeholder="字段名"
                            />
                            <input
                              value={field.fieldValue || ''}
                              onChange={(event) => updateCustomField(index, field.fieldName, event.target.value)}
                              className={inputClassName}
                              placeholder="字段值"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-tertiary)]">
                        当前草稿没有额外字段。
                      </div>
                    )}
                  </div>
                </div>

                <SmartCaptureActionBar
                  draftCount={captureResult.drafts.length}
                  isSaving={isSaving}
                  onSaveCurrent={saveSelectedDraft}
                  onSaveAll={saveAllDrafts}
                />
              </>
            ) : (
              <div className="h-full min-h-[320px] flex items-center justify-center text-sm text-[var(--color-text-tertiary)] px-6 text-center leading-6">
                先在左侧粘贴文本并解析，右侧会展示一条或多条可编辑草稿。账号、密码、Key 等敏感值在本地提取和保管，模型只接触脱敏后的结构化信息。
              </div>
            )}
          </section>
        </div>
      </div>
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
  disabled:opacity-60
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
  disabled:opacity-60
`;

const SmartCaptureActionBar = ({
  draftCount,
  isSaving,
  onSaveCurrent,
  onSaveAll,
}: {
  draftCount: number;
  isSaving: boolean;
  onSaveCurrent: () => void;
  onSaveAll: () => void;
}) => (
  <div className="shrink-0 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {draftCount > 1 ? `当前有 ${draftCount} 条草稿待保存` : '当前有 1 条草稿待保存'}
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={onSaveCurrent} className={primaryButtonClassName} disabled={isSaving}>
          <Check size={14} />
          {isSaving ? '保存中...' : '保存当前记录'}
        </button>
        {draftCount > 1 ? (
          <button onClick={onSaveAll} className={secondaryButtonClassName} disabled={isSaving}>
            <Layers3 size={14} />
            {isSaving ? '批量保存中...' : `批量保存全部 ${draftCount} 条`}
          </button>
        ) : null}
      </div>
    </div>
  </div>
);

export default SmartCaptureModal;
