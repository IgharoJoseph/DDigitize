import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps the generated SSR entry with error reporting.
      server: { entry: "server" },
    }),
    react(),
    // Builds the server bundle. The deploy target is auto-detected
    // (Vercel, Netlify, Cloudflare); override with NITRO_PRESET.
    nitro(),
  ],
});
