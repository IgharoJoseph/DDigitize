import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Outside the editor sandbox (e.g. Vercel CI) build for Vercel's
  // Build Output API. Inside the sandbox the preset is pinned and ignored.
  nitro: { preset: "vercel" },
});
