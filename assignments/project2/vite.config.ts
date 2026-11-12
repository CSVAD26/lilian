import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: './' lets the built site work from any folder (GitHub Pages, Netlify, a USB stick...)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
});
