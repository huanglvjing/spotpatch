import type { Config } from "tailwindcss";

export default {
  content: {
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
    relative: true,
  },
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
