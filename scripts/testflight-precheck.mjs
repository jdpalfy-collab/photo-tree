import { existsSync, readFileSync } from "node:fs";

const requiredEnv = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BLOB_READ_WRITE_TOKEN",
];

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const env = {
  ...parseEnvFile(".env"),
  ...parseEnvFile(".env.local"),
  ...process.env,
};

const failures = [];
const warnings = [];

for (const key of requiredEnv) {
  if (!env[key]) failures.push(`Missing ${key} in environment or env files.`);
}

const capacitorConfigPath = "ios/App/App/capacitor.config.json";
if (!existsSync(capacitorConfigPath)) {
  failures.push("Missing ios/App/App/capacitor.config.json. Run npm run mobile:sync.");
} else {
  const config = readJson(capacitorConfigPath);
  const serverUrl = config?.server?.url || "";
  if (!serverUrl) failures.push("iOS Capacitor config has no server.url.");
  if (serverUrl.includes("localhost") || serverUrl.includes("127.0.0.1")) {
    failures.push(`iOS Capacitor config points at local dev server: ${serverUrl}`);
  }
  if (serverUrl && !serverUrl.startsWith("https://")) {
    failures.push(`TestFlight server.url must be HTTPS: ${serverUrl}`);
  }
  if (config?.server?.cleartext) {
    failures.push("iOS Capacitor config has cleartext enabled. TestFlight should use HTTPS.");
  }
  if (config?.appId !== "com.phototree.familytreephotos") {
    warnings.push(`Unexpected appId: ${config?.appId}`);
  }
  console.log(`iOS server URL: ${serverUrl || "(missing)"}`);
}

const infoPlistPath = "ios/App/App/Info.plist";
if (!existsSync(infoPlistPath)) {
  failures.push("Missing ios/App/App/Info.plist.");
} else {
  const plist = readFileSync(infoPlistPath, "utf8");
  if (!plist.includes("NSPhotoLibraryUsageDescription")) {
    failures.push("Missing NSPhotoLibraryUsageDescription in Info.plist.");
  }
  if (!plist.includes("phototree")) {
    failures.push("Missing phototree URL scheme in Info.plist.");
  }
}

if (warnings.length) {
  console.log("\nWarnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

if (failures.length) {
  console.error("\nTestFlight precheck failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("TestFlight precheck passed.");
