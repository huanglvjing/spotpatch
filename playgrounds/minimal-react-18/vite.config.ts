import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const e2eAi =
  process.env.SPOTPATCH_E2E_AI_UI === "1"
    ? {
        providers: {
          relay: {
            type: "openai-compatible" as const,
            label: "E2E Relay",
            protocol: "responses" as const,
            baseURL: "https://relay.example.invalid/v1",
            apiKeyEnv: "SPOTPATCH_E2E_API_KEY",
            models: {
              coder: { label: "E2E Coding Model", model: "e2e-coder" },
            },
            defaultModel: "coder",
          },
        },
        defaultProvider: "relay",
        execution: {
          applyMode: "trusted-auto" as const,
          checks: {
            verify: {
              label: "E2E validation",
              command: process.execPath,
              args: ["--version"],
              required: true,
            },
          },
        },
      }
    : undefined;

export default defineConfig({
  plugins: [
    spotPatch({
      dataFlow: {},
      externalAgent: true,
      ...(e2eAi === undefined ? {} : { ai: e2eAi }),
    }),
    react(),
  ],
});
