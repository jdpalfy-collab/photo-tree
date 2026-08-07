import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function timestampParts(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return {
    day: `${yyyy}-${mm}-${dd}`,
    stamp: `${yyyy}-${mm}-${dd} ${hh}.${min}`,
  };
}

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const { day, stamp } = timestampParts();
const archiveDir = join(homedir(), "Library/Developer/Xcode/Archives", day);
const archivePath =
  process.env.TESTFLIGHT_ARCHIVE_PATH ||
  join(archiveDir, `PhotoTree ${stamp}.xcarchive`);

mkdirSync(archiveDir, { recursive: true });

run("Run automated TestFlight prep", "npm", ["run", "testflight:prepare"]);
run("Create signed Xcode archive", "xcodebuild", [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "archive",
  "-archivePath",
  archivePath,
]);

console.log(`\nCreated archive: ${archivePath}`);
console.log("Open Xcode Organizer to validate and upload this archive to App Store Connect.");
