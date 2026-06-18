const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "web");
const dest = path.join(__dirname, "..", "dist", "src", "web");

fs.cpSync(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
