/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#05050A',
        surface: 'rgba(255,255,255,0.04)',
        border:  'rgba(255,255,255,0.08)',
        primary: '#7C3AED',
        accent:  '#22D3EE',
        muted:   '#64748B',
        dimmed:  '#475569',
        faint:   '#334155',
      },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      backgroundImage: {
        'grad-primary': 'linear-gradient(135deg,#7C3AED,#22D3EE)',
      },
    },
  },
  plugins: [],
};
