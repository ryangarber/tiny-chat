import type { z } from "zod";
import type { Enum } from "#core/core/services/PostgresService.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type {
	MemorySearchResult,
	MemorySource,
	MemoryState,
} from "#core/features/data/types/memory.ts";
import type {
	MessageLike,
	MessageSearchResult,
} from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import type { FileNode } from "#core/features/file/types/file.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import type {
	zBrowserRunResult,
	zBrowserStatus,
	zBrowserStep,
} from "#core/features/tool/types/browser.ts";
import type {
	zLegiscanBill,
	zLegiscanBillInput,
	zLegiscanBillSummary,
	zLegiscanSession,
	zLegiscanSessionInput,
	zLegiscanSessionsInput,
} from "#core/features/tool/types/legiscan.ts";

export interface WebCapability {
	search: (_: { query: string; maxResults: number }) => Promise<zWebContext[]>;

	view: (_: { url: string }) => Promise<zWebContext>;
}

export interface LegiscanCapability {
	listSessions: (
		_: z.infer<typeof zLegiscanSessionsInput>,
	) => Promise<z.infer<typeof zLegiscanSession>[]>;
	listBills: (
		_: z.infer<typeof zLegiscanSessionInput>,
	) => Promise<z.infer<typeof zLegiscanBillSummary>[]>;
	getBill: (
		_: z.infer<typeof zLegiscanBillInput>,
	) => Promise<z.infer<typeof zLegiscanBill>>;
}

export interface GitHubCapability {
	request: (_: {
		path: string;
		query?: Record<string, string | number | boolean | undefined>;
	}) => Promise<unknown>;
}

export interface EmbeddingCapability {
	getEmbedding: (_: { message: MessageLike }) => Promise<number[] | null>;

	runEmbedding: (_: { text: string }) => Promise<number[]>;
}

export interface SubagentsCapability {
	/**
	 * Runs a subagent. Given the call that ran it, its transcript is kept with
	 * the reply holding that call, so it can be read back with the reply.
	 */
	runSubagent: (_: {
		/** The call's part id, and the id of the reply it is in. */
		part?: { id: string; message: string };
		context: zAgentContext;
		instructions?: string;
		onData: (data: zData) => void;
		abort?: AbortSignal;
	}) => Promise<zData>;
}

export interface ActionsCapability {
	getActions: () => Promise<ActionState[]>;

	createAction: (_: {
		data: zData;
		schedule: string;
		timezone: string;
	}) => Promise<ActionState>;

	updateAction: (_: {
		id: string;
		data: zData;
		schedule: string;
		timezone: string;
	}) => Promise<ActionState>;

	deleteAction: (_: { id: string }) => Promise<ActionState>;
}

export interface MemoriesCapability {
	retrieveMemories: (_: {
		messages: MemorySource[];
		tokens: number;
	}) => Promise<MemorySearchResult[][]>;

	searchMemories: (_: {
		searchText: string;
		searchEmbedding?: number[];
	}) => Promise<MemorySearchResult[]>;

	createMemory: (_: {
		fact: string;
		category: Enum["MemoryCategory"];
		stability: Enum["MemoryStability"];
		evidence: string[];
		confidence: number;
	}) => Promise<MemoryState>;

	updateMemory: (_: {
		id: string;
		fact: string;
		category: Enum["MemoryCategory"];
		stability: Enum["MemoryStability"];
		evidence: string[];
		confidence: number;
	}) => Promise<MemoryState>;

	deleteMemory: (_: { id: string }) => Promise<MemoryState>;

	searchChats: (_: {
		searchText: string;
		searchEmbedding?: number[];
	}) => Promise<MessageSearchResult[]>;
}

/**
 * What a shell is and how it reads commands. `dialect` decides whether a
 * command can be judged by parsing it as bash; `label` is how it is described
 * to the model, as in "PowerShell on Windows" or "bash in WSL (Ubuntu)".
 */
export interface ShellEnvironment {
	os: "windows" | "macos" | "linux";
	dialect: "bash" | "powershell";
	label: string;
}

export interface ShellCapability {
	cwd?: () => Promise<string>;

	chdir?: (_: { path: string }) => Promise<void>;

	/**
	 * The user's folders that resolve for this shell, as stored, with the one it
	 * starts in first. Folders sync across devices, so a folder picked on one
	 * may not exist on another; those are left out.
	 */
	folders?: () => Promise<string[]>;

	/** The shell as it stands in its current directory. */
	environment?: () => ShellEnvironment;

	/**
	 * A path as this shell spells it. Folders are stored the way the user
	 * picked them (`C:\work`, `\\wsl.localhost\Ubuntu\home\me`), while a shell
	 * may print them otherwise (`/c/work`, `/home/me`); anything comparing the
	 * two goes through here first. Shells that spell paths one way leave it out.
	 */
	toShellPath?: (_: { path: string }) => string;

	/**
	 * A program run directly with these arguments in the shell's directory,
	 * with no shell in between to quote for. For callers that build commands
	 * out of paths, which every dialect would quote differently.
	 */
	run?: (_: {
		program: string;
		args: string[];
		abort?: AbortSignal;
	}) => Promise<{ code?: number; stdout: string; stderr: string }>;

	readFile: (_: {
		path: string;
	}) => Promise<{ path: string; data: Uint8Array }>;

	/**
	 * Several files in one call, for shells that can do it natively — one call
	 * instead of one `readFile` per file. At most `maxBytes` of each is read;
	 * `size` is the whole file's. Results line up with `paths`, and a file that
	 * cannot be read is null rather than failing the rest. What to make of the
	 * bytes is not this method's job: `FileSearchService.readFiles` falls
	 * back to `readFile` for shells without it.
	 */
	readFiles?: (_: {
		paths: string[];
		maxBytes: number;
	}) => Promise<({ data: Uint8Array; size: number } | null)[]>;

	readDir: (_: {
		path: string;
	}) => Promise<{ path: string; is_dir: boolean }[]>;

	/**
	 * Breadth-first listing of everything under `path`, for shells that can do
	 * it natively — one call instead of one `readDir` per directory. Each
	 * directory's entries are sorted by path. A directory whose lower-cased name
	 * is in `prune`, or that sits deeper than `maxDepth`, is reported but not
	 * descended into. Deciding what a caller should see is not this method's
	 * job: `FileSearchService.walk` filters what it returns, and falls back to
	 * `readDir` for shells without it.
	 *
	 * `root` is `path` as the shell resolved it, which every entry sits under.
	 * A file's `size` is worth reporting wherever it comes with the listing for
	 * free: a search then never opens a file it would only throw away.
	 */
	walk?: (_: {
		path: string;
		maxDepth: number;
		maxEntries: number;
		prune: string[];
	}) => Promise<{
		root: string;
		entries: { path: string; is_dir: boolean; size?: number }[];
		truncated: boolean;
	}>;

	writeFile: (_: {
		path: string;
		content: string;
	}) => Promise<{ path: string; success: true }>;

	/**
	 * `onOutput` is called with output as it arrives, for shells that can
	 * report it. The resolved value always carries the complete output, so a
	 * shell that cannot stream simply never calls it.
	 *
	 * `abort` kills the command and everything it started; the call then
	 * resolves with whatever output it had. Output is kept bounded (head and
	 * tail) by the shell, since a command like `find /` never stops writing.
	 */
	exec: (_: {
		command: string;
		stream?: (_: { type: "stdout" | "stderr"; value: string }) => void;
		abort?: AbortSignal;
	}) => Promise<{ code?: number; stdout: string; stderr: string }>;

	nodes?: () => Promise<FileNode[]>;
}

/**
 * A real browser on the user's machine, driven through Playwright. The page and
 * its state outlive a call, so one run can pick up where the last left off.
 */
export interface BrowserCapability {
	status: () => Promise<zBrowserStatus>;

	/**
	 * Runs steps in order against the active tab, stopping at the first that
	 * fails. `screenshot` adds one of the viewport once they are done.
	 */
	run: (_: {
		steps: zBrowserStep[];
		screenshot?: boolean;
		abort?: AbortSignal;
	}) => Promise<zBrowserRunResult>;
}

/**
 * The apps on the user's machine, through xa11y on the host
 * (`ComputerHostService`): accessibility trees, element actions, input, and
 * screenshots. The host only carries calls; what they mean is decided in
 * `ComputerService`.
 */
export interface ComputerCapability {
	/** Resolves with the host's raw `{ ok, result }` or `{ ok, error }`. */
	call: (_: {
		method: string;
		params: unknown;
		abort?: AbortSignal;
	}) => Promise<unknown>;
}

export interface Capabilities {
	web?: WebCapability;
	github?: GitHubCapability;
	legiscan?: LegiscanCapability;
	embedding?: EmbeddingCapability;
	subagents?: SubagentsCapability;
	actions?: ActionsCapability;
	memories?: MemoriesCapability;
	chatShell?: ShellCapability;
	shell?: ShellCapability;
	browser?: BrowserCapability;
	computer?: ComputerCapability;
	persistence?: boolean;
}

export type CapabilityFactory<T, TCapability> = (
	props: T,
) => Promise<TCapability>;
