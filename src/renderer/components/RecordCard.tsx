import { useState, type ReactNode } from 'react';
import {
  Clock,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { Record as RecordType, useStore } from '../store';

interface RecordCardProps {
  record: RecordType;
}

const categoryBadges: Record<string, string> = {
  'game-dev': 'badge-game',
  'ai-tools': 'badge-ai',
  life: 'badge-life',
  daily: 'badge-daily',
  work: 'badge-work',
};

const RecordCard = ({ record }: RecordCardProps) => {
  const { categories, openDeleteConfirm, openRecordModal, showToast } = useStore();
  const [showSecret, setShowSecret] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const category = categories.find((item) => item.id === record.categoryId);
  const categoryBadge = categoryBadges[record.categoryId] || '';

  const copyToClipboard = async (text: string, label: string) => {
    try {
      const result = await window.api.copySensitiveToClipboard(text);
      if (!result.success) {
        throw new Error(result.error || '复制失败');
      }
      showToast(`${label}已复制`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '复制失败', 'error');
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const openUrl = (url: string) => {
    void (async () => {
      try {
        const result = await window.api.openExternal(url);
        if (!result.success) {
          throw new Error(result.error || '打开链接失败');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '打开链接失败', 'error');
      }
    })();
  };

  const maskSecret = (value: string) => '•'.repeat(Math.min(value.length || 8, 12));

  return (
    <div className="card p-4 cursor-pointer hover:scale-[1.02] transition-transform duration-200" onClick={() => openRecordModal(record)}>
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1 pr-2">
          <h3 className="font-semibold text-[var(--color-text-primary)] truncate">{record.name}</h3>
          {category ? (
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs ${categoryBadge}`}>
              {category.name} {category.icon}
            </span>
          ) : null}
        </div>

        <div className="relative">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowMenu((value) => !value);
            }}
            className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
          >
            <MoreVertical size={16} className="text-[var(--color-text-secondary)]" />
          </button>

          {showMenu ? (
            <div
              className="absolute right-0 top-full mt-1 w-32 py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] z-10 animate-scaleIn"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={() => {
                  openRecordModal(record);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors duration-150"
              >
                <Edit2 size={14} />
                编辑
              </button>
              <button
                onClick={() => {
                  openDeleteConfirm(record);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-error)] hover:bg-[var(--color-bg-secondary)] transition-colors duration-150"
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {record.address ? (
          <FieldRow label="地址" value={record.address}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                openUrl(record.address!);
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
              title="打开链接"
            >
              <ExternalLink size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </FieldRow>
        ) : null}

        {record.account ? (
          <FieldRow label="账号" value={record.account}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                copyToClipboard(record.account!, '账号');
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
              title="复制账号"
            >
              <Copy size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </FieldRow>
        ) : null}

        {record.password ? (
          <FieldRow label="密码" value={showSecret ? record.password : maskSecret(record.password)} mono>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowSecret((value) => !value);
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
              title={showSecret ? '隐藏密码' : '显示密码'}
            >
              {showSecret ? <EyeOff size={12} className="text-[var(--color-text-secondary)]" /> : <Eye size={12} className="text-[var(--color-text-secondary)]" />}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                copyToClipboard(record.password!, '密码');
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
              title="复制密码"
            >
              <Copy size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </FieldRow>
        ) : null}

        {record.key ? (
          <FieldRow label="Key" value={showSecret ? record.key : maskSecret(record.key)} mono>
            <button
              onClick={(event) => {
                event.stopPropagation();
                copyToClipboard(record.key!, 'Key');
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
              title="复制 Key"
            >
              <Copy size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </FieldRow>
        ) : null}

        {record.customFields.slice(0, 2).map((field) => (
          <FieldRow key={field.id} label={field.fieldName} value={field.fieldValue || '-'} />
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
          <Clock size={12} />
          <span>更新于 {formatDate(record.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
};

const FieldRow = ({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  children?: ReactNode;
}) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-[var(--color-text-tertiary)] w-12 shrink-0">{label}</span>
    <div className="flex-1 flex items-center gap-1 min-w-0">
      <span className={`text-sm text-[var(--color-text-primary)] truncate flex-1 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
      {children}
    </div>
  </div>
);

export default RecordCard;
