const chokidar = require("chokidar");
const { sync: glob } = require("glob");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Watch all backend source files including handlers and all dependencies
const watcher = chokidar.watch(
  [
    "apps/backend/src/**/*.ts",
    "apps/backend/src/**/*.js",
    "package.json",
  ],
  {
    ignoreInitial: true,
  }
);

console.log("Watching for changes in apps/backend/src (including handlers and all dependencies)");

let touchTimeout;
const recentlyTouched = new Set();
let touchInProgress = false;

// Track file modification times to detect real changes vs our touches
const fileStats = new Map();

function getFileStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      mtime: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

function isRealChange(filePath) {
  const currentStat = getFileStat(filePath);
  const previousStat = fileStats.get(filePath);
  
  if (!previousStat) {
    // First time seeing this file, record it
    if (currentStat) {
      fileStats.set(filePath, currentStat);
    }
    return true; // Assume it's a real change if we haven't seen it before
  }
  
  if (!currentStat) {
    return false; // File doesn't exist
  }
  
  // Check if mtime or size changed (real change)
  // If only mtime changed but size is the same, it might be our touch
  const mtimeChanged = currentStat.mtime !== previousStat.mtime;
  const sizeChanged = currentStat.size !== previousStat.size;
  
  // Update the stored stat
  fileStats.set(filePath, currentStat);
  
  // If size changed, it's definitely a real change
  if (sizeChanged) {
    return true;
  }
  
  // If mtime changed but we recently touched it, it's probably our touch
  if (mtimeChanged && recentlyTouched.has(filePath)) {
    return false;
  }
  
  // Otherwise, assume it's a real change
  return mtimeChanged;
}

watcher.on("all", async (event, filePath) => {
  // Ignore events while we're touching files
  if (touchInProgress) {
    return;
  }

  // Only process change and add events (ignore unlink, etc. for now)
  if (event !== "change" && event !== "add") {
    return;
  }

  // Skip if it's not a TypeScript/JavaScript file
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".js") && !filePath.endsWith("package.json")) {
    return;
  }

  // Check if this is a real change (not our touch)
  if (!isRealChange(filePath)) {
    return;
  }

  console.log(`[watch] Detected change: ${event} ${filePath}`);

  // Debounce: wait a bit before touching to avoid rapid re-triggering
  clearTimeout(touchTimeout);
  touchTimeout = setTimeout(async () => {
    try {
      touchInProgress = true;
      
      // Find all index.ts files in http handlers
      const httpFiles = glob("apps/backend/src/http/**/index.ts");
      const allFiles = [...httpFiles];

      // Mark files we're about to touch
      for (const file of allFiles) {
        recentlyTouched.add(file);
        // Record current stat before touching
        const stat = getFileStat(file);
        if (stat) {
          fileStats.set(file, stat);
        }
      }

      // Touch each file
      for (const file of allFiles) {
        console.log("Touching", file);
        execSync(`touch "${file}"`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait a bit after touching to let file system settle
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Clear the recently touched set after a delay
      setTimeout(() => {
        recentlyTouched.clear();
      }, 1000);
      
      touchInProgress = false;
    } catch (error) {
      console.error("Error updating files:", error);
      touchInProgress = false;
      recentlyTouched.clear();
    }
  }, 300); // 300ms debounce
});

