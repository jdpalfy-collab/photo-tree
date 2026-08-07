import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadLocalEnv();

const mobileServerUrl =
  process.env.MOBILE_APP_URL ||
  process.env.NEXT_PUBLIC_MOBILE_SERVER_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000";

const config: CapacitorConfig = {
  appId: process.env.MOBILE_APP_ID || "com.phototree.familytreephotos",
  appName: "PhotoTree",
  webDir: "public",
  appendUserAgent: "PhotoTreeNative/1.0",
  server: {
    url: mobileServerUrl,
    cleartext: mobileServerUrl.startsWith("http://"),
  },
  ios: {
    contentInset: "never",
  },
};

export default config;
