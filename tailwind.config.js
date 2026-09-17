/**
 * Tailwind 3, matching the CDN build the app used to load from
 * `cdn.tailwindcss.com` — that script is a development convenience Tailwind
 * explicitly tells you not to ship, and it cost every visitor a
 * render-blocking download before a single class resolved. Staying on 3 rather
 * than jumping to 4 keeps every existing class name meaning exactly what it
 * means today, so this migration doesn't quietly restyle six large components.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/react-app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
