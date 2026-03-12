import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  LayoutGrid,
  LayoutList,
  List,
  Lock,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Table,
  X,
} from 'lucide-react';
import { useStore, ViewMode } from '../store';

interface HeaderProps {
  onSearch: (query: string) => void;
  onLockVault?: () => void;
}

const viewModes: { id: ViewMode; icon: ReactNode; label: string }[] = [
  { id: 'bento', icon: <LayoutGrid size={16} />, label: '网格视图' },
  { id: 'list', icon: <List size={16} />, label: '列表视图' },
  { id: 'detail', icon: <LayoutList size={16} />, label: '详情视图' },
  { id: 'table', icon: <Table size={16} />, label: '表格视图' },
];

const Header = ({ onSearch, onLockVault }: HeaderProps) => {
  const {
    searchQuery,
    setSearchQuery,
    isDarkMode,
    toggleDarkMode,
    selectedCategoryId,
    categories,
    viewMode,
    setViewMode,
    openSmartCapture,
    openAssistant,
    openSettingsModal,
  } = useStore();

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentCategory = categories.find((category) => category.id === selectedCategoryId);
  const title = currentCategory ? `${currentCategory.name} ${currentCategory.icon}` : '全部记录';

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== searchQuery) {
        setSearchQuery(localQuery);
        onSearch(localQuery);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [localQuery, onSearch, searchQuery, setSearchQuery]);

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener('secure-vault:focus-search', focusSearch);
    return () => window.removeEventListener('secure-vault:focus-search', focusSearch);
  }, []);

  const handleClearSearch = () => {
    setLocalQuery('');
    setSearchQuery('');
    onSearch('');
    searchInputRef.current?.focus();
  };

  return (
    <header className="header h-14 flex items-center justify-between px-4 gap-4 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-[var(--color-text-primary)] truncate">
          {searchQuery ? `搜索: "${searchQuery}"` : title}
        </h1>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
          本地优先，AI 仅处理脱敏后的元数据和结构信息
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="view-switcher">
          {viewModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              className={`view-switcher-btn ${viewMode === mode.id ? 'active' : ''}`}
              aria-label={mode.label}
              title={mode.label}
            >
              {mode.icon}
            </button>
          ))}
        </div>

        <button onClick={openSmartCapture} className={iconButtonClassName} title="智能录入">
          <Sparkles size={16} />
        </button>
        <button onClick={openAssistant} className={iconButtonClassName} title="AI 助手">
          <Bot size={16} />
        </button>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            ref={searchInputRef}
            type="text"
            value={localQuery}
            onChange={(event) => setLocalQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                handleClearSearch();
              }
            }}
            placeholder="搜索记录..."
            className="w-64 h-9 pl-8 pr-7 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] transition-colors duration-200"
          />
          {localQuery ? (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--color-bg-tertiary)] transition-colors duration-200"
            >
              <X size={12} className="text-[var(--color-text-tertiary)]" />
            </button>
          ) : null}
        </div>

        <button onClick={openSettingsModal} className={iconButtonClassName} title="设置与同步">
          <Settings2 size={16} />
        </button>

        <button
          onClick={onLockVault}
          className={iconButtonClassName}
          title="锁定保险库"
          aria-label="锁定保险库"
        >
          <Lock size={16} />
        </button>

        <button
          onClick={toggleDarkMode}
          className={iconButtonClassName}
          aria-label={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
        >
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
};

const iconButtonClassName = `
  w-9 h-9 flex items-center justify-center
  rounded-[var(--radius-md)]
  bg-[var(--color-bg-primary)]
  border border-[var(--color-border)]
  text-[var(--color-text-secondary)]
  hover:border-[var(--color-border-hover)]
  hover:text-[var(--color-text-primary)]
  transition-colors duration-200
`;

export default Header;
