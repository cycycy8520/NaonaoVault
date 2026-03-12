import { useState } from 'react'
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'

interface InitScreenProps {
  onInit: () => void
}

const InitScreen = ({ onInit }: InitScreenProps) => {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // Password strength indicators
  const hasMinLength = password.length >= 8
  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password)
  
  const strengthCount = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length
  
  const getStrengthLabel = () => {
    if (strengthCount <= 2) return { label: '弱', color: 'var(--color-error)' }
    if (strengthCount <= 3) return { label: '中等', color: 'var(--color-warning)' }
    return { label: '强', color: 'var(--color-success)' }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!password) {
      setError('请输入密码')
      return
    }
    
    if (strengthCount < 3) {
      setError('密码强度不足')
      return
    }
    
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    
    setIsLoading(true)
    
    try {
      const result = await window.api.initVault(password)
      
      if (result.success) {
        await window.api.setSetting('vaultInitialized', true)
        onInit()
      } else {
        setError(result.error || '初始化失败')
      }
    } catch (err: any) {
      console.error('Init error:', err);
      setError(err?.message || '初始化失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg-secondary)]">
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
            创建主密码以保护您的数据
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2 leading-5">
            AI 功能只接收经过去敏处理的名称、分类、地址域名和字段标签等结构化信息，账号、密码、Key 等敏感值始终留在本地保险库。
          </p>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Password */}
          <div className="relative mb-3">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder="设置密码"
              autoFocus
              className="
                w-full h-11 px-4 pr-10
                bg-[var(--color-bg-secondary)]
                border border-[var(--color-border)]
                rounded-[var(--radius-md)]
                text-sm text-[var(--color-text-primary)]
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
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          
          {/* Password Strength */}
          {password && (
            <div className="mb-3 px-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-1 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                  <div 
                    className="h-full transition-all duration-300"
                    style={{ 
                      width: `${(strengthCount / 5) * 100}%`,
                      backgroundColor: getStrengthLabel().color
                    }}
                  />
                </div>
                <span 
                  className="text-xs"
                  style={{ color: getStrengthLabel().color }}
                >
                  {getStrengthLabel().label}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div className={`flex items-center gap-1 ${hasMinLength ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  <CheckCircle size={12} />
                  <span>至少8个字符</span>
                </div>
                <div className={`flex items-center gap-1 ${hasUppercase ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  <CheckCircle size={12} />
                  <span>大写字母</span>
                </div>
                <div className={`flex items-center gap-1 ${hasLowercase ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  <CheckCircle size={12} />
                  <span>小写字母</span>
                </div>
                <div className={`flex items-center gap-1 ${hasNumber ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  <CheckCircle size={12} />
                  <span>数字</span>
                </div>
                <div className={`flex items-center gap-1 ${hasSpecial ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  <CheckCircle size={12} />
                  <span>特殊字符</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Confirm Password */}
          <div className="relative mb-4">
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setError('')
              }}
              placeholder="确认密码"
              className="
                w-full h-11 px-4 pr-10
                bg-[var(--color-bg-secondary)]
                border border-[var(--color-border)]
                rounded-[var(--radius-md)]
                text-sm text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:border-[var(--color-accent)]
                transition-colors duration-200
              "
            />
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
              w-full h-11
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
              '创建保险库'
            )}
          </button>
        </form>
        
        {/* Warning */}
        <p className="text-xs text-[var(--color-text-tertiary)] text-center mt-4">
          ⚠️ 请牢记此密码，丢失后将无法恢复数据
        </p>
      </div>
    </div>
  )
}

export default InitScreen
