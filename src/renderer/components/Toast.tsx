import { useEffect } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}

const icons = {
  success: <CheckCircle size={18} className="text-[var(--color-success)]" />,
  error: <XCircle size={18} className="text-[var(--color-error)]" />,
  info: <Info size={18} className="text-[var(--color-accent)]" />
}

const Toast = ({ message, type, onClose }: ToastProps) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, 3000)
    
    return () => clearTimeout(timer)
  }, [onClose])
  
  return (
    <div className="toast flex items-center gap-3">
      {icons[type]}
      <span className="text-sm text-[var(--color-text-primary)] whitespace-pre-line">{message}</span>
      <button
        onClick={onClose}
        className="
          w-6 h-6 flex items-center justify-center
          rounded hover:bg-[var(--color-bg-tertiary)]
          transition-colors duration-200
        "
      >
        <X size={14} className="text-[var(--color-text-secondary)]" />
      </button>
    </div>
  )
}

export default Toast
