import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `npm run build` writes a static site to dist/, which is deployed on its own (not by the API).
// During `npm run dev`, API calls are forwarded to FastAPI on port 8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
