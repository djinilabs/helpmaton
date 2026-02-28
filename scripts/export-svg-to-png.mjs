#!/usr/bin/env node
/**
 * Export SVG to 1200x1200 PNG
 *
 * Converts all SVG files in a directory to 1200×1200 PNG files in the same
 * directory. Uses fit: 'contain' so the full SVG is visible (no cropping).
 *
 * Usage:
 *   node scripts/export-svg-to-png.mjs [options]
 *
 * Options:
 *   --dir <path>   Source directory (default: apps/frontend/public/images)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_IMAGES_DIR = path.join(ROOT, "apps", "frontend", "public", "images");
const SIZE = 1200;

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = DEFAULT_IMAGES_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      dir = path.resolve(process.cwd(), args[++i]);
      break;
    }
  }
  return { dir };
}

function getSvgFiles(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory does not exist: ${dir}`);
    process.exit(1);
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".svg"))
    .map((name) => path.join(dir, name));
}

async function convertSvgToPng(svgPath) {
  const pngPath = svgPath.replace(/\.svg$/i, ".png");
  await sharp(svgPath)
    .resize(SIZE, SIZE, { fit: "contain" })
    .png()
    .toFile(pngPath);
  return pngPath;
}

async function main() {
  const { dir } = parseArgs();
  const svgFiles = getSvgFiles(dir);

  if (svgFiles.length === 0) {
    console.log(`No SVG files found in ${dir}`);
    return;
  }

  console.log(`Converting ${svgFiles.length} SVG(s) to ${SIZE}x${SIZE} PNG in ${dir}`);

  let failed = 0;
  for (const svgPath of svgFiles) {
    const name = path.basename(svgPath);
    try {
      const pngPath = await convertSvgToPng(svgPath);
      console.log(`  ${name} -> ${path.basename(pngPath)}`);
    } catch (err) {
      console.error(`  ${name}: ${err.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} conversion(s) failed.`);
    process.exit(1);
  }
  console.log(`\nDone. ${svgFiles.length} PNG(s) written.`);
}

main();
