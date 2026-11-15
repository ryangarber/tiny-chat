import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import app from "../package.json" with { type: "json" };

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));

/** What a native project is built from, besides the plugins it is given. */
const sources = {
	ios: ["apps/app/ios", "apps/app/capacitor.config.ts"],
	android: ["apps/app/android", "apps/app/capacitor.config.ts"],
} as const;

/** Files git would track under `paths`, sorted; ignored ones are build output. */
const listFiles = async (paths: readonly string[]) => {
	const { stdout } = await exec(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"--",
			...paths,
		],
		{ cwd: root, maxBuffer: 64 * 1024 * 1024 },
	);
	return [...new Set(stdout.split("\0").filter(Boolean))].sort();
};

/** Capacitor and its plugins, as installed: each brings native code. */
const listPlugins = async () => {
	const plugins: string[] = [];
	for (const name of Object.keys(app.dependencies).sort()) {
		const manifest = JSON.parse(
			await readFile(
				join(root, "apps/app/node_modules", name, "package.json"),
				"utf8",
			),
		);
		// Not a plugin for Electron alone (`app-electron-plugin`), which neither has.
		if (
			name.startsWith("@capacitor/") ||
			manifest.capacitor?.ios ||
			manifest.capacitor?.android
		)
			plugins.push(`${name}@${manifest.version}`);
	}
	return plugins;
};

/**
 * A hash of everything the native app is built from, before `cap sync`
 * regenerates its part of it: a web build only runs on a binary with the
 * same one.
 */
export async function fingerprint(platform: "ios" | "android") {
	const hash = createHash("sha256");
	for (const file of await listFiles(sources[platform])) {
		// Listed, but deleted from the working tree.
		const data = await readFile(join(root, file)).catch(() => undefined);
		if (data) hash.update(`${file}\0`).update(data).update("\0");
	}
	for (const plugin of await listPlugins()) hash.update(`${plugin}\0`);
	return hash.digest("hex");
}
