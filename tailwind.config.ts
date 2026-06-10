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
        display:   ['var(--font-display)', 'var(--font-ui)', 'system-ui', 'sans-serif'],
        editorial: ['var(--font-display)', 'var(--font-ui)', 'system-ui', 'sans-serif'],
        ui:        ['var(--font-ui)', 'system-ui', 'sans-serif'],
        mono:      ['var(--font-mono)', 'ui-monospace', 'monospace'],
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
        // Teal-spark alias (same token as electric) — readable name for the ~4 high-signal spots
        spark:   'hsl(var(--electric))',
        // Bone — warm off-white CHROME accent (the default for borders/hover/active/focus)
        bone: {
          DEFAULT: 'hsl(var(--bone))',
          dim:     'hsl(var(--bone-dim))',
          bright:  'hsl(var(--bone-bright))',
        },
        gain:    'hsl(var(--gain))',
        loss:    'hsl(var(--loss))',
        warn:    'hsl(var(--warn))',
        neutral: 'hsl(var(--neutral-text))',
        brand: {
          navy: 'hsl(var(--brand-navy))',
          teal: 'hsl(var(--brand-teal))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
          6: 'hsl(var(--chart-6))',
          7: 'hsl(var(--chart-7))',
          8: 'hsl(var(--chart-8))',
          grid: 'hsl(var(--chart-grid))',
          axis: 'hsl(var(--chart-axis))',
        },
        green: {
          flash: 'hsl(var(--gain) / 0.16)',
        },
        red: {
          flash: 'hsl(var(--loss) / 0.16)',
        },
      },
      borderRadius: {
        xl:   'var(--radius-lg)',
        lg:   'var(--radius)',
        md:   'calc(var(--radius) - 2px)',
        sm:   'calc(var(--radius) - 4px)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        xs:   'var(--shadow-xs)',
        sm:   'var(--shadow-sm)',
        card: 'var(--shadow-card)',
        md:   'var(--shadow-md)',
        pop:  'var(--shadow-pop)',
        glow: 'var(--shadow-glow)',
      },
      keyframes: {
        'flash-green': {
          '0%':   { backgroundColor: 'hsl(var(--gain) / 0.16)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-red': {
          '0%':   { backgroundColor: 'hsl(var(--loss) / 0.16)' },
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
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%':   { boxShadow: '0 0 0 0 hsl(var(--electric) / 0.5)' },
          '70%':  { boxShadow: '0 0 0 8px hsl(var(--electric) / 0)' },
          '100%': { boxShadow: '0 0 0 0 hsl(var(--electric) / 0)' },
        },
      },
      animation: {
        'flash-green':    'flash-green 1.5s ease-out forwards',
        'flash-red':      'flash-red 1.5s ease-out forwards',
        'marquee':        'marquee 60s linear infinite',
        'marquee-r':      'marquee-reverse 60s linear infinite',
        'fade-in-up':     'fade-in-up 0.4s ease-out both',
        'pulse-ring':     'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
}

export default config
