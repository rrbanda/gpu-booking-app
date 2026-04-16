/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        rh: {
          red: {
            10: '#FCE3E3',
            20: '#FBC5C5',
            30: '#F9A8A8',
            40: '#F56E6E',
            50: '#EE0000',
            60: '#A60000',
            70: '#5F0000',
            80: '#3F0000',
          },
          gray: {
            10: '#F2F2F2',
            20: '#E0E0E0',
            30: '#C7C7C7',
            40: '#A3A3A3',
            50: '#707070',
            60: '#4D4D4D',
            70: '#383838',
            80: '#292929',
            90: '#1F1F1F',
            95: '#151515',
          },
        },
      },
      fontFamily: {
        'rh-display': ['"Red Hat Display"', 'sans-serif'],
        'rh-text': ['"Red Hat Text"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
