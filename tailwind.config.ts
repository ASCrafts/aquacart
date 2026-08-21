import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* Marine Modern Palette */
        'aq-primary': '#0050cb',
        'aq-primary-container': '#0066ff',
        'aq-primary-fixed': '#dae1ff',
        'aq-primary-fixed-dim': '#b3c5ff',
        'aq-on-primary': '#ffffff',
        'aq-secondary': '#425ca0',
        'aq-secondary-container': '#9bb4fe',
        'aq-tertiary': '#006653',
        'aq-tertiary-container': '#00816a',
        'aq-tertiary-fixed': '#5ffbd6',
        'aq-tertiary-fixed-dim': '#38debb',
        'aq-error': '#ba1a1a',
        'aq-error-container': '#ffdad6',
        'aq-surface': '#f7f9fe',
        'aq-surface-bright': '#f7f9fe',
        'aq-surface-dim': '#d8dadf',
        'aq-surface-container': '#eceef3',
        'aq-surface-container-low': '#f1f4f9',
        'aq-surface-container-high': '#e6e8ed',
        'aq-surface-container-highest': '#e0e2e7',
        'aq-surface-container-lowest': '#ffffff',
        'aq-on-surface': '#181c20',
        'aq-on-surface-variant': '#424656',
        'aq-outline': '#727687',
        'aq-outline-variant': '#c2c6d8',

        /* Shadcn compatibility tokens */
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
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },

      fontFamily: {
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
      },

      boxShadow: {
        'aq-sm': '0px 1px 3px rgba(24, 28, 32, 0.06)',
        'aq-md': '0px 4px 12px rgba(24, 28, 32, 0.06)',
        'aq-lg': '0px 12px 32px rgba(24, 28, 32, 0.08)',
        'aq-xl': '0px 20px 40px rgba(24, 28, 32, 0.04)',
        'aq-hover': '0px 8px 24px rgba(0, 80, 203, 0.12)',
        'aq-button': '0 4px 14px rgba(0, 80, 203, 0.25)',
      },

      backgroundImage: {
        'aq-gradient-primary': 'linear-gradient(135deg, #0050cb 0%, #0066ff 100%)',
        'aq-gradient-hero': 'linear-gradient(135deg, #0050cb 0%, #00816a 100%)',
        'aq-gradient-teal': 'linear-gradient(135deg, #006653 0%, #00C9A7 100%)',
        'aq-gradient-card': 'linear-gradient(135deg, #0066ff 0%, #38debb 100%)',
      },

      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '88': '22rem',
      },

      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        /* Directional mount animations — CSS replacements for what
           framer-motion used to do on the product detail panes. */
        'fade-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in-right': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        /* Organic "picture morph": left edge of the hero photo breathes. */
        morph: {
          '0%, 100%': { borderRadius: '58% 0 0 58% / 50% 0 0 50%' },
          '50%': { borderRadius: '48% 0 0 66% / 42% 0 0 58%' },
        },
      },

      animation: {
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fade-in 0.4s ease forwards',
        'fade-in-left': 'fade-in-left 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in-right': 'fade-in-right 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up': 'slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'bounce-subtle': 'bounce-subtle 0.4s ease',
        morph: 'morph 12s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;