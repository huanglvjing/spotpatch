import path from "node:path";
import { fileURLToPath } from "node:url";

const configPath = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "tailwind.config.ts",
);

export default {
  plugins: {
    autoprefixer: {},
    tailwindcss: { config: configPath },
  },
};
