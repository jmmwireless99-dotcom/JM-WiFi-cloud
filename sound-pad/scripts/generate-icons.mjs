import { writeFileSync, mkdirSync } from "fs";
import { PNG } from "pngjs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "icons");
mkdirSync(outDir, { recursive: true });

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const s = size / 512;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (size * y + x) << 2;
      const nx = x / size;
      const ny = y / size;
      const inRadius = nx > 0.08 && nx < 0.92 && ny > 0.08 && ny < 0.92;

      if (!inRadius) {
        png.data[i] = 26;
        png.data[i + 1] = 18;
        png.data[i + 2] = 8;
        png.data[i + 3] = 255;
        continue;
      }

      const r = Math.floor(251 * (1 - ny * 0.35) + 249 * ny * 0.35);
      const g = Math.floor(191 * (1 - ny * 0.35) + 115 * ny * 0.35);
      const b = Math.floor(36 * (1 - ny * 0.35) + 22 * ny * 0.35);

      const padRow = Math.floor((ny - 0.62) / (0.08 * s));
      const padCol = Math.floor((nx - 0.12) / (0.19 * s));
      const inPadArea = ny > 0.62 && ny < 0.9 && nx > 0.12 && nx < 0.88;
      const isPad = inPadArea && padRow >= 0 && padRow < 3 && padCol >= 0 && padCol < 4;

      if (isPad) {
        png.data[i] = 17;
        png.data[i + 1] = 24;
        png.data[i + 2] = 39;
        png.data[i + 3] = 255;
      } else if (ny > 0.22 && ny < 0.52 && nx > 0.18 && nx < 0.82) {
        png.data[i] = 26;
        png.data[i + 1] = 18;
        png.data[i + 2] = 8;
        png.data[i + 3] = 255;
      } else {
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
  }

  return PNG.sync.write(png);
}

[192, 512].forEach((size) => {
  const path = join(outDir, `icon-${size}.png`);
  writeFileSync(path, drawIcon(size));
  console.log(`Created ${path}`);
});
