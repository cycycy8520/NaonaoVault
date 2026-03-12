import { AlertTriangle } from 'lucide-react'
import { useStore } from '../store'

const DeleteConfirm = () => {
  const {
    selectedRecord,
    closeDeleteConfirm,
    deleteRecord,
    showToast
  } = useStore()
  
  if (!selectedRecord) return null
  
  const handleDelete = async () => {
    try {
      const result = await window.api.deleteRecord(selectedRecord.id)
      if (!result.success) {
        throw new Error(result.error || '删除失败')
      }
      deleteRecord(selectedRecord.id)
      showToast('记录已删除', 'success')
      closeDeleteConfirm()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }
  
  return (
    <div className="modal-overlay" onClick={closeDeleteConfirm}>
      <div 
        className="
          w-full max-w-sm
          bg-[var(--color-bg-elevated)]
          rounded-[var(--radius-xl)]
          shadow-[var(--shadow-xl)]
          overflow-hidden
          animate-scaleIn
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Content */}
        <div className="p-6 text-center">
          <div 
            className="
              w-12 h-12 mx-auto mb-4
              flex items-center justify-center
              rounded-full
              bg-[rgba(255,59,48,0.1)]
            "
          >
            <AlertTriangle size={24} className="text-[var(--color-error)]" />
          </div>
          
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            确认删除
          </h3>
          
          <p className="text-sm text-[var(--color-text-secondary)]">
            确定要删除记录「{selectedRecord.name}」吗？此操作无法撤销。
          </p>
        </div>
        
        {/* Actions */}
        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={closeDeleteConfirm}
            className="
              flex-1 py-3
              text-sm text-[var(--color-text-primary)]
              hover:bg-[var(--color-bg-secondary)]
              transition-colors duration-200
              border-r border-[var(--color-border)]
            "
          >
            取消
          </button>
          <button
            onClick={handleDelete}
            className="
              flex-1 py-3
              text-sm font-medium text-[var(--color-error)]
              hover:bg-[var(--color-bg-secondary)]
              transition-colors duration-200
            "
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteConfirm
