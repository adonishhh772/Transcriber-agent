import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the same build works at a domain root, at
  // /<repo>/ on GitHub Pages, or from a subfolder.
  base: "./",
  // The Whisper worker loads @huggingface/transformers with dynamic imports,
  // so it must be bundled as an ES module rather than the IIFE default.
  worker: {
    format: "es",
  },
});
