import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
	type CanUseTool,
	createSdkMcpServer,
	getSessionInfo,
	type Options,
	query,
	type SDKUserMessage,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import {
	CLAUDE_CODE_SERVER,
	CLAUDE_CODE_TOOL_PREFIX,
	type ClaudeCodeBridge,
	type ClaudeCodeHandlers,
	type ClaudeCodeRequest,
	type ClaudeCodeStatus,
} from "#core/features/provider/types/claudeCode.ts";

/**
 * Runs Claude Code through the Agent SDK, on the user's installed `claude` and
 * its own sign-in. Node and Bun only: the CLI runs it in its own process, the
 * desktop app in its main process.
 */

/** How long a status is trusted, since it is asked for before every turn. */
const STATUS_MS = { valid: 60_000, invalid: 5_000 };

/** Where Claude Code's installer puts `claude`, beyond the login shell's path. */
const KNOWN_PATHS = [
	join(homedir(), ".local", "bin", "claude"),
	join(homedir(), ".claude", "local", "claude"),
];

const exec = (file: string, args: string[], env: Record<string, string>) =>
	new Promise<string>((resolve, reject) =>
		execFile(file, args, { env, timeout: 15_000 }, (error, stdout) =>
			error ? reject(error) : resolve(stdout),
		),
	);

/**
 * The environment Claude Code runs in: the user's login shell, without an API
 * key, so it runs on their subscription rather than billing a key it finds.
 */
const getEnv = async () => {
	const env = await NodeShellService.env({ login: true });
	delete env.ANTHROPIC_API_KEY;
	// Set inside a Claude Code session, where it would refuse to nest.
	delete env.CLAUDECODE;
	return env;
};

let executable: Promise<string | null> | undefined;
const findExecutable = () =>
	(executable ??= (async () => {
		const env = await getEnv();
		const candidates = [
			...(env.PATH ?? "")
				.split(delimiter)
				.filter(Boolean)
				.map((dir) =>
					join(dir, process.platform === "win32" ? "claude.exe" : "claude"),
				),
			...KNOWN_PATHS,
		];
		for (const candidate of candidates) {
			try {
				await access(candidate, constants.X_OK);
				return candidate;
			} catch {}
		}
		return null;
	})());

let status: { value: ClaudeCodeStatus; at: number } | undefined;

/** A JSON schema as the zod shape the SDK takes tools' inputs as. */
const toShape = (schema: unknown) => {
	try {
		const parsed = z.fromJSONSchema(schema as any);
		if (parsed instanceof z.ZodObject) return parsed.shape;
	} catch (error) {
		console.warn("[ClaudeCodeRunService] unreadable tool schema:", error);
	}
	return {};
};

const getOptions = async ({
	request,
	handlers,
	abort,
}: {
	request: ClaudeCodeRequest;
	handlers: ClaudeCodeHandlers;
	abort: AbortController;
}): Promise<{ options: Options; resumed: boolean }> => {
	const cwd = request.cwd ?? homedir();
	const resumed =
		!!request.resume &&
		!!(await getSessionInfo(request.resume, { dir: cwd }).catch(() => null));

	const canUseTool: CanUseTool = async (name, input, { toolUseID }) => {
		if (request.mode === "tiny-chat") {
			// Tiny Chat's own tools ask the user themselves, as they run.
			return name.startsWith(CLAUDE_CODE_TOOL_PREFIX)
				? { behavior: "allow", updatedInput: input }
				: { behavior: "deny", message: `${name} is not available.` };
		}
		const answer = await handlers.canUseTool({
			name,
			input,
			toolUseId: toolUseID,
		});
		return answer.allow
			? {
					behavior: "allow",
					updatedInput:
						(answer.updatedInput as Record<string, unknown> | undefined) ??
						input,
				}
			: {
					behavior: "deny",
					message: answer.message ?? "The user rejected this tool call.",
				};
	};

	const options: Options = {
		model: request.model,
		effort: request.effort,
		cwd,
		env: await getEnv(),
		pathToClaudeCodeExecutable: (await findExecutable()) ?? undefined,
		abortController: abort,
		includePartialMessages: true,
		thinking: { type: "adaptive", display: "summarized" },
		canUseTool,
		...(resumed ? { resume: request.resume, forkSession: true } : {}),
	};

	if (request.mode === "claude-code") {
		Object.assign(options, {
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: request.system,
			},
			settingSources: ["user", "project", "local"],
		} satisfies Options);
	} else {
		const server = createSdkMcpServer({
			name: CLAUDE_CODE_SERVER,
			alwaysLoad: true,
			tools: (request.tools ?? []).map((definition) =>
				tool(
					definition.name,
					definition.description,
					toShape(definition.inputSchema),
					async (input, extra) => {
						const meta = (extra as { _meta?: Record<string, unknown> })?._meta;
						const result = await handlers.callTool({
							name: definition.name,
							input,
							toolUseId: meta?.["claudecode/toolUseId"] as string | undefined,
						});
						return { content: result.content, isError: result.isError };
					},
				),
			),
		});
		Object.assign(options, {
			tools: [],
			systemPrompt: request.system ?? "",
			settingSources: [],
			strictMcpConfig: true,
			settings: { disableClaudeAiConnectors: true },
			mcpServers: { [CLAUDE_CODE_SERVER]: server },
		} satisfies Options);
	}

	return { options, resumed };
};

/**
 * A run's input: the prompt, then what the user queues while it goes, until
 * it is closed.
 */
const createInput = () => {
	const messages: SDKUserMessage[] = [];
	let wake: (() => void) | undefined;
	let closed = false;
	const message = (content: unknown[]): SDKUserMessage => ({
		type: "user",
		message: { role: "user", content: content as any },
		parent_tool_use_id: null,
	});
	return {
		send: (content: unknown[]) => {
			if (closed) return;
			messages.push(message(content));
			wake?.();
		},
		close: () => {
			closed = true;
			wake?.();
		},
		messages: (async function* () {
			while (true) {
				while (messages.length) yield messages.shift() as SDKUserMessage;
				if (closed) return;
				await new Promise<void>((resolve) => (wake = resolve));
			}
		})(),
	};
};

const runs = new Map<
	string,
	{ abort: AbortController; input: ReturnType<typeof createInput> }
>();

export const ClaudeCodeRunService = {
	status: async (): Promise<ClaudeCodeStatus> => {
		if (
			status &&
			Date.now() - status.at <
				(status.value.loggedIn ? STATUS_MS.valid : STATUS_MS.invalid)
		)
			return status.value;

		let value: ClaudeCodeStatus;
		const file = await findExecutable();
		if (!file) {
			// Checked again next time: the user may install it meanwhile.
			executable = undefined;
			value = { installed: false, loggedIn: false };
		} else {
			try {
				const env = await getEnv();
				const [version, auth] = await Promise.all([
					exec(file, ["--version"], env),
					exec(file, ["auth", "status"], env).catch(
						(error) => error?.stdout ?? "{}",
					),
				]);
				value = {
					installed: true,
					loggedIn: JSON.parse(auth || "{}").loggedIn === true,
					version: version.trim().split(" ")[0],
				};
			} catch (error) {
				value = {
					installed: true,
					loggedIn: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		status = { value, at: Date.now() };
		return value;
	},

	run: async (request, handlers) => {
		const id = crypto.randomUUID();
		const abort = new AbortController();
		const input = createInput();
		runs.set(id, { abort, input });

		void (async () => {
			try {
				const { options, resumed } = await getOptions({
					request,
					handlers,
					abort,
				});
				input.send([
					// A session that starts over is told what came before.
					...(!resumed && request.history
						? [{ type: "text", text: request.history }]
						: []),
					...request.prompt,
				]);
				// Ends once the input is closed and everything sent is answered.
				for await (const message of query({
					prompt: input.messages,
					options,
				}))
					handlers.onEvent({ type: "message", message });
			} catch (error) {
				if (!abort.signal.aborted)
					handlers.onEvent({
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
			} finally {
				input.close();
				runs.delete(id);
				handlers.onEvent({ type: "end" });
			}
		})();

		return id;
	},

	send: (id, prompt) => {
		runs.get(id)?.input.send(prompt);
	},

	close: (id) => {
		runs.get(id)?.input.close();
	},

	cancel: (id) => {
		const run = runs.get(id);
		run?.input.close();
		run?.abort.abort();
	},
} as const satisfies ClaudeCodeBridge;
