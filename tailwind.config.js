/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        // Replace just one shade of red
        'red': {
          '500': '#ff0000', // Your custom color
          // Define other shades if necessary
        },
        'yellow': {
          '500': '#ff0', // Your custom color
        },
        'green': {
          '500': '#0f0', // Your custom color
        },
      },
    },
  },
  plugins: [],
};
