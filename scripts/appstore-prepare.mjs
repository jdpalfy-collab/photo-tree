import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultMobileUrl = "https://photo-tree-cyan.vercel.app";
const knownWrongUrls = new Set(["https://photo-tree.vercel.app"]);

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

function currentCapacitorUrl() {
  const file = "ios/App/App/capacitor.config.json";
  if (!existsSync(file)) return "";
  try {
    return JSON.parse(readFileSync(file, "utf8"))?.server?.url || "";
  } catch {
    return "";
  }
}

function productionUrl() {
  const env = {
    ...parseEnvFile(".env"),
    ...parseEnvFile(".env.local"),
    ...process.env,
  };
  const candidates = [
    env.MOBILE_APP_URL,
    env.NEXT_PUBLIC_MOBILE_SERVER_URL,
    env.NEXTAUTH_URL,
    defaultMobileUrl,
    currentCapacitorUrl(),
  ].filter(Boolean);

  return (
    candidates.find(
      (url) =>
        url.startsWith("https://") &&
        !url.includes("localhost") &&
        !knownWrongUrls.has(url)
    ) || ""
  );
}

function run(label, command, args, env = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const mobileUrl = productionUrl();
if (!mobileUrl) {
  console.error("Missing production HTTPS URL. Run with MOBILE_APP_URL=https://your-vercel-url.");
  process.exit(1);
}

console.log(`Preparing App Store build against: ${mobileUrl}`);

run("Build Next.js app", "npm", ["run", "build"]);
run("Sync Capacitor iOS project", "npx", ["cap", "sync", "ios"], {
  MOBILE_APP_URL: mobileUrl,
});
run("Run App Store precheck", "npm", ["run", "appstore:precheck"], {
  MOBILE_APP_URL: mobileUrl,
});
run("Verify Xcode project", "xcodebuild", ["-list", "-project", "ios/App/App.xcodeproj"]);
run("Verify unsigned Release build", "xcodebuild", [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "CODE_SIGNING_ALLOWED=NO",
  "build",
]);

console.log("\nApp Store automated prep passed.");
