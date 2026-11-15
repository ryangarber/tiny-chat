const workspace = require("../../../package.json");

/**
 * The desktop app's installers, under `dist/`, by `scripts/build.ts
 * electron`. Each release uploads them and the `latest*.yml` that
 * `UpdateHostService` (`apps/app/electron-plugin`) checks.
 *
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
	appId: workspace.productIdentifier,
	productName: workspace.productName,
	// The workspace's, rather than this project's own.
	extraMetadata: { version: workspace.version },
	directories: {
		output: "dist",
		buildResources: "assets",
	},
	files: [
		"build/**/*",
		"app/**/*",
		"generated/**/*",
		// `assets` is also the electron-builder `buildResources` directory, whose
		// contents are NOT packaged by default. Include it explicitly so the
		// splash screen (and any other runtime assets) ship in the app.
		"assets/**/*",
		"package.json",
		// Platform runtime + plugins, prepared by `capacitor-electron vendor`.
		{ from: "vendor/node_modules", to: "node_modules" },
	],
	// Native libraries (afmize's, the Cua Driver's, Cursor's) are opened by
	// path beside their packages, which an archive has none of.
	asar: false,
	// GitHub names an asset with a space for a dot, so none has one.
	// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder's macros
	artifactName: "Tiny.Chat-${version}-${os}-${arch}.${ext}",
	// A sign-in in the browser returns here (`CommonUtils.nativeAuthCallbackUrl`).
	protocols: [
		{ name: workspace.productName, schemes: [workspace.productScheme] },
	],
	// Every release's artifacts are uploaded to its GitHub release, so the
	// latest one's are the update.
	publish: {
		provider: "generic",
		url: "https://github.com/ryangarber/tiny-chat/releases/latest/download",
	},
	mac: {
		icon: "assets/icon.png",
		category: "public.app-category.productivity",
		// The updater installs from the zip.
		target: ["dmg", "zip"],
		// With the identity named in `CSC_NAME` (self-signed "Tiny Chat Code
		// Signing" is enough), so macOS's privacy grants (Accessibility, Screen
		// Recording) match the app, and keep matching after an update.
		// Otherwise ad hoc, which Apple silicon needs to run it at all.
		identity: process.env.CSC_NAME || "-",
		// Only notarization asks for it, and it would refuse the native
		// libraries the app opens unless each is signed by the same team.
		hardenedRuntime: false,
		notarize: false,
	},
	win: {
		icon: "assets/icon.ico",
		target: ["nsis"],
	},
	linux: {
		icon: "assets/icon.png",
		category: "Utility",
		target: ["AppImage"],
	},
};
