import { existsSync, readFileSync } from "node:fs";

const requiredEnv = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "PHOTOTREE_FAMILY_CODE",
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

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
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

if (!env.NEXT_PUBLIC_SUPPORT_EMAIL && !env.SUPPORT_EMAIL) {
  failures.push("Missing NEXT_PUBLIC_SUPPORT_EMAIL or SUPPORT_EMAIL for the App Store support/contact pages.");
}

if (env.IOS_ONLY_ACCESS_ENABLED !== "true") {
  warnings.push("Set IOS_ONLY_ACCESS_ENABLED=true in Vercel Production to keep the web app iOS-only.");
}

const nextAuthUrl = env.NEXTAUTH_URL || "";
if (nextAuthUrl) {
  if (!nextAuthUrl.startsWith("https://")) {
    failures.push(`NEXTAUTH_URL should be the production HTTPS URL for App Store review: ${nextAuthUrl}`);
  }
  if (nextAuthUrl.includes("localhost") || nextAuthUrl.includes("127.0.0.1")) {
    failures.push(`NEXTAUTH_URL cannot point at local development for App Store review: ${nextAuthUrl}`);
  }
}

const capacitorConfigPath = "ios/App/App/capacitor.config.json";
if (!existsSync(capacitorConfigPath)) {
  failures.push("Missing ios/App/App/capacitor.config.json. Run npm run mobile:sync.");
} else {
  const config = readJson(capacitorConfigPath);
  const serverUrl = config?.server?.url || "";
  if (!serverUrl) failures.push("iOS Capacitor config has no server.url.");
  if (serverUrl.includes("localhost") || serverUrl.includes("127.0.0.1")) {
    failures.push(`iOS Capacitor config points at local development: ${serverUrl}`);
  }
  if (serverUrl && !serverUrl.startsWith("https://")) {
    failures.push(`App Store server.url must be HTTPS: ${serverUrl}`);
  }
  if (config?.server?.cleartext) {
    failures.push("iOS Capacitor config has cleartext enabled. App Store builds should use HTTPS.");
  }
  if (config?.appId !== "com.phototree.familytreephotos") {
    warnings.push(`Unexpected appId: ${config?.appId}`);
  }
  if (!String(config?.appendUserAgent || "").includes("PhotoTreeNative/")) {
    failures.push("Capacitor config should append PhotoTreeNative/ so iOS-only access works.");
  }
  console.log(`iOS server URL: ${serverUrl || "(missing)"}`);
}

const infoPlist = readText("ios/App/App/Info.plist");
if (!infoPlist) {
  failures.push("Missing ios/App/App/Info.plist.");
} else {
  for (const key of [
    "NSCameraUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
  ]) {
    if (!infoPlist.includes(key)) failures.push(`Missing ${key} in Info.plist.`);
  }
  if (!infoPlist.includes("phototree")) {
    failures.push("Missing phototree URL scheme in Info.plist.");
  }
}

const project = readText("ios/App/App.xcodeproj/project.pbxproj");
if (!project) {
  failures.push("Missing iOS Xcode project.");
} else {
  if (!project.includes("DEVELOPMENT_TEAM = D3C3U98GNA;")) {
    warnings.push("Confirm the Apple Developer Team is selected in Xcode before archiving.");
  }
  if (!project.includes("PRODUCT_BUNDLE_IDENTIFIER = com.phototree.familytreephotos;")) {
    failures.push("Unexpected bundle identifier. Keep com.phototree.familytreephotos for the existing App Store record.");
  }
  const marketingVersion = project.match(/MARKETING_VERSION = ([^;]+);/)?.[1] || "";
  const buildNumber = project.match(/CURRENT_PROJECT_VERSION = ([^;]+);/)?.[1] || "";
  console.log(`iOS version: ${marketingVersion || "(missing)"} (${buildNumber || "missing build"})`);
}

for (const file of [
  "app/api/family-access/route.ts",
  "app/privacy/page.tsx",
  "app/support/page.tsx",
]) {
  if (!existsSync(file)) failures.push(`Missing App Store readiness file: ${file}`);
}

warnings.push(
  "In App Review notes, provide the family invite code and explain that Google Photos sign-in is optional and only used for importing selected photos."
);
warnings.push(
  "Unlisted App Store links are not private access control by themselves; keep PHOTOTREE_FAMILY_CODE enabled in production."
);

if (warnings.length) {
  console.log("\nWarnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

if (failures.length) {
  console.error("\nApp Store precheck failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("App Store precheck passed.");
