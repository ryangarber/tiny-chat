import { execFile } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
	type CanUseTool,
	createSdkMcpServer,
	getSessionInfo,
	type HookCallback,
	type HookInput,
	type Options,
	type Query,
	query,
	type SDKUserMessage,
	type SettingSource,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import { FileSystemUtils } from "#client/features/shell/utils/FileSystemUtils.ts";
import {
	FileChangeService,
	type FileChangeShell,
} from "#core/features/file/services/FileChangeService.ts";
import { WorktreeUtils } from "#core/features/file/utils/WorktreeUtils.ts";
import {
	CLAUDE_CODE_SERVER,
	CLAUDE_CODE_TOOL_PREFIX,
	type ClaudeCodeBridge,
	type ClaudeCodeHandlers,
	type ClaudeCodeModel,
	type ClaudeCodeRequest,
	type ClaudeCodeSettings,
	type ClaudeCodeStatus,
} from "#core/features/provider/types/claude.ts";

/**
 * Runs Claude Code through the Agent SDK, on the user's installed `claude` and
 * its own sign-in. Node and Bun only: the CLI runs it in its own process, the
 * desktop app in its main process.
 */

/** How long a status is trusted, since it is asked for before every turn. */
const STATUS_MS = { valid: 60_000, invalid: 5_000 };
/**
 * How long what `claude` offers is trusted. Asking starts it, so it is asked
 * again only this rarely, or once its version or sign-in changes.
 */
const OFFER_MS = 30 * 60_000;
/** How long asking may take before the status goes without it. */
const OFFER_TIMEOUT_MS = 20_000;

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
	return { ...env };
};

/** A setting holding JSON, or nothing if it is empty or unreadable. */
const parseJson = <T>(value: string | undefined, name: string) => {
	if (!value?.trim()) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		console.warn(`[ClaudeCodeRunService] ${name} is not valid JSON`);
		return undefined;
	}
};

const SETTING_SOURCES: SettingSource[] = ["user", "project", "local"];

/**
 * The main checkout `cwd` is a worktree of, whose project settings, agents and
 * skills apply to it: a worktree's own may be a branch's, or missing.
 */
const getProjectRoot = async (cwd: string) => {
	try {
		const output = await exec(
			"git",
			["-C", cwd, ...WorktreeUtils.args],
			await getEnv(),
		);
		return WorktreeUtils.parse(output)?.main;
	} catch {
		return undefined;
	}
};

let executable: Promise<string | null> | undefined;
const findExecutable = async (
	settings?: Pick<ClaudeCodeSettings, "executable">,
) => {
	const chosen = settings?.executable?.trim();
	if (chosen) {
		try {
			await access(chosen, constants.X_OK);
			return chosen;
		} catch {
			return null;
		}
	}
	executable ??= (async () => {
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
	})();
	return executable;
};

let status:
	| { value: ClaudeCodeStatus; at: number; executable?: string }
	| undefined;
let offer:
	| {
			value: Pick<
				ClaudeCodeStatus,
				"models" | "agents" | "outputStyles" | "outputStyle"
			>;
			at: number;
			key: string;
	  }
	| undefined;

/**
 * What the signed-in `claude` offers: its models, agents and output styles.
 * It is started without a prompt to say, then stopped.
 */
const getOffer = async (file: string, key: string) => {
	if (offer?.key === key && Date.now() - offer.at < OFFER_MS)
		return offer.value;
	const abort = new AbortController();
	const timeout = setTimeout(() => abort.abort(), OFFER_TIMEOUT_MS);
	let run: Query | undefined;
	try {
		run = query({
			// Never sends anything: the session only starts up.
			prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
				await new Promise((resolve) =>
					abort.signal.addEventListener("abort", resolve),
				);
			})(),
			options: {
				cwd: homedir(),
				env: await getEnv(),
				pathToClaudeCodeExecutable: file,
				abortController: abort,
				persistSession: false,
				settingSources: ["user"],
			},
		});
		const result = await Promise.race([
			run.initializationResult(),
			new Promise<never>((_, reject) =>
				abort.signal.addEventListener("abort", () =>
					reject(new Error("Timed out")),
				),
			),
		]);
		const value = {
			models: result.models.map(
				(model): ClaudeCodeModel => ({
					value: model.value,
					displayName: model.displayName,
					efforts: model.supportsEffort
						? model.supportedEffortLevels
						: undefined,
					adaptiveThinking: model.supportsAdaptiveThinking,
					fastMode: model.supportsFastMode,
					autoMode: model.supportsAutoMode,
				}),
			),
			agents: result.agents.map((agent) => agent.name),
			outputStyles: result.available_output_styles,
			outputStyle: result.output_style,
		};
		offer = { value, at: Date.now(), key };
		return value;
	} catch (error) {
		console.warn("[ClaudeCodeRunService] could not ask claude:", error);
		return offer?.key === key ? offer.value : {};
	} finally {
		clearTimeout(timeout);
		abort.abort();
		run?.close();
	}
};

/** Claude Code's own tools that can change files without Tiny Chat's knowing. */
const CHANGING_TOOLS = new Set([
	"Bash",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
	// A subagent's calls are not watched one by one: what it changed shows on
	// the call that started it.
	"Task",
	"Agent",
]);

/** `git` and the files it names, straight off this machine's disk. */
const changeShell: FileChangeShell = {
	run: async ({ program, args }) => {
		const env = await getEnv();
		return await new Promise((resolve) =>
			execFile(
				program,
				args,
				{ env, maxBuffer: 64 * 1024 * 1024, timeout: 15_000 },
				(error, stdout, stderr) =>
					resolve({
						code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
						stdout,
						stderr,
					}),
			),
		);
	},
	exec: async () => {
		throw new Error("Only programs run directly");
	},
	readFile: async ({ path }) => ({ path, data: await readFile(path) }),
	readFiles: FileSystemUtils.readFiles,
};

/**
 * Brackets Claude Code's own calls that may change files, so what they changed
 * is sent along as a `changes` event. Tiny Chat's tools, over MCP, track their
 * own; a subagent's calls are left to the call that started it.
 */
const createChangeHooks = ({
	folders,
	handlers,
}: {
	folders: string[];
	handlers: ClaudeCodeHandlers;
}) => {
	const tracker = FileChangeService.createTracker({
		shell: changeShell,
		folders: async () => folders,
	});
	/** Calls begun and not yet ended, so a rejected one can be let go. */
	const begun = new Set<string>();

	const isTracked = (
		input: HookInput,
	): input is HookInput & {
		tool_name: string;
		tool_input: unknown;
		tool_use_id: string;
	} => {
		if (!("tool_name" in input) || !("tool_use_id" in input)) return false;
		if (input.agent_id || input.tool_name.startsWith(CLAUDE_CODE_TOOL_PREFIX))
			return false;
		const background = (input.tool_input as { run_in_background?: unknown })
			?.run_in_background;
		// Its window would take in every call made while it runs.
		if (background === true) return false;
		return (
			CHANGING_TOOLS.has(input.tool_name) || input.tool_name.startsWith("mcp__")
		);
	};

	const before: HookCallback = async (input) => {
		if (isTracked(input) && !begun.has(input.tool_use_id)) {
			begun.add(input.tool_use_id);
			await tracker.begin();
		}
		return {};
	};

	const after: HookCallback = async (input) => {
		if (isTracked(input) && begun.delete(input.tool_use_id)) {
			const changes = await tracker.end();
			if (changes)
				handlers.onEvent({
					type: "changes",
					toolUseId: input.tool_use_id,
					changes,
				});
		}
		return {};
	};

	/** A call that will not run after all. */
	const cancel = (toolUseId: string) => {
		if (begun.delete(toolUseId)) tracker.cancel();
	};

	const denied: HookCallback = async (input) => {
		if ("tool_use_id" in input && typeof input.tool_use_id === "string")
			cancel(input.tool_use_id);
		return {};
	};

	return {
		hooks: {
			PreToolUse: [{ hooks: [before] }],
			PostToolUse: [{ hooks: [after] }],
			PostToolUseFailure: [{ hooks: [after] }],
			PermissionDenied: [{ hooks: [denied] }],
		} satisfies Options["hooks"],
		cancel,
	};
};

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
	const [cwd = homedir(), ...additionalDirectories] = request.folders ?? [];
	const settings = request.settings ?? {};
	const resumed =
		!!request.resume &&
		!!(await getSessionInfo(request.resume, { dir: cwd }).catch(() => null));

	const changes = createChangeHooks({
		folders: request.folders?.length ? request.folders : [cwd],
		handlers,
	});

	/** Claude Code's permission flow asking about one of its own tools. */
	const canUseTool: CanUseTool = async (name, input, { toolUseID }) => {
		const answer = await handlers.canUseTool({
			name,
			input,
			toolUseId: toolUseID,
		});
		if (!answer.allow) changes.cancel(toolUseID);
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

	const allow: HookCallback = async () => ({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
		},
	});

	// Tiny Chat's tools, which ask the user themselves as they run.
	const tinyChat = request.tools?.length
		? createSdkMcpServer({
				name: CLAUDE_CODE_SERVER,
				alwaysLoad: true,
				tools: request.tools.map((definition) =>
					tool(
						definition.name,
						definition.description,
						toShape(definition.inputSchema),
						async (input, extra) => {
							const meta = (extra as { _meta?: Record<string, unknown> })
								?._meta;
							const result = await handlers.callTool({
								name: definition.name,
								input,
								toolUseId: meta?.["claudecode/toolUseId"] as string | undefined,
							});
							return { content: result.content, isError: result.isError };
						},
					),
				),
			})
		: undefined;

	const fileSettings = settings.settings?.trim();
	const flagSettings = {
		...(fileSettings?.startsWith("{")
			? parseJson<Record<string, unknown>>(fileSettings, "settings")
			: undefined),
		...(request.fastMode !== undefined ? { fastMode: request.fastMode } : {}),
		...(request.outputStyle ? { outputStyle: request.outputStyle } : {}),
		// Without its own setup, it brings none of the user's connectors.
		...(request.claudeCode ? {} : { disableClaudeAiConnectors: true }),
	};

	const options: Options = {
		model: request.model,
		effort: request.effort,
		thinking: request.thinking ?? { type: "adaptive", display: "summarized" },
		cwd,
		additionalDirectories,
		projectConfigRoot: await getProjectRoot(cwd),
		env: await getEnv(),
		pathToClaudeCodeExecutable: (await findExecutable(settings)) ?? undefined,
		abortController: abort,
		includePartialMessages: true,
		// A subagent's work shows inside its call, as Tiny Chat's own do.
		forwardSubagentText: true,
		systemPrompt: request.claudeCode
			? { type: "preset", preset: "claude_code", append: request.system }
			: (request.system ?? ""),
		// Its default tools, or none.
		tools: request.claudeCode ? undefined : [],
		settingSources: request.claudeCode ? SETTING_SOURCES : [],
		strictMcpConfig: !request.claudeCode || undefined,
		mcpServers: tinyChat ? { [CLAUDE_CODE_SERVER]: tinyChat } : undefined,
		// Tiny Chat's tools skip Claude Code's permission flow, in any mode.
		hooks: {
			...changes.hooks,
			PreToolUse: [
				...changes.hooks.PreToolUse,
				...(tinyChat
					? [{ matcher: `^${CLAUDE_CODE_TOOL_PREFIX}`, hooks: [allow] }]
					: []),
			],
		},
		agent: request.agent,
		permissionMode: request.permissions,
		allowDangerouslySkipPermissions:
			request.permissions === "bypassPermissions" || undefined,
		canUseTool,
		outputFormat: request.schema
			? { type: "json_schema", schema: request.schema }
			: undefined,
		// A settings file is read by Claude Code itself, which can't merge it.
		settings:
			fileSettings && !fileSettings.startsWith("{")
				? fileSettings
				: Object.keys(flagSettings).length
					? (flagSettings as Options["settings"])
					: undefined,
		...(resumed ? { resume: request.resume, forkSession: true } : {}),
	};

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

interface Run {
	abort: AbortController;
	input: ReturnType<typeof createInput>;
	query?: Query;
	/** The subagents running, by the call that started them. */
	tasks: Map<string, string>;
}

const runs = new Map<string, Run>();

export const ClaudeCodeRunService = {
	status: async (settings): Promise<ClaudeCodeStatus> => {
		const chosen = settings?.executable?.trim() || undefined;
		if (
			status &&
			status.executable === chosen &&
			Date.now() - status.at <
				(status.value.loggedIn ? STATUS_MS.valid : STATUS_MS.invalid)
		)
			return status.value;

		let value: ClaudeCodeStatus;
		const file = await findExecutable(settings);
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
				if (value.loggedIn)
					Object.assign(
						value,
						await getOffer(file, `${file}@${value.version}`),
					);
			} catch (error) {
				value = {
					installed: true,
					loggedIn: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		status = { value, at: Date.now(), executable: chosen };
		return value;
	},

	run: async (request, handlers) => {
		const id = crypto.randomUUID();
		const abort = new AbortController();
		const input = createInput();
		const run: Run = {
			abort,
			input,
			tasks: new Map(),
		};
		runs.set(id, run);

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
				run.query = query({ prompt: input.messages, options });
				// Ends once the input is closed and everything sent is answered.
				for await (const message of run.query) {
					if (
						message.type === "system" &&
						message.subtype === "task_started" &&
						message.tool_use_id
					)
						run.tasks.set(message.tool_use_id, message.task_id);
					handlers.onEvent({ type: "message", message });
				}
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

	stopTask: async (id, toolUseId) => {
		const run = runs.get(id);
		const task = run?.tasks.get(toolUseId);
		if (task) await run?.query?.stopTask(task).catch(() => {});
	},
} as const satisfies ClaudeCodeBridge;
