import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The build lands in app/static, which FastAPI already serves.
// During `npm run dev`, API calls are forwarded to FastAPI on port 8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/static/",
  build: { outDir: "../app/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
