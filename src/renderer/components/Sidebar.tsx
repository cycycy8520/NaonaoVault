import {
  Bot,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Home,
  LayoutGrid,
  Plus,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useStore } from '../store';

const categoryIcons: Record<string, ReactNode> = {
  'game-dev': <Gamepad2 size={18} />,
  'ai-tools': <Bot size={18} />,
  life: <Home size={18} />,
  daily: <Calendar size={18} />,
  work: <Briefcase size={18} />,
};

const categoryColors: Record<string, string> = {
  'game-dev': 'var(--color-game)',
  'ai-tools': 'var(--color-ai)',
  life: 'var(--color-life)',
  daily: 'var(--color-daily)',
  work: 'var(--color-work)',
};

const Sidebar = () => {
  const {
    categories,
    records,
    selectedCategoryId,
    isSidebarCollapsed,
    toggleSidebar,
    setSelectedCategory,
    openRecordModal,
  } = useStore();

  const getCount = (categoryId: string | null) => (
    categoryId ? records.filter((record) => record.categoryId === categoryId).length : records.length
  );

  return (
    <aside
      className={`
        sidebar flex flex-col bg-[var(--color-bg-primary)] border-r border-[var(--color-border)]
        transition-all duration-300 ease-in-out
        ${isSidebarCollapsed ? 'w-14' : 'w-56'}
      `}
    >
      <div className="p-3">
        <button
          onClick={() => openRecordModal()}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-all duration-200 font-medium text-sm"
        >
          <Plus size={18} />
          {!isSidebarCollapsed ? <span>新建记录</span> : null}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] transition-all duration-200 mb-1 ${
            selectedCategoryId === null
              ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
          }`}
        >
          <LayoutGrid size={18} />
          {!isSidebarCollapsed ? (
            <>
              <span className="flex-1 text-left text-sm">全部记录</span>
              <span className="text-xs text-[var(--color-text-tertiary)]">{getCount(null)}</span>
            </>
          ) : null}
        </button>

        <div className="h-px bg-[var(--color-border)] my-2" />

        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] transition-all duration-200 mb-1 ${
              selectedCategoryId === category.id
                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
            }`}
          >
            <span style={{ color: categoryColors[category.id] || category.color }}>
              {categoryIcons[category.id] || <LayoutGrid size={18} />}
            </span>
            {!isSidebarCollapsed ? (
              <>
                <span className="flex-1 text-left text-sm">{category.name} {category.icon}</span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{getCount(category.id)}</span>
              </>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="p-2 border-t border-[var(--color-border)]">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors duration-200"
          aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
