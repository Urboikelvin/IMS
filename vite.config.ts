// vite.config.ts — plain Vite + TanStack Start, no Lovable preset.
// Deploy target: Node.js on Vercel, via a separate Nitro plugin (the
// tanstackStart() plugin itself no longer takes a deploy preset option in
// this version — that was an incorrect guess in an earlier version of this
// file and produced a broken build with no working server route, hence the
// 404 on Vercel).
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    // Path alias (@/*) resolution from tsconfig.json — replaces the
    // Lovable preset's automatic @ alias handling.
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),

    // TanStack Start's SSR plugin. Using the plugin's own default server
    // entry (no custom `server.entry` override) — every confirmed-working
    // TanStack Start + Nitro + Vercel setup found uses the bare plugin with
    // no options, and a custom entry override is the one non-standard piece
    // in this config, so it's the top suspect for the deployment 404s.
    // The custom src/server.ts SSR error-normalization wrapper is no longer
    // wired in here as a result — that file is left in place, unused, and
    // can be reintroduced a different way once deploys are confirmed stable.
    tanstackStart(),

    // Nitro builds the actual deployable server output. With no preset
    // specified, Nitro auto-detects the Vercel build environment and
    // produces Vercel Functions automatically.
    nitro(),

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