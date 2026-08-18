import { cpSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");

if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "mobile.js",
  "sounds.js",
  "manifest.json",
  "sw.js",
];

files.forEach((file) => cpSync(join(root, file), join(www, file)));
cpSync(join(root, "icons"), join(www, "icons"), { recursive: true });

console.log("Copied web assets to www/");
