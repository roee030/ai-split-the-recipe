/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // We use our own public/manifest.json
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com/,
            handler: "NetworkFirst",
            options: { cacheName: "firestore-cache" },
          },
        ],
      },
    }),
  ],
  base: process.env.GITHUB_ACTIONS ? "/ai-split-the-recipe/" : "/",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/recipe test/setup.ts",
  },
});
