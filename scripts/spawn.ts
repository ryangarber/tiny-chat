import { spawn as _spawn, type SpawnOptions } from "node:child_process";
import { create, print } from "./use-stdout.ts";

type SpawnResult = {
	stdout: string;
	stderr: string;
	code?: number;
	signal?: NodeJS.Signals;
	error?: Error;
};

const getReason = ({ error, code, signal }: SpawnResult) =>
	error
		? error.message
		: code
			? `exited with code ${code}`
			: `terminated by signal ${signal}`;

/** What `spawn` rejects with: why it failed, and everything it printed. */
export class SpawnError extends Error implements SpawnResult {
	stdout: string;
	stderr: string;
	code?: number;
	signal?: NodeJS.Signals;
	error?: Error;

	constructor(command: string, result: SpawnResult) {
		super(`${command} failed: ${getReason(result)}`, { cause: result.error });
		this.name = "SpawnError";
		this.stdout = result.stdout;
		this.stderr = result.stderr;
		this.code = result.code;
		this.signal = result.signal;
		this.error = result.error;
	}
}

const quoteForCmd = (arg: string) =>
	/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`;

const tail = (text: string, lines: number) =>
	text.trimEnd().split("\n").slice(-lines).join("\n");

/**
 * Runs a command to completion, collecting its output.
 *
 * - `label`: what it does, while it runs and once it ends: `[work, working?,
 *   worked?]`, such as `["gui build", "building gui"]`.
 * - `errors`: on failure, whether to reject (with a `SpawnError`), resolve
 *   anyway, or exit this process with its code.
 * - `output`: whether to print its stdout and stderr once it ends; `"tail"`
 *   prints only the end of stdout (more of it, if it fails), for a build step
 *   that would print pages.
 *
 * On Windows, `pnpm` and the like are `.cmd` shims that only a shell runs, so
 * a command there always runs in one, quoted for cmd.exe. A command given
 * `shell: true` is joined as it is; it quotes its own arguments.
 */
export async function spawn({
	command,
	label,
	env = process.env,
	errors = "reject",
	output = true,
	...options
}: SpawnOptions & {
	command: (string | number)[];
	label?: [string, string?, string?];
	errors?: "resolve" | "reject" | "exit";
	output?: boolean | "tail";
}): Promise<SpawnResult> {
	const { resolve, reject, promise } = Promise.withResolvers<SpawnResult>();

	const [script, ...args] = command.map((arg) => arg.toString());

	const [work, working, worked] = label ?? [];

	const update = label ? create(working ?? `running ${work}`) : undefined;

	// Node joins the arguments of a command in a shell unquoted (and warns
	// about it), so it is given the line instead.
	const child = options.shell
		? _spawn([script, ...args].join(" "), { ...options, env })
		: process.platform === "win32"
			? _spawn([script, ...args].map(quoteForCmd).join(" "), {
					...options,
					env,
					shell: true,
				})
			: _spawn(script, args, { ...options, env });

	let stdout = "";
	child.stdout?.on("data", (data) => (stdout += data));

	let stderr = "";
	child.stderr?.on("data", (data) => (stderr += data));

	const flush = (
		failed: boolean,
		...status: Parameters<NonNullable<typeof update>>
	) => {
		update?.(...status);
		if (!output) return;
		const out = output === "tail" ? tail(stdout, failed ? 25 : 10) : stdout;
		if (out.trim().length)
			print({ message: "stdout", details: out, level: "verbose" });
		if (stderr.trim().length)
			print({ message: "stderr", details: stderr, level: "verbose" });
	};

	// A command that cannot start may report both an error and its close.
	let done = false;

	const complete = ({
		code,
		signal,
		error,
	}: {
		code?: number | null;
		signal?: NodeJS.Signals | null;
		error?: Error | null;
	}) => {
		if (done) return;
		done = true;
		const result = {
			code: code ?? undefined,
			signal: signal ?? undefined,
			error: error ?? undefined,
			stdout,
			stderr,
		};
		if (result.code === 0) {
			flush(false, worked ?? `${work} succeeded`);
			resolve(result);
		} else {
			flush(true, `${work} failed: ${getReason(result)}`, "error");
			if (errors === "reject") reject(new SpawnError(script, result));
			else if (errors === "exit") process.exit(result.code ?? 1);
			else resolve(result);
		}
	};

	child.on("close", (code, signal) => complete({ code, signal }));

	child.on("error", (error) => complete({ error }));

	return promise;
}
