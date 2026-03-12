import { Copy, FileText } from 'lucide-react';
import { Record as RecordType, useStore } from '../store';
import RecordCard from './RecordCard';

interface RecordGridProps {
  records: RecordType[];
}

const categoryColors: Record<string, string> = {
  'game-dev': 'var(--color-game)',
  'ai-tools': 'var(--color-ai)',
  life: 'var(--color-life)',
  daily: 'var(--color-daily)',
  work: 'var(--color-work)',
};

const RecordGrid = ({ records }: RecordGridProps) => {
  const { categories, openRecordModal, viewMode, showToast } = useStore();

  const copyToClipboard = async (text: string, label: string, event: React.MouseEvent) => {
    event.stopPropagation();
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

  const getCategoryStyle = (categoryId: string) => {
    const color = categoryColors[categoryId] || 'var(--color-text-secondary)';
    return {
      backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
      color,
    };
  };

  if (records.length === 0) {
    return (
      <div className="empty-state h-full">
        <FileText size={64} className="text-[var(--color-text-tertiary)] opacity-50" />
        <h3 className="text-lg font-medium text-[var(--color-text-secondary)] mt-4">暂无记录</h3>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">点击“新建记录”或“智能录入”添加您的第一条记录</p>
        <button
          onClick={() => openRecordModal()}
          className="mt-4 px-4 py-2 bg-[var(--color-accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--color-accent-hover)] transition-colors duration-200 text-sm font-medium"
        >
          新建记录
        </button>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="compact-list">
        {records.map((record) => {
          const category = categories.find((item) => item.id === record.categoryId);
          return (
            <div key={record.id} className="compact-item list-item-animated" onClick={() => openRecordModal(record)}>
              <div
                className="compact-item-icon"
                style={{ backgroundColor: `color-mix(in srgb, ${categoryColors[record.categoryId] || 'var(--color-text-tertiary)'} 20%, transparent)` }}
              >
                <span style={{ color: categoryColors[record.categoryId] || 'var(--color-text-secondary)' }}>
                  {category?.icon || '📝'}
                </span>
              </div>
              <div className="compact-item-name">{record.name}</div>
              <div className="compact-item-account">{record.account || '-'}</div>
              <span className="compact-item-category" style={getCategoryStyle(record.categoryId)}>
                {category?.name || '未分类'}
              </span>
              <div className="compact-item-actions">
                {record.account ? (
                  <button
                    onClick={(event) => copyToClipboard(record.account!, '账号', event)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <Copy size={14} className="text-[var(--color-text-tertiary)]" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (viewMode === 'detail') {
    return (
      <div className="detail-cards">
        {records.map((record) => {
          const category = categories.find((item) => item.id === record.categoryId);
          return (
            <div key={record.id} className="detail-card list-item-animated" onClick={() => openRecordModal(record)}>
              <div className="detail-card-header">
                <div
                  className="detail-card-icon"
                  style={{ backgroundColor: `color-mix(in srgb, ${categoryColors[record.categoryId] || 'var(--color-text-tertiary)'} 20%, transparent)` }}
                >
                  <span style={{ color: categoryColors[record.categoryId] || 'var(--color-text-secondary)' }}>
                    {category?.icon || '📝'}
                  </span>
                </div>
                <div className="detail-card-title">
                  <h3>{record.name}</h3>
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs" style={getCategoryStyle(record.categoryId)}>
                    {category?.name || '未分类'}
                  </span>
                </div>
              </div>
              {record.address ? <DetailRow label="网址" value={record.address} /> : null}
              {record.account ? <DetailRow label="账号" value={record.account} /> : null}
              {record.password ? <DetailRow label="密码" value="••••••••" /> : null}
              {record.customFields.slice(0, 3).map((field) => (
                <DetailRow key={field.id} label={field.fieldName} value={field.fieldValue || '-'} />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (viewMode === 'table') {
    return (
      <table className="table-view">
        <thead className="table-header">
          <tr>
            <th>名称</th>
            <th>账号</th>
            <th>网址</th>
            <th>分类</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const category = categories.find((item) => item.id === record.categoryId);
            return (
              <tr key={record.id} className="table-row list-item-animated" onClick={() => openRecordModal(record)}>
                <td>
                  <div className="flex items-center gap-2">
                    <span>{category?.icon || '📝'}</span>
                    <span className="font-medium">{record.name}</span>
                  </div>
                </td>
                <td>{record.account || '-'}</td>
                <td>{record.address || '-'}</td>
                <td>
                  <span className="px-2 py-0.5 rounded-full text-xs" style={getCategoryStyle(record.categoryId)}>
                    {category?.name || '未分类'}
                  </span>
                </td>
                <td>{new Date(record.updatedAt).toLocaleDateString('zh-CN')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="bento-grid">
      {records.map((record) => (
        <RecordCard key={record.id} record={record} />
      ))}
    </div>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="detail-row">
    <span className="detail-row-label">{label}</span>
    <span className="detail-row-value">{value}</span>
  </div>
);

export default RecordGrid;
