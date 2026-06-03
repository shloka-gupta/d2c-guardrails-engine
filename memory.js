import fs   from "fs";
import path from "path";

const MEMORY_DIR = "./memory";
fs.mkdirSync(MEMORY_DIR, { recursive: true });

export function brandMemoryPath(brand) {
  return path.join(MEMORY_DIR, brand.toLowerCase());
}

export function brandMemoryExists(brand) {
  const dir = brandMemoryPath(brand);
  return (
    fs.existsSync(path.join(dir, "unified_data.json")) &&
    fs.existsSync(path.join(dir, "findings.json")) &&
    fs.existsSync(path.join(dir, "rules.json"))
  );
}

export function getLayersForBrand(brand) {
  const dataDir = `./data/${brand.toLowerCase()}`;
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter(f => f.endsWith(".json") &&
                 f !== "unified_data.json" &&
                 f !== "data_provenance.md")
    .map(f => f.replace(".json", ""));
    
}

export function layersChanged(brand) {
  const metaPath = path.join(brandMemoryPath(brand), "meta.json");
  if (!fs.existsSync(metaPath)) return true;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const currentLayers = getLayersForBrand(brand).sort().join(",");
  const savedLayers   = (meta.layers_included ?? []).sort().join(",");
  return currentLayers !== savedLayers;
}

export function getBrandMemory(brand) {
  const dir = brandMemoryPath(brand);
  return {
    findings: JSON.parse(fs.readFileSync(path.join(dir, "findings.json"), "utf8")),
    rules:    JSON.parse(fs.readFileSync(path.join(dir, "rules.json"),    "utf8")),
    analysis: fs.readFileSync(path.join(dir, "brand_analysis.md"), "utf8"),
    meta:     JSON.parse(fs.readFileSync(path.join(dir, "meta.json"),     "utf8")),
  };
}