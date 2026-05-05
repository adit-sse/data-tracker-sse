/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        coverage: {
          full: '#22c55e',      // green-500
          high: '#eab308',      // yellow-500
          medium: '#f97316',    // orange-500
          low: '#ef4444',       // red-500
          none: '#9ca3af',      // gray-400
        },
      },
    },
  },
  plugins: [],
}
