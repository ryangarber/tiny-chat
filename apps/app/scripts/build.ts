#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { proc } from "@ryangarber/utils";
import type { MobileRelease, MobileUpdate } from "#app/core/types/update.ts";
import { zClientEnv } from "#core/core/types/env.ts";
import workspace from "../../../package.json" with { type: "json" };
import { useEnv } from "../../../scripts/use-env.ts";
import { fingerprint } from "./fingerprint.ts";

/**
 * A release of the app, against the production server: `build.ts electron`
 * packages the desktop app for this host under `electron/dist`, its
 * installers and what its updater reads (`electron-builder.config.js`),
 * signed only as `CSC_NAME` says. Unsigned, `build.ts ios` archives `ios/App/App.xcarchive` (or under `$RUNNER_TEMP`),
 * and `build.ts android` assembles the release APKs under
 * `android/app/build/outputs/apk/release`. Signing is left to whoever
 * distributes them. Either also leaves its web build under `build/` as a live
 * update, `Tiny.Chat_Mobile.zip` and `mobile-update.json`, for any binary
 * with the same native code to update to.
 */
const platform = process.argv[2];
if (platform !== "ios" && platform !== "android" && platform !== "electron") {
	throw new Error("usage: build.ts ios|android|electron");
}

process.env.DEV = "";
process.env.DEV_HOST = "";
process.env.DEV_REMOTE = "";
delete process.env.MOBILE_DEV_URL;
delete process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL;
useEnv({ type: zClientEnv });

if (platform === "electron") {
	const electron = fileURLToPath(new URL("../electron", import.meta.url));
	await proc({
		title: "Building GUI",
		command: ["pnpm", "exec", "vite", "build"],
	});
	await proc({
		title: "Building main process",
		command: ["pnpm", "--filter", "app-electron-plugin", "run", "build"],
	});
	await proc({
		title: "Syncing electron",
		command: ["pnpm", "exec", "cap", "sync", "@capawesome/capacitor-electron"],
	});
	await proc({
		title: "Compiling electron",
		command: ["pnpm", "exec", "tsc"],
		cwd: electron,
	});
	// What the app's main process loads at runtime, into the package.
	await proc({
		title: "Vendoring dependencies",
		command: ["pnpm", "exec", "capacitor-electron", "vendor"],
		cwd: electron,
	});
	await proc({
		title: "Packaging app",
		command: [
			"pnpm",
			"exec",
			"electron-builder",
			"--config",
			"electron-builder.config.js",
			"--publish",
			"never",
		],
		cwd: electron,
	});
	process.exit();
}

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

await proc({
	title: "Building GUI",
	command: ["pnpm", "exec", "vite", "build"],
});

const out = fileURLToPath(new URL("../build", import.meta.url));
const bundle = `${out}/Tiny.Chat_Mobile.zip`;
await mkdir(out, { recursive: true });
await rm(bundle, { force: true });
await proc({
	title: "Zipping live update",
	command: ["zip", "-qr", bundle, ".", "-x", "stats.html"],
	cwd: fileURLToPath(new URL("../dist", import.meta.url)),
});
const update: MobileUpdate = {
	...release,
	checksum: createHash("sha256")
		.update(await readFile(bundle))
		.digest("hex"),
};
await writeFile(`${out}/mobile-update.json`, JSON.stringify(update));

await proc({
	title: `Syncing ${platform}`,
	command: ["pnpm", "exec", "cap", "sync", platform],
});

if (platform === "ios") {
	const archive = `${process.env.RUNNER_TEMP ?? fileURLToPath(new URL("../ios/App", import.meta.url))}/App.xcarchive`;
	await rm(archive, { recursive: true, force: true });
	await proc({
		title: "Building IPA",
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
		cwd: fileURLToPath(new URL("../ios/App", import.meta.url)),
	});
} else {
	await proc({
		title: "Building APK",
		command: [
			process.platform === "win32" ? "gradlew.bat" : "./gradlew",
			"assembleRelease",
			// What a live update is installed over (`UpdateService`).
			`-PversionName=${workspace.version}`,
		],
		cwd: fileURLToPath(new URL("../android", import.meta.url)),
	});
}
