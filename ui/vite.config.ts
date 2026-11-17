// Mission control's page: a React app that Vite builds into ui/dist, which the camp server
// (src/server.ts) serves. With `npm run ui` Vite serves the page itself and
// passes /api and /events through to the camp server, token and all.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const CAMP = `http://127.0.0.1:${process.env.CAMP_PORT ?? 4747}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // One stylesheet and no inline code: the page's Content-Security-Policy allows only files the
    // camp server itself serves. The script is the page's main one plus a few loaded when first
    // opened (the terminal, Orbit, Settings, the game: see App.tsx); those are fetched by the
    // script itself, as built files that need no key, so the policy allows them as it is.
    // No module preload: Vite's preload helper would add an inline script.
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    // The main script is about 750 KB (React, highlight.js and the page itself): served from this
    // machine, and compressed, so that costs little. This keeps Vite from warning on every build.
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CAMP_UI_PORT ?? 5173),
    strictPort: true,
    // changeOrigin: the camp server checks the Host header. The token isn't added here: the page
    // sends it, as it does in production, so the dev server can't be used to drive the camp without it.
    proxy: {
      "/api": { target: CAMP, changeOrigin: true },
      "/events": { target: CAMP, changeOrigin: true },
      "/splash": { target: CAMP, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
