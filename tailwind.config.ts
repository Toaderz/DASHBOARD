import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        editorial: ['var(--font-editorial)', 'Georgia', 'serif'],
        ui:        ['var(--font-ui)', 'Inter', 'sans-serif'],
        mono:      ['var(--font-mono)', 'Menlo', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',
        ink: {
          void:     'hsl(var(--ink-void))',
          dark:     'hsl(var(--ink-dark))',
          base:     'hsl(var(--ink-base))',
          surface:  'hsl(var(--ink-surface))',
          elevated: 'hsl(var(--ink-elevated))',
          overlay:  'hsl(var(--ink-overlay))',
        },
        electric: {
          DEFAULT: 'hsl(var(--electric))',
          dim:     'hsl(var(--electric-dim))',
          bright:  'hsl(var(--electric-bright))',
        },
        gain:    'hsl(var(--gain))',
        loss:    'hsl(var(--loss))',
        neutral: 'hsl(var(--neutral-text))',
        green: {
          flash: 'rgba(34,197,94,0.2)',
        },
        red: {
          flash: 'rgba(239,68,68,0.2)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'flash-green': {
          '0%':   { backgroundColor: 'rgba(34,197,94,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-red': {
          '0%':   { backgroundColor: 'rgba(239,68,68,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'marquee-reverse': {
          '0%':   { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'flash-green':    'flash-green 1.5s ease-out forwards',
        'flash-red':      'flash-red 1.5s ease-out forwards',
        'marquee':        'marquee 40s linear infinite',
        'marquee-r':      'marquee-reverse 40s linear infinite',
      },
    },
  },
  plugins: [],
}

export default config
