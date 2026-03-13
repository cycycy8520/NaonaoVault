import { useState } from 'react'
import { Lock, Eye, EyeOff, X } from 'lucide-react'

interface UnlockScreenProps {
  onUnlock: () => void
}

const UnlockScreen = ({ onUnlock }: UnlockScreenProps) => {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!password) {
      setError('请输入密码')
      return
    }
    
    setIsLoading(true)
    
    try {
      const result = await window.api.verifyPassword(password)
      
      if (result.valid) {
        onUnlock()
      } else {
        setError(result.error || '密码错误')
      }
    } catch (err) {
      setError('验证失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg-secondary)]">
      <button
        type="button"
        onClick={() => window.api.closeWindow()}
        className="
          absolute top-4 right-4
          w-10 h-10 flex items-center justify-center
          rounded-full
          bg-[var(--color-bg-elevated)]
          border border-[var(--color-border)]
          text-[var(--color-text-secondary)]
          hover:bg-[var(--color-bg-tertiary)]
          hover:text-[var(--color-text-primary)]
          transition-colors duration-200
        "
        aria-label="关闭窗口"
      >
        <X size={18} />
      </button>
      <div 
        className="
          w-full max-w-sm
          p-8
          bg-[var(--color-bg-elevated)]
          rounded-[var(--radius-xl)]
          shadow-[var(--shadow-xl)]
          animate-scaleIn
        "
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div 
            className="
              w-16 h-16 mx-auto mb-4
              flex items-center justify-center
              rounded-full
              bg-[var(--color-accent)]
            "
          >
            <Lock size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            NaonaoVault
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            输入密码解锁保险库
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2 leading-5">
            AI 检索基于去敏后的结构化元数据完成召回和排序，账号、密码、Key 等敏感内容不会发送给模型。
          </p>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="relative mb-4">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder="输入密码"
              autoFocus
              className="
                w-full h-12 px-4 pr-10
                bg-[var(--color-bg-secondary)]
                border border-[var(--color-border)]
                rounded-[var(--radius-md)]
                text-base text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:border-[var(--color-accent)]
                transition-colors duration-200
              "
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="
                absolute right-3 top-1/2 -translate-y-1/2
                text-[var(--color-text-secondary)]
                hover:text-[var(--color-text-primary)]
                transition-colors duration-200
              "
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          
          {error && (
            <p className="text-sm text-[var(--color-error)] mb-4 text-center">
              {error}
            </p>
          )}
          
          <button
            type="submit"
            disabled={isLoading}
            className="
              w-full h-12
              bg-[var(--color-accent)] text-white
              rounded-[var(--radius-md)]
              font-medium
              hover:bg-[var(--color-accent-hover)]
              transition-colors duration-200
              disabled:opacity-50
              flex items-center justify-center
            "
          >
            {isLoading ? (
              <div className="loading-spinner" />
            ) : (
              '解锁'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default UnlockScreen
