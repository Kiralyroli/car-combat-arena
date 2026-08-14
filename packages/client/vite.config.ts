import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // A Rapier WASM-et a compat build inlineolja, de a pre-bundling
    // segit a dev-szerver ujraindulasi idejen.
    include: ["@dimforge/rapier3d-compat", "three"],
  },
});
