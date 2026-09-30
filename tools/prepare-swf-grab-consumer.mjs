import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const consumer = resolve(root, ".cache/swf-grab-consumer");
mkdirSync(consumer, { recursive: true });
const dependencies = { "pixi.js": "8.19.0" };
const overrides = {};
for (const name of [
  "battle-layout",
  "anim-export",
  "swf-bundle",
  "swf-renderer",
]) {
  const pkg = JSON.parse(
    readFileSync(resolve(root, `packages/${name}/package.json`), "utf8"),
  );
  const tarball = `../swf-grab-artifacts/seer-pet-anim-${name}-${pkg.version}.tgz`;
  if (!existsSync(resolve(consumer, tarball)))
    throw new Error(`Run pnpm pack first: ${tarball}`);
  dependencies[pkg.name] = `file:${tarball}`;
  overrides[pkg.name] = `file:${tarball}`;
}
writeFileSync(
  resolve(consumer, "package.json"),
  JSON.stringify(
    {
      name: "swf-grab-packed-consumer",
      private: true,
      type: "module",
      dependencies,
      packageManager: JSON.parse(
        readFileSync(resolve(root, "package.json"), "utf8"),
      ).packageManager,
      devDependencies: { vite: "6.4.3" },
    },
    null,
    2,
  ) + "\n",
);
// A separate workspace prevents pnpm from replacing tarballs with repo links.
writeFileSync(
  resolve(consumer, "pnpm-workspace.yaml"),
  "packages:\n  - '.'\noverrides:\n" +
    Object.entries(overrides)
      .map(
        ([name, version]) =>
          `  ${JSON.stringify(name)}: ${JSON.stringify(version)}\n`,
      )
      .join(""),
);
const fixtures = resolve(root, "packages/swf-renderer/browser-tests");
for (const file of readdirSync(fixtures)) {
  if (/\.(ts|html)$/.test(file))
    copyFileSync(resolve(fixtures, file), resolve(consumer, file));
}
console.log(
  `Prepared ${consumer}; install its dependencies before running --consumer.`,
);
