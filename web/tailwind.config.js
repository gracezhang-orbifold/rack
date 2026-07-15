/** @type {import('tailwindcss').Config} */
// Semantic colors resolve to the CSS-variable tokens in src/index.css; the
// dark/light theme flips by swapping variable values (no dark: prefixes).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        edge: token("edge"),
        text: token("text"),
        muted: token("muted"),
        primary: token("primary"),
        "primary-soft": token("primary-soft"),
        "primary-strong": token("primary-strong"),
        "on-primary": token("on-primary"),
        success: token("success"),
        danger: token("danger"),
        warning: token("warning"),
      },
      fontFamily: {
        display: ['"Archivo Variable"', "system-ui", "sans-serif"],
      },
      keyframes: {
        "sheet-up": {
          from: { transform: "translateY(24px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "modal-in": {
          from: { transform: "scale(0.96)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        "fade-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "sheet-up": "sheet-up 0.22s ease-out",
        "modal-in": "modal-in 0.18s ease-out",
        "fade-up": "fade-up 0.3s ease-out both",
        "fade-in": "fade-in 0.15s ease-out",
      },
    },
  },
  plugins: [],
};
