import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Dev proxy: dashboard calls same-origin /api; locally proxy to the gateway.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000", "/mcp": "http://localhost:3000" } },
});
