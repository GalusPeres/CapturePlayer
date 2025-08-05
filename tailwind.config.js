/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  safelist: [
    'transform',
    'translate-x-1/2',
    '-translate-x-1/2'
  ],
  theme: {
    extend: {
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(1rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(0)',    opacity: '1' },
          '100%': { transform: 'translateY(1rem)', opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)'    },
        },
        fadeOut: {
          '0%': { opacity: '1', transform: 'scale(1)'    },
          '100%': { opacity: '0', transform: 'scale(0.95)' },
        },
      },
      animation: {
        'slide-up-fast':   'slideUp 200ms ease-out forwards',
        'slide-down-fast': 'slideDown 200ms ease-in forwards',
        'fade-in':         'fadeIn   150ms ease-out forwards',
        'fade-out':        'fadeOut  150ms ease-in forwards',
      },
      scale: {
        '130': '1.3',
        '135': '1.35',
        '140': '1.4',
      },
    },
  },
  plugins: [],
};
