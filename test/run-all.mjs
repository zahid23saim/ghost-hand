// Runs every Node test in order; exits non-zero if any fails.
import { spawnSync } from "node:child_process";

const tests = ["test/physics.mjs", "test/room-core.mjs", ["test/room-core.mjs", "--real"], "test/server.mjs", "test/net-sim.mjs", "tools/check-content.mjs"];
let failed = 0;
for (const t of tests) {
  const [file, ...args] = Array.isArray(t) ? t : [t];
  console.log(`\n=== ${file} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
