import { Minus, Square, X } from 'lucide-react'

const TitleBar = () => {
  const handleMinimize = async () => {
    await window.api.minimizeWindow()
  }

  const handleMaximize = async () => {
    await window.api.maximizeWindow()
  }

  const handleClose = async () => {
    await window.api.closeWindow()
  }

  return (
    <div className="title-bar h-7 flex items-center justify-between px-3 bg-[var(--color-bg-primary)] border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-[var(--color-accent)] flex items-center justify-center">
          <svg 
            width="10" 
            height="10" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="white" 
            strokeWidth="2.5"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          NaonaoVault
        </span>
      </div>
      
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleMinimize}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
          aria-label="最小化"
        >
          <Minus size={12} className="text-[var(--color-text-secondary)]" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
          aria-label="最大化"
        >
          <Square size={10} className="text-[var(--color-text-secondary)]" />
        </button>
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-error)] hover:text-white transition-colors group"
          aria-label="关闭"
        >
          <X size={12} className="text-[var(--color-text-secondary)] group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
