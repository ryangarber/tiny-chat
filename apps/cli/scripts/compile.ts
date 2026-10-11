import { fileURLToPath } from "node:url";
import * as Babel from "@babel/core";
import chalk from "chalk";
import { zClientEnv } from "#core/core/types/env.ts";
import { buildAfmize } from "../../../scripts/build-afmize.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { create, print } from "../../../scripts/use-stdout.ts";

// biome-ignore lint/correctness/useHookAtTopLevel: not a hook
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

/** The stub `AFMLibrary.ts` that `afmize` stands in for once it is built. */
const AFM_LIBRARY = fileURLToPath(
	new URL("../src/core/services/AFMLibrary.ts", import.meta.url),
);

export async function compile({
	dev = false,
	...options
}: Partial<Parameters<typeof Bun.build>[0]> & {
	dev?: boolean;
} = {}): Promise<BuildResult | null> {
	const afmize = await buildAfmize(dev ? "debug" : "release");

	const define = Object.fromEntries(
		Object.entries(environment).flatMap(([key, value]) => {
			if (key === "process.env.DEV") {
				return dev ? [] : [["process.env.DEV", ""]];
			}
			return [[key, value]];
		}),
	);
	print({
		message: `environment${dev ? " · dev" : ""}`,
		details: Object.keys(define).join(", "),
		level: "verbose",
	});

	const update = create("compiling");

	let result: BuildResult | null = null;

	try {
		result = await Bun.build({
			// the highlight worker is its own entrypoint so Shiki stays out of the
			// main bundle; `client.ts` starts it from beside `index`
			entrypoints: ["./src/index.ts", "./src/highlight.ts"],
			banner: "globalThis.UPNG = undefined;",
			plugins: [
				{
					// Embedded as a file: in a compiled binary, Bun extracts it for
					// `dlopen`; in `dist/`, it is copied beside the bundle.
					name: "afmize",
					setup: (build) => {
						if (!afmize) return;
						build.onLoad({ filter: /[\\/]AFMLibrary\.ts$/ }, (args) =>
							args.path === AFM_LIBRARY
								? {
										contents: `import library from ${JSON.stringify(afmize)} with { type: "file" };\nexport default library;`,
										loader: "ts",
									}
								: undefined,
						);
					},
				},
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
		update(
			result?.success ? "compiled" : "failed to compile",
			!result?.success ? "error" : undefined,
		);
		if (result) {
			print({
				details: result.outputs.map(
					(output) =>
						`${output.path.split("/").at(-1)} ${chalk.gray(`@ ${(output.size / 1024 / 1024).toFixed(1)} MB`)}`,
				),
			});
		}
		for (const log of result?.logs ?? []) {
			if ("error" in log) {
				print({ details: log.error });
			} else {
				print(log);
			}
		}
	}

	return result;
}
