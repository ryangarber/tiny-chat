import { inspect } from "node:util";
import * as Babel from "@babel/core";
import { log, task } from "@ryangarber/utils";
import chalk from "chalk";
import { zClientEnv } from "#core/core/types/env.ts";
import { useEnv } from "../../../scripts/use-env.ts";

const env = useEnv({ type: zClientEnv });
export const environment = Object.fromEntries(
	Object.entries(env).map(([key, value]) => [
		`process.env.${key}`,
		JSON.stringify(value),
	]),
);

type BuildOutput = Awaited<ReturnType<typeof Bun.build>>;
type PluginConfig = NonNullable<
	NonNullable<
		NonNullable<Parameters<typeof Babel.transformAsync>[1]>["parserOpts"]
	>["plugins"]
>[number];

type BuildResult = Omit<BuildOutput, "logs"> & {
	logs: (BuildOutput["logs"][number] | { error: unknown })[];
};

export async function compile({
	dev = false,
	...options
}: Partial<Parameters<typeof Bun.build>[0]> & {
	dev?: boolean;
} = {}): Promise<BuildResult | null> {
	const define = Object.fromEntries(
		Object.entries(environment).flatMap(([key, value]) => {
			if (key === "process.env.DEV") {
				return dev ? [] : [["process.env.DEV", ""]];
			}
			return [[key, value]];
		}),
	);
	// Bun leaves `NODE_ENV` to the environment the bundle is built in, which
	// bundles React's development builds unless it is set. A release takes the
	// production builds, as the app's does: the development ones time and
	// record every component on every render, costing a frame many times over.
	define["process.env.NODE_ENV"] = JSON.stringify(
		dev ? "development" : "production",
	);
	log({
		message: `Environment${dev ? " · dev" : ""}`,
		details: Object.keys(define).join(", "),
	});

	const status = await task("Compiling");

	let result: BuildResult | null = null;

	try {
		result = await Bun.build({
			// the highlight worker is its own entrypoint so Shiki stays out of the
			// main bundle; `client.ts` starts it from beside `index`
			entrypoints: ["./src/index.ts", "./src/highlight.ts"],
			banner: "globalThis.UPNG = undefined;",
			plugins: [
				// @afmize/node's library needs nothing here: its Bun entry imports
				// it as a file, which Bun copies beside the bundle (or embeds in a
				// compiled binary).
				{
					name: "react-compiler",
					setup: (build) => {
						build.onLoad({ filter: /\.jsx?$|\.tsx?$/ }, async (args) => {
							if (args.path.includes("node_modules")) return;

							const source = await Bun.file(args.path).text();
							const extension = args.path.split(".").at(-1) ?? "";

							const plugins: PluginConfig[] = [];
							if (extension.startsWith("t")) plugins.push("typescript");
							if (extension.endsWith("x")) plugins.push("jsx");

							const result = await Babel.transformAsync(source, {
								filename: args.path,
								babelrc: false,
								configFile: false,
								parserOpts: { plugins },
								generatorOpts: { retainLines: false },
								plugins: [["babel-plugin-react-compiler", { target: "19" }]],
							});
							return { contents: result?.code ?? source };
						});
					},
				},
			],
			define,
			...options,
		});
	} catch (error) {
		result = {
			success: false,
			logs: [{ error }],
			outputs: [],
		};
	} finally {
		if (result?.success) {
			await status.complete({ status: "Compiled" });
		} else {
			await status.fail({ status: "Failed to compile" });
		}
		if (result) {
			log({
				details: result.outputs
					.map(
						(output) =>
							`${output.path.split("/").at(-1)} ${chalk.gray(`@ ${(output.size / 1024 / 1024).toFixed(1)} MB`)}`,
					)
					.join("\n"),
			});
		}
		for (const entry of result?.logs ?? []) {
			if ("error" in entry) {
				log({ message: inspect(entry.error), level: "error" });
			} else {
				log({
					message: entry.message,
					level:
						entry.level === "error" || entry.level === "warning"
							? entry.level
							: "info",
				});
			}
		}
	}

	return result;
}
