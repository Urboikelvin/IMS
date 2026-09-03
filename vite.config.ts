// vite.config.ts — plain Vite + TanStack Start, no Lovable preset.
// Deploy target: Node.js on Vercel (via Nitro's "vercel" preset).
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    // Path alias (@/*) resolution from tsconfig.json — replaces the
    // Lovable preset's automatic @ alias handling.
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),

    // TanStack Start's SSR plugin. `server.entry` keeps our existing
    // src/server.ts wrapper (SSR error normalization) as the request handler.
    // `preset` swaps Nitro's deploy target from the Lovable default
    // (Cloudflare) to a Vercel-compatible Node build.
    // NOTE: confirm this option name/value against your installed
    // @tanstack/react-start version before deploying — it may be
    // `target: "vercel"` instead of `server: { preset: "vercel" }`
    // depending on version.
    tanstackStart({
      server: {
        entry: "server",
        preset: "vercel",
      },
    }),

    viteReact(),
    tailwindcss(),
  ],

  // The Lovable preset auto-injected VITE_* env vars and did React/TanStack
  // dedupe + sandbox port/host detection. Plain Vite already exposes
  // VITE_*-prefixed vars via import.meta.env with no extra config, and
  // sandbox host/port logic isn't needed outside Lovable's preview
  // environment, so both are simply dropped rather than replaced.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
