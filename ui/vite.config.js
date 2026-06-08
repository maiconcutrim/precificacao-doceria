import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true expõe o servidor de desenvolvimento na rede local,
// permitindo testar de outros aparelhos (celular/tablet) durante o dev.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
