import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client lives in /client. In dev, API calls are proxied to the Express server.
export default defineConfig({
  root: "client",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  build: { outDir: "dist", emptyOutDir: true },
});
