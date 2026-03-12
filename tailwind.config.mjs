/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 背景色
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-card': 'var(--bg-card)',
        'bg-card-hover': 'var(--bg-card-hover)',
        
        // 文字色
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-inverse': 'var(--text-inverse)',
        
        // 边框色
        'border-primary': 'var(--border-primary)',
        'border-secondary': 'var(--border-secondary)',
        'border-focus': 'var(--border-focus)',
        
        // 品牌色
        'accent-primary': 'var(--accent-primary)',
        'accent-hover': 'var(--accent-hover)',
        'accent-light': 'var(--accent-light)',
        
        // 状态色
        'success': 'var(--success)',
        'warning': 'var(--warning)',
        'error': 'var(--error)',
        
        // 分类颜色
        'category-game-dev': 'var(--category-game-dev)',
        'category-ai-tools': 'var(--category-ai-tools)',
        'category-life': 'var(--category-life)',
        'category-daily': 'var(--category-daily)',
        'category-work': 'var(--category-work)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['SF Mono', 'SFMono-Regular', 'ui-monospace', 'Menlo', 'Monaco', 'Cascadia Mono', 'monospace'],
      },
      fontSize: {
        'xs': '11px',
        'sm': '13px',
        'base': '15px',
        'lg': '17px',
        'xl': '20px',
        '2xl': '24px',
        '3xl': '28px',
        '4xl': '34px',
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
      },
      borderRadius: {
        'sm': '6px',
        'md': '10px',
        'lg': '14px',
        'xl': '20px',
        '2xl': '28px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'md': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
        'xl': '0 12px 40px rgba(0, 0, 0, 0.16)',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        'apple-spring': 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      backdropBlur: {
        'xs': '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.23, 1, 0.32, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
