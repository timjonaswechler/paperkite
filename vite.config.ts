import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  base: "/bewerbung/",
  plugins: [tailwindcss()],
  resolve: { alias: { "~": path.resolve("src") } },
  build: { outDir: "dist" },
});
