#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zClientEnv } from "#core/core/types/env.ts";
import type { MobileRelease, MobileUpdate } from "#mobile/core/types/update.ts";
import workspace from "../../../package.json" with { type: "json" };
import { spawn } from "../../../scripts/spawn.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { fingerprint } from "./fingerprint.ts";

/**
 * An unsigned release of the mobile app, against the production server:
 * `build.ts ios` archives `ios/App/App.xcarchive` (or under `$RUNNER_TEMP`),
 * and `build.ts android` assembles the release APKs under
 * `android/app/build/outputs/apk/release`. Signing is left to whoever
 * distributes them. Either also leaves its web build under `build/` as a live
 * update, `Tiny.Chat_Mobile.zip` and `mobile-update.json`, for any binary
 * with the same native code to update to.
 */
const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") {
	throw new Error("usage: build.ts ios|android");
}

process.env.DEV = "";
process.env.DEV_HOST = "";
process.env.DEV_REMOTE = "";
delete process.env.MOBILE_DEV_URL;
useEnv({ type: zClientEnv });

// Before `cap sync` rewrites the native projects.
const release: MobileRelease = {
	version: workspace.version,
	fingerprints: {
		ios: await fingerprint("ios"),
		android: await fingerprint("android"),
	},
};
// What the build checks updates against (`vite.config.ts`).
process.env.MOBILE_RELEASE = JSON.stringify(release);

await spawn({
	command: ["pnpm", "exec", "vite", "build"],
	label: ["gui build", "building gui"],
	output: "tail",
});

const out = fileURLToPath(new URL("../build", import.meta.url));
const bundle = `${out}/Tiny.Chat_Mobile.zip`;
await mkdir(out, { recursive: true });
await rm(bundle, { force: true });
await spawn({
	command: ["zip", "-qr", bundle, ".", "-x", "stats.html"],
	label: ["live update", "zipping live update"],
	cwd: fileURLToPath(new URL("../dist", import.meta.url)),
});
const update: MobileUpdate = {
	...release,
	checksum: createHash("sha256")
		.update(await readFile(bundle))
		.digest("hex"),
};
await writeFile(`${out}/mobile-update.json`, JSON.stringify(update));

await spawn({
	command: ["pnpm", "exec", "cap", "sync", platform],
	label: [`${platform} sync`, `syncing ${platform}`],
	output: "tail",
});

if (platform === "ios") {
	const archive = `${process.env.RUNNER_TEMP ?? fileURLToPath(new URL("../ios/App", import.meta.url))}/App.xcarchive`;
	await rm(archive, { recursive: true, force: true });
	await spawn({
		command: [
			"xcodebuild",
			"-project",
			"App.xcodeproj",
			"-scheme",
			"App",
			"-sdk",
			"iphoneos",
			"-destination",
			"generic/platform=iOS",
			"-configuration",
			"Release",
			"-archivePath",
			archive,
			"archive",
			"CODE_SIGN_IDENTITY=",
			"CODE_SIGNING_REQUIRED=NO",
			"CODE_SIGNING_ALLOWED=NO",
			"DEVELOPMENT_TEAM=",
			// What a live update is installed over (`UpdateService`).
			`MARKETING_VERSION=${workspace.version}`,
		],
		label: ["ios archive", "archiving ios app"],
		output: "tail",
		cwd: fileURLToPath(new URL("../ios/App", import.meta.url)),
	});
} else {
	await spawn({
		command: [
			process.platform === "win32" ? "gradlew.bat" : "./gradlew",
			"assembleRelease",
			// What a live update is installed over (`UpdateService`).
			`-PversionName=${workspace.version}`,
		],
		label: ["android assemble", "assembling android apks"],
		output: "tail",
		cwd: fileURLToPath(new URL("../android", import.meta.url)),
	});
}
