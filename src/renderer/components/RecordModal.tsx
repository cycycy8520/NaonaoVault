import { useEffect, useState, type ReactNode } from 'react';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useStore, CustomField } from '../store';
import { normalizeRecord } from '../lib/contracts';

interface FormData {
  name: string;
  categoryId: string;
  address: string;
  account: string;
  password: string;
  key: string;
  customFields: CustomField[];
}

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

const emptyField = (): CustomField => ({
  id: `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  recordId: '',
  fieldName: '',
  fieldValue: '',
  fieldType: 'text',
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedByDeviceId: '',
});

const RecordModal = () => {
  const {
    categories,
    selectedRecord,
    closeRecordModal,
    addRecord,
    updateRecord,
    showToast,
  } = useStore();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    categoryId: '',
    address: '',
    account: '',
    password: '',
    key: '',
    customFields: [],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);

  const isEditing = Boolean(selectedRecord);

  useEffect(() => {
    if (selectedRecord) {
      setFormData({
        name: selectedRecord.name,
        categoryId: selectedRecord.categoryId,
        address: selectedRecord.address || '',
        account: selectedRecord.account || '',
        password: selectedRecord.password || '',
        key: selectedRecord.key || '',
        customFields: selectedRecord.customFields || [],
      });
      return;
    }

    setFormData({
      name: '',
      categoryId: categories[0]?.id || '',
      address: '',
      account: '',
      password: '',
      key: '',
      customFields: [],
    });
  }, [selectedRecord, categories]);

  useEffect(() => {
    if (!formData.password) {
      setPasswordStrength(null);
      return;
    }

    let active = true;
    window.api.calculateStrength(formData.password)
      .then((strength) => {
        if (active) {
          setPasswordStrength(strength);
        }
      })
      .catch(() => {
        if (active) {
          setPasswordStrength(null);
        }
      });

    return () => {
      active = false;
    };
  }, [formData.password]);

  const generatePassword = async () => {
    setIsGenerating(true);
    try {
      const result = await window.api.generatePassword(16);
      if (!result.success || !result.password) {
        throw new Error(result.error || '生成密码失败');
      }
      setFormData((state) => ({ ...state, password: result.password! }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '生成密码失败', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const addCustomField = () => {
    setFormData((state) => ({
      ...state,
      customFields: [
        ...state.customFields,
        {
          ...emptyField(),
          sortOrder: state.customFields.length,
        },
      ],
    }));
  };

  const updateCustomField = (index: number, patch: Partial<CustomField>) => {
    setFormData((state) => ({
      ...state,
      customFields: state.customFields.map((field, fieldIndex) => (
        fieldIndex === index
          ? { ...field, ...patch, updatedAt: new Date().toISOString() }
          : field
      )),
    }));
  };

  const removeCustomField = (index: number) => {
    setFormData((state) => ({
      ...state,
      customFields: state.customFields
        .filter((_, fieldIndex) => fieldIndex !== index)
        .map((field, fieldIndex) => ({ ...field, sortOrder: fieldIndex })),
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.name.trim()) {
      showToast('请输入记录名称', 'error');
      return;
    }

    try {
      const payload = {
        id: selectedRecord?.id,
        name: formData.name.trim(),
        categoryId: formData.categoryId,
        address: formData.address.trim(),
        account: formData.account.trim(),
        password: formData.password,
        key: formData.key,
        favorite: selectedRecord?.favorite ?? false,
        customFields: formData.customFields
          .filter((field) => field.fieldName.trim())
          .map((field, index) => ({
            id: field.id.startsWith('temp-') ? undefined : field.id,
            fieldName: field.fieldName.trim(),
            fieldValue: field.fieldValue || '',
            fieldType: field.fieldType || 'text',
            sortOrder: index,
          })),
      };

      const response = isEditing
        ? await window.api.updateRecord(payload)
        : await window.api.createRecord(payload);

      if (!response.success || !response.record) {
        throw new Error(response.error || '保存失败');
      }

      const normalized = normalizeRecord(response.record);
      if (isEditing) {
        updateRecord(normalized);
        showToast('记录已更新', 'success');
      } else {
        addRecord(normalized);
        showToast('记录已创建', 'success');
      }
      closeRecordModal();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="
          w-full max-w-2xl max-h-[90vh]
          bg-[var(--color-bg-elevated)]
          rounded-[var(--radius-xl)]
          shadow-[var(--shadow-xl)]
          overflow-hidden
          animate-scaleIn
        "
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {isEditing ? '编辑记录' : '新建记录'}
          </h2>
          <button
            onClick={closeRecordModal}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
          >
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-2 gap-4">
            <Field label="名称" required>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => setFormData((state) => ({ ...state, name: event.target.value }))}
                placeholder="输入记录名称"
                className={inputClassName}
              />
            </Field>

            <Field label="分类">
              <select
                value={formData.categoryId}
                onChange={(event) => setFormData((state) => ({ ...state, categoryId: event.target.value }))}
                className={inputClassName}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} {category.icon}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="地址" className="col-span-2">
              <input
                type="text"
                value={formData.address}
                onChange={(event) => setFormData((state) => ({ ...state, address: event.target.value }))}
                placeholder="网址或地址"
                className={inputClassName}
              />
            </Field>

            <Field label="账号">
              <input
                type="text"
                value={formData.account}
                onChange={(event) => setFormData((state) => ({ ...state, account: event.target.value }))}
                placeholder="用户名或邮箱"
                className={inputClassName}
              />
            </Field>

            <Field label="密码">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(event) => setFormData((state) => ({ ...state, password: event.target.value }))}
                      placeholder="密码"
                      className={`${inputClassName} pr-12 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-secondary)]"
                    >
                      {showPassword ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={generatePassword}
                    disabled={isGenerating}
                    className="h-10 px-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-[var(--radius-md)] hover:border-[var(--color-border-hover)] transition-colors duration-200 disabled:opacity-50"
                  >
                    <RefreshCw size={16} className={`${isGenerating ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {passwordStrength ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-text-secondary)]">密码强度</span>
                      <span style={{ color: passwordStrength.color }}>{passwordStrength.label}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
                      <div
                        className="h-full transition-all duration-200"
                        style={{
                          width: `${Math.max(1, passwordStrength.score) / 7 * 100}%`,
                          backgroundColor: passwordStrength.color,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </Field>

            <Field label="Key" className="col-span-2">
              <input
                type="text"
                value={formData.key}
                onChange={(event) => setFormData((state) => ({ ...state, key: event.target.value }))}
                placeholder="API Key 或其他密钥"
                className={`${inputClassName} font-mono`}
              />
            </Field>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">自定义字段</label>
              <button
                type="button"
                onClick={addCustomField}
                className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors duration-200"
              >
                <Plus size={14} />
                添加字段
              </button>
            </div>

            {formData.customFields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
                <input
                  type="text"
                  value={field.fieldName}
                  onChange={(event) => updateCustomField(index, { fieldName: event.target.value })}
                  placeholder="字段名称"
                  className={smallInputClassName}
                />
                <input
                  type="text"
                  value={field.fieldValue || ''}
                  onChange={(event) => updateCustomField(index, { fieldValue: event.target.value })}
                  placeholder="字段值"
                  className={smallInputClassName}
                />
                <button
                  type="button"
                  onClick={() => removeCustomField(index)}
                  className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
                >
                  <Trash2 size={14} className="text-[var(--color-error)]" />
                </button>
              </div>
            ))}
          </div>
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={closeRecordModal}
            className="px-4 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-[var(--color-accent-hover)] transition-colors duration-200"
          >
            {isEditing ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
};

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

const smallInputClassName = `
  h-9 px-2
  bg-[var(--color-bg-secondary)]
  border border-[var(--color-border)]
  rounded-[var(--radius-sm)]
  text-xs text-[var(--color-text-primary)]
  placeholder:text-[var(--color-text-tertiary)]
  focus:border-[var(--color-accent)]
  transition-colors duration-200
`;

const Field = ({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div className={className}>
    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
      {label} {required ? <span className="text-[var(--color-error)]">*</span> : null}
    </label>
    {children}
  </div>
);

export default RecordModal;
