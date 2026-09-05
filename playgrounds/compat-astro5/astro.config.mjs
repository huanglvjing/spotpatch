import { defineConfig } from "astro/config";
import spotPatch from "@spotpatch/astro";
import react from "@astrojs/react";

export default defineConfig({
  base: "/models",
  srcDir: "./.fixture",
  devToolbar: { enabled: false },
  integrations: [
    react(),
    spotPatch({ ai: false, dataFlow: {}, contextualAsk: {}, externalAgent: true }),
  ],
});
