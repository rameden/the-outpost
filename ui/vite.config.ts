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
    // One script and one stylesheet, no inline code: the page's Content-Security-Policy allows
    // only files the camp server itself serves.
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    // The one script is about 700 kB with the terminal (xterm.js) in it, and stays one on
    // purpose: every built file is fetched with the launch token on its link, and a script
    // split into pieces would fetch the other pieces without it. It's served from this machine,
    // so the size costs nothing; this just keeps Vite from warning about it on every build.
    chunkSizeWarningLimit: 1500,
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
