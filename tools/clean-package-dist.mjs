import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../packages"),
);
const pkg = realpathSync(process.cwd());
if (
  !pkg.startsWith(root + sep) ||
  !JSON.parse(
    readFileSync(resolve(pkg, "package.json"), "utf8"),
  ).name?.startsWith("@seer-pet-anim/")
) {
  throw new Error("Clean must run inside a seer animation package");
}
const dist = resolve(pkg, "dist");
if (existsSync(dist)) {
  const resolved = realpathSync(dist);
  if (!resolved.startsWith(pkg + sep))
    throw new Error("Refusing to clean an external dist symlink");
  rmSync(resolved, { recursive: true });
}
