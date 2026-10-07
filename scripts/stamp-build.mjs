// Writes public/js/build.js with a fresh build id before each deploy.
import { writeFileSync } from "node:fs";
const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
writeFileSync(new URL("../public/js/build.js", import.meta.url), `// Stamped by scripts/stamp-build.mjs on deploy; "dev" locally.\nexport const BUILD = "${id}";\n`);
console.log("build", id);
