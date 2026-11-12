import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

/**
 * The Cua Driver SDK (computah's computer driver) finds its native library by
 * resolving `@trycua/cua-driver-<platform>` from its own file. A bundle moves
 * that file away from `node_modules`, so a build has to bring the library
 * along: the desktop copies the package beside its bundle, where that same
 * lookup finds it, and the CLI embeds it (see {@link cuaDriverPlugin}).
 */

const CLIENT = fileURLToPath(new URL("../packages/client/", import.meta.url));

/** The SDK's name for this platform, as `@ubjs/node`'s `tripleStyle: "node"` spells it. */
const triple = () => {
	const { platform, arch } = process;
	if (platform === "darwin") return `darwin-${arch}`;
	if (platform === "win32") return `win32-${arch}-msvc`;
	const report = process.report?.getReport() as
		| { header?: { glibcVersionRuntime?: string } }
		| undefined;
	return `linux-${arch}-${report?.header?.glibcVersionRuntime ? "gnu" : "musl"}`;
};

export interface CuaDriverNative {
	/** The SDK package's directory. */
	sdk: string;
	/** `@trycua/cua-driver-<platform>`. */
	name: string;
	/** Its directory, as installed. */
	dir: string;
	version: string;
	/** The SDK's library (`libcua_driver_sdk.dylib` and the like). */
	library: string;
	/** The Node-API module that opens it. */
	runtime: string;
}

/**
 * Where `name` is installed as seen from `from`, walking up its
 * `node_modules` as Node would. Node's own resolver will not do: neither
 * computah nor the SDK exports its `package.json`.
 */
const findPackage = (name: string, from: string) => {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) {
			return realpathSync(candidate);
		}
		if (dirname(dir) === dir) {
			throw new Error(`${name} is not installed above ${from}`);
		}
	}
};

/** The platform package the SDK would load here, or nothing where there is none. */
export const findCuaDriverNative = (): CuaDriverNative | undefined => {
	try {
		const sdk = findPackage(
			"@trycua/cua-driver",
			findPackage("computah", CLIENT),
		);
		const name = `@trycua/cua-driver-${triple()}`;
		const dir = findPackage(name, sdk);
		const file =
			process.platform === "win32"
				? "cua_driver_sdk.dll"
				: `libcua_driver_sdk.${process.platform === "darwin" ? "dylib" : "so"}`;
		const library = join(dir, file);
		const runtime = join(dir, "cua_driver_node_runtime.node");
		if (!existsSync(library) || !existsSync(runtime)) return undefined;
		const { version } = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		) as { version: string };
		return { sdk, name, dir, version, library, runtime };
	} catch {
		return undefined;
	}
};

/**
 * Lays out `dir` as a `node_modules` holding just the platform package, for a
 * build to copy where the bundled SDK's own lookup walks: any directory above
 * the bundle. Emptied first, so a stale platform's never ships; left empty
 * where there is none.
 */
export const stageCuaDriverNative = (dir: string) => {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const native = findCuaDriverNative();
	if (!native) return undefined;
	cpSync(native.dir, join(dir, native.name), {
		recursive: true,
		dereference: true,
	});
	return native;
};

/** One line of the SDK's loader that the plugin replaces, which must still be there. */
const replace = (source: string, from: RegExp | string, to: string) => {
	const next = source.replace(from, to);
	if (next === source) {
		throw new Error(
			`cua-driver: the SDK's native loader changed (no match for ${from}); update scripts/use-cua-driver.ts`,
		);
	}
	return next;
};

/**
 * Embeds the SDK's native library in the CLI's bundle, which no
 * `node_modules` stands beside. Its loader (`dist/native/node-runtime.js`,
 * whose `resolveLibPath` the SDK's other modules call too) takes the
 * embedded files instead. A compiled binary keeps them in its own file
 * system, which the library's native `dlopen` cannot read, so they are
 * first copied out to the user's cache, once per version.
 */
export const cuaDriverPlugin = (): BunPlugin => ({
	name: "cua-driver",
	setup: (build) => {
		const native = findCuaDriverNative();
		if (!native) return;
		const loader = join(native.sdk, "dist", "native", "node-runtime.js");

		build.onLoad({ filter: /[\\/]node-runtime\.js$/ }, (args) => {
			// Windows' paths ignore case, and Bun's may not spell it as `realpath` does.
			const same =
				process.platform === "win32"
					? args.path.toLowerCase() === loader.toLowerCase()
					: args.path === loader;
			if (!same) return;
			let source = readFileSync(args.path, "utf8");
			source = replace(
				source,
				/const sdkLibrary = resolveLibPath\(\{[\s\S]*?\}\);/,
				"const sdkLibrary = __cuaDriver.library;",
			);
			source = replace(
				source,
				/const runtimePath = join\(dirname\(sdkLibrary\), "cua_driver_node_runtime\.node"\);/,
				"const runtimePath = __cuaDriver.runtime;",
			);
			source = replace(
				source,
				"export default { FfiType, resolveLibPath, UniffiNativeModule };",
				"export default { FfiType, resolveLibPath: () => __cuaDriver.library, UniffiNativeModule };",
			);
			const prelude = `
import __cuaLibrary from ${JSON.stringify(native.library)} with { type: "file" };
import __cuaRuntime from ${JSON.stringify(native.runtime)} with { type: "file" };
import * as __cuaFs from "node:fs";
import * as __cuaOs from "node:os";
import * as __cuaPath from "node:path";
import * as __cuaUrl from "node:url";
const __cuaDriver = (() => {
	const embedded = (file) => file.startsWith("/$bunfs/") || /^[A-Z]:[\\\\/]~BUN[\\\\/]/i.test(file);
	if (!embedded(__cuaLibrary) && !embedded(__cuaRuntime)) {
		// A bundle that is not compiled names its files relative to itself
		// ("./cua_driver_sdk-<hash>.dll"), which \`dlopen\` would take from the
		// working directory instead.
		const beside = (file) =>
			__cuaPath.isAbsolute(file) ? file : __cuaUrl.fileURLToPath(new URL(file, import.meta.url));
		return { library: beside(__cuaLibrary), runtime: beside(__cuaRuntime) };
	}
	const home = __cuaOs.homedir();
	const cache =
		process.platform === "darwin"
			? __cuaPath.join(home, "Library", "Caches")
			: process.platform === "win32"
				? (process.env.LOCALAPPDATA ?? __cuaPath.join(home, "AppData", "Local"))
				: (process.env.XDG_CACHE_HOME ?? __cuaPath.join(home, ".cache"));
	const dir = __cuaPath.join(cache, "tiny-chat", "cua-driver", ${JSON.stringify(native.version)});
	const extract = (from, name) => {
		const to = __cuaPath.join(dir, name);
		const size = __cuaFs.statSync(from).size;
		try {
			if (__cuaFs.statSync(to).size === size) return to;
		} catch {}
		__cuaFs.mkdirSync(dir, { recursive: true });
		const partial = to + "." + process.pid + ".partial";
		__cuaFs.writeFileSync(partial, __cuaFs.readFileSync(from));
		__cuaFs.renameSync(partial, to);
		return to;
	};
	return {
		library: extract(__cuaLibrary, ${JSON.stringify(native.library.split(/[\\/]/).at(-1))}),
		runtime: extract(__cuaRuntime, "cua_driver_node_runtime.node"),
	};
})();
`;
			return { contents: prelude + source, loader: "js" };
		});
	},
});
