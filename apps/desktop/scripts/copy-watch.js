// apps/desktop/scripts/copy-watch.js
const { mkdirSync, copyFileSync, watch } = require("fs");
const { join } = require("path");

const srcDir  = join(__dirname, "..", "src");
const distDir = join(__dirname, "..", "dist");

function copyOnce() {
  mkdirSync(distDir, { recursive: true });
  copyFileSync(join(srcDir, "index.html"), join(distDir, "index.html"));
  copyFileSync(join(srcDir, "styles.css"), join(distDir, "styles.css"));
  console.log("[assets] copied");
}

// do an initial copy so wait-on can find index.html right away
copyOnce();

// keep the process alive by watching the folder
watch(srcDir, { recursive: false }, (evt, file) => {
  if (file === "index.html" || file === "styles.css") copyOnce();
});

// also keep alive even if FS events are quiet
setInterval(() => {}, 1 << 30);
