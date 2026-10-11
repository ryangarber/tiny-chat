import { cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Sharp } from "sharp";
import { sharpsToIco } from "sharp-ico";
import { spawn } from "./spawn.ts";
import { print } from "./use-stdout.ts";

const Rendition = { Dark: 0, Light: 1 } as const;
const RenditionName = Object.keys(Rendition) as (keyof typeof Rendition)[];
type RenditionName = (typeof RenditionName)[number];
const RenditionId = Object.values(Rendition);
type RenditionId = (typeof RenditionId)[number];

// find ictool
const ictool =
	'$(dirname "$(xcode-select -p)")/Applications/Icon Composer.app/Contents/Executables/ictool';

const { stdout: _ictoolPath } = await spawn({
	command: [
		`"${ictool}"`,
		"--version",
		">/dev/null",
		"2>&1",
		"&&",
		"echo",
		`"${ictool}"`,
	],
	label: ["find ictool", "finding ictool", "found ictool"],
	shell: true,
	errors: "exit",
});
const ictoolPath = `"${_ictoolPath.trim()}"`;

// export .icon to source pngs
const iconPath = fileURLToPath(new URL("../assets/icon.icon", import.meta.url));
const renditionPath = (rendition: RenditionName | RenditionId) =>
	join(
		tmpdir(),
		`${typeof rendition === "number" ? RenditionName[rendition] : rendition}.png`,
	);

print({ message: "building source icons" });

for (const rendition of RenditionName) {
	await spawn({
		command: [
			ictoolPath,
			iconPath,
			"--export-image",
			"--output-file",
			renditionPath(rendition),
			"--platform",
			"iOS",
			"--rendition",
			rendition,
			"--width",
			1024,
			"--height",
			1024,
			"--scale",
			1,
		],
		shell: true,
		output: false,
		errors: "exit",
	});
}

print({ details: [renditionPath("Light"), renditionPath("Dark")].join("\n") });

// [helper] convert and place icons
async function copy(
	destination: string,
	...assets: {
		from: RenditionId | string;
		to: string;
		edit?: ((input: Sharp) => Sharp) | number;
		save?: (input: Sharp, output: string) => unknown;
	}[]
) {
	await mkdir(destination, { recursive: true });
	const results = await Promise.all(
		assets.map(
			async ({
				from,
				to,
				edit,
				save = (input: Sharp, output: string) => input.toFile(output),
			}) => {
				if (typeof from === "number") from = renditionPath(from);
				to = join(destination, to);
				if (save === undefined)
					save = (input: Sharp, output: string) => input.toFile(output);
				if (edit) {
					const input = sharp(from);
					const output =
						typeof edit === "number" ? input.resize(edit, edit) : edit(input);
					await save(output, to);
				} else {
					cp(from, to, { recursive: true });
				}
				return to;
			},
		),
	);
	print({ details: results.join("\n") });
	return results;
}

// build desktop assets
const desktopPath = fileURLToPath(new URL("../apps/desktop", import.meta.url));
print({ message: "copying desktop assets" });

await copy(
	desktopPath,
	{ from: iconPath, to: "assets/icon.icon" }, // macos
	{ from: Rendition.Dark, to: "assets/icon.png", edit: 512 }, // linux
	{
		from: Rendition.Dark,
		to: "assets/icon.ico",
		edit: 256,
		save: (input: Sharp, output: string) => sharpsToIco([input], output),
	}, // windows
);

// build mobile assets
const mobilePath = fileURLToPath(new URL("../apps/mobile", import.meta.url));
print({ message: "copying mobile assets" });

await copy(
	mobilePath,
	{ from: iconPath, to: "ios/App/App/Icon.icon" },
	{ from: Rendition.Light, to: "assets/logo.png" },
	{ from: Rendition.Dark, to: "assets/logo-dark.png" },
);

await spawn({
	command: [
		"pnpx",
		"--allow-build=sharp",
		"--yes",
		"@capawesome/capacitor-assets",
		"generate",
		"--ios",
		"--android",
	],
	label: [
		"generate mobile assets",
		"generating mobile assets",
		"generated mobile assets",
	],
	errors: "exit",
	cwd: mobilePath,
});

// build gui assets
const guiPath = fileURLToPath(new URL("../packages/gui", import.meta.url));
print({ message: "copying gui assets" });

await copy(
	guiPath,
	{ from: Rendition.Dark, to: "public/appicon-512x512.png", edit: 512 },
	{ from: Rendition.Dark, to: "public/appicon-192x192.png", edit: 192 },
	{ from: Rendition.Dark, to: "public/favicon-96x96.png", edit: 96 },
	{
		from: Rendition.Dark,
		to: "public/favicon.ico",
		edit: 96,
		save: (input: Sharp, output: string) => sharpsToIco([input], output),
	},
);

print({ message: "done!" });
