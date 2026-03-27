/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      colors: {
        bg: '#FAF8F5',
        surface: '#FFFFFF',
        primary: '#1A1A2E',
        accent: '#FF6B35',
        'accent-soft': '#FFF0EB',
        muted: '#8B8B9A',
        border: '#EBEBF0',
        success: '#22C55E',
      },
    },
  },
  plugins: [],
}
