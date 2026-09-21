import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Svetlana brand palette: calm, human-first, no cyberpunk accents
        svetlana: {
          50: "#f6f4fb",
          100: "#ece7f6",
          200: "#d9d0ee",
          300: "#bca9e0",
          400: "#9c7fce",
          500: "#7d5cb0",
          600: "#654493",
          700: "#523577",
          800: "#432c61",
          900: "#38244e",
        },
        accent: {
          DEFAULT: "#e8833a",
          dark: "#c96a26",
        },
        ink: {
          DEFAULT: "#1e1b2e",
          soft: "#5b5670",
          faint: "#9a95ad",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f7f6fa",
          line: "#e6e3ef",
        },
        ok: "#1f9d55",
        warn: "#d97706",
        bad: "#dc2626",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(30 27 46 / 0.08), 0 1px 2px -1px rgb(30 27 46 / 0.08)",
        float: "0 8px 28px -8px rgb(30 27 46 / 0.18)",
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
