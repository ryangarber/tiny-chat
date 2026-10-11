import chalk from "chalk";
import {
	forEachChild,
	type ParsedScript,
	parse,
	type Redirect,
	type SyntaxNode,
	type Word,
} from "unbash";
import type {
	Capabilities,
	ShellCapability,
	ShellEnvironment,
} from "#core/core/types/capability.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

const AUDIT = false;

const WRITE_REDIRECTS = new Set([">", ">>", "<>", ">|", "&>", "&>>"]);
const FIND_WRITE_ACTIONS = new Set([
	"-delete",
	"-exec",
	"-execdir",
	"-fls",
	"-fprint",
	"-fprint0",
	"-fprintf",
	"-ok",
	"-okdir",
]);
const GIT_BRANCH_WRITE_OPTIONS = new Set([
	"-c",
	"-C",
	"-d",
	"-D",
	"-m",
	"-M",
	"--copy",
	"--delete",
	"--edit-description",
	"--move",
	"--set-upstream-to",
	"--unset-upstream",
]);
const GIT_BRANCH_READ_OPTIONS_WITH_VALUES = new Set([
	"--contains",
	"--format",
	"--merged",
	"--no-contains",
	"--no-merged",
	"--points-at",
	"--sort",
]);
const GIT_GLOBAL_OPTIONS = new Set([
	"--bare",
	"--glob-pathspecs",
	"--icase-pathspecs",
	"--literal-pathspecs",
	"--no-advice",
	"--no-lazy-fetch",
	"--no-optional-locks",
	"--no-pager",
	"--no-replace-objects",
	"--noglob-pathspecs",
	"--paginate",
	"-P",
	"-p",
]);
const GIT_INFO_OPTIONS = new Set([
	"--exec-path",
	"--help",
	"--html-path",
	"--info-path",
	"--man-path",
	"--version",
	"-h",
	"-v",
]);
const GIT_REMOTE_WRITE_SUBCOMMANDS = new Set([
	"add",
	"prune",
	"remove",
	"rename",
	"set-branches",
	"set-head",
	"set-url",
	"update",
]);
const GIT_CONFIG_WRITE_OPTIONS = new Set([
	"--add",
	"--edit",
	"--remove-section",
	"--rename-section",
	"--replace-all",
	"--unset",
	"--unset-all",
	"-e",
]);
const GIT_CONFIG_WRITE_ACTIONS = new Set([
	"edit",
	"remove-section",
	"rename-section",
	"set",
	"unset",
]);
const GIT_CONFIG_READ_ACTIONS = new Set(["get", "list"]);
const GIT_CONFIG_READ_OPTIONS = new Set([
	"--get",
	"--get-all",
	"--get-color",
	"--get-colorbool",
	"--get-regexp",
	"--get-urlmatch",
	"--list",
	"-l",
]);
const GIT_CONFIG_OPTIONS_WITH_VALUES = new Set([
	"--blob",
	"--default",
	"--file",
	"--type",
	"-f",
]);

/** Commands that change the working directory, which relative paths depend on. */
const DIRECTORY_COMMANDS = new Set(["cd", "popd", "pushd"]);

/**
 * File operations allowed inside whitelisted folders. `flags` are the short
 * options that take no value; `values` take one, which is either a path that
 * must also be inside a folder or something else to skip over. Anything
 * else — notably the link options of `cp`, which could plant an escape
 * hatch — is rejected.
 */
const FILE_OPERATIONS: Record<
	string,
	{
		flags: string;
		values?: Record<string, "path" | "skip">;
		/** Which operands are removed, so must not be a folder itself. */
		removes: "all" | "sources" | "none";
	}
> = {
	cp: {
		flags: "aRrfHiLnPpvxbTuZ",
		values: { t: "path", S: "skip" },
		removes: "none",
	},
	mkdir: { flags: "pv", values: { m: "skip" }, removes: "none" },
	mv: {
		flags: "bfhinTuvZ",
		values: { t: "path", S: "skip" },
		removes: "sources",
	},
	rm: { flags: "dfiIPrRvx", removes: "all" },
	rmdir: { flags: "pv", removes: "all" },
	tee: { flags: "aip", removes: "none" },
	touch: {
		flags: "acfhm",
		values: { d: "skip", r: "skip", t: "skip" },
		removes: "none",
	},
};
const FILE_OPERATION_LONG_OPTIONS: Record<string, "flag" | "path" | "skip"> = {
	"--append": "flag",
	"--archive": "flag",
	"--backup": "flag",
	"--date": "skip",
	"--dir": "flag",
	"--force": "flag",
	"--ignore-fail-on-non-empty": "flag",
	"--ignore-interrupts": "flag",
	"--interactive": "flag",
	"--mode": "skip",
	"--no-clobber": "flag",
	"--no-create": "flag",
	"--no-dereference": "flag",
	"--no-preserve": "flag",
	"--no-target-directory": "flag",
	"--one-file-system": "flag",
	"--parents": "flag",
	"--preserve": "flag",
	"--recursive": "flag",
	"--reference": "skip",
	"--strip-trailing-slashes": "flag",
	"--suffix": "skip",
	"--target-directory": "path",
	"--update": "flag",
	"--verbose": "flag",
};

const isStaticWord = (word: Word): boolean =>
	(word.parts ?? []).every((part) => {
		switch (part.type) {
			case "Literal":
			case "SingleQuoted":
			case "AnsiCQuoted":
				return true;
			case "Glob":
				return part.kind !== "bracket";
			case "DoubleQuoted":
			case "LocaleString":
				return part.parts.every((child) => child.type === "Literal");
			default:
				return false;
		}
	});

type Folder = { path: string; whitelist: boolean };

type Context = {
	whitelist: Whitelist;
	folders: readonly Folder[];
	/** Unset when relative paths cannot be trusted to resolve against it. */
	cwd?: string;
};

/** Resolves `.` and `..` lexically; relative paths need a `cwd`. */
const resolvePath = (path: string, cwd?: string): string | undefined => {
	if (!path.startsWith("/")) {
		if (!cwd?.startsWith("/")) return undefined;
		path = `${cwd}/${path}`;
	}
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};

/**
 * The absolute path a word names, if it can be known without running
 * anything. Tildes, braces and globs that could match `..` or a dotfile
 * parent are refused rather than expanded.
 */
const getStaticPath = (word: Word, cwd?: string): string | undefined => {
	if (!isStaticWord(word)) return undefined;
	const { value } = word;
	if (!value || value.startsWith("~") || /[{}[\]]/.test(value)) {
		return undefined;
	}
	const segments = value.split("/");
	if (
		/[*?]/.test(value) &&
		segments.some((segment) => segment === ".." || /^\.[^/]*[*?]/.test(segment))
	) {
		return undefined;
	}
	return resolvePath(value, cwd);
};

/**
 * Whether the last folder containing `path` is whitelisted. A `strict` path
 * must also lie beneath the folder rather than be the folder itself.
 */
const isPathWhitelisted = (
	path: string,
	folders: readonly Folder[],
	strict = false,
): boolean => {
	const folder = folders.findLast(
		(folder) =>
			path === folder.path ||
			path.startsWith(folder.path === "/" ? "/" : `${folder.path}/`),
	);
	return !!folder?.whitelist && !(strict && path === folder.path);
};

const isRedirectSafe = (redirect: Redirect, context: Context): boolean => {
	if (WRITE_REDIRECTS.has(redirect.operator)) {
		const target = redirect.target?.value ?? "";
		if (
			[
				"/dev/fd/1",
				"/dev/fd/2",
				"/dev/null",
				"/dev/stderr",
				"/dev/stdout",
			].includes(target)
		) {
			return true;
		}
	} else if (
		redirect.operator !== ">&" ||
		(redirect.target && /^(?:[0-9]+|-)$/.test(redirect.target.value))
	) {
		return true;
	}
	const path = redirect.target && getStaticPath(redirect.target, context.cwd);
	return !!path && isPathWhitelisted(path, context.folders);
};

/**
 * Whether a file operation only touches paths inside whitelisted folders.
 * Every operand counts, sources included, so nothing is copied or moved in
 * from elsewhere.
 */
const isFileOperationSafe = (
	name: string,
	words: Word[],
	context: Context,
): boolean => {
	const operation = FILE_OPERATIONS[name];
	if (!operation || !context.folders.length) return false;

	const operands: Word[] = [];
	const targets: Word[] = [];
	let options = true;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		const arg = word.value;
		if (!options || arg === "-" || !arg.startsWith("-")) {
			operands.push(word);
			continue;
		}
		if (arg === "--") {
			options = false;
			continue;
		}
		if (!isStaticWord(word)) return false;
		if (arg.startsWith("--")) {
			const [option, value] = arg.split(/=(.*)/s, 2);
			const kind = FILE_OPERATION_LONG_OPTIONS[option];
			if (!kind) return false;
			if (kind === "flag") continue;
			const valueWord =
				value === undefined
					? words[++index]
					: { ...word, value, text: value, parts: word.parts };
			if (!valueWord) return false;
			if (kind === "path") targets.push(valueWord);
			continue;
		}
		for (let letter = 1; letter < arg.length; letter++) {
			const char = arg[letter];
			if (operation.flags.includes(char)) continue;
			const kind = operation.values?.[char];
			if (!kind) return false;
			const rest = arg.slice(letter + 1);
			const valueWord = rest
				? { ...word, value: rest, text: rest, parts: word.parts }
				: words[++index];
			if (!valueWord) return false;
			if (kind === "path") targets.push(valueWord);
			break;
		}
	}
	if (!operands.length) return false;

	const destination =
		operation.removes === "sources" && !targets.length
			? operands.at(-1)
			: undefined;
	return [...operands, ...targets].every((word) => {
		const path = getStaticPath(word, context.cwd);
		const strict =
			operation.removes === "all" ||
			(operation.removes === "sources" &&
				word !== destination &&
				!targets.includes(word));
		return !!path && isPathWhitelisted(path, context.folders, strict);
	});
};

const getOptionArgs = (args: string[]): string[] => {
	const end = args.indexOf("--");
	return end === -1 ? args : args.slice(0, end);
};

const getGitSubcommand = (
	args: string[],
): { args: string[]; name: string } | "info" | undefined => {
	let hasInfoOption = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") {
			const name = args[index + 1];
			return name ? { name, args: args.slice(index + 2) } : undefined;
		}
		if (arg === "-C" || arg === "-c") {
			if (!args[++index]) return undefined;
			continue;
		}
		if (GIT_GLOBAL_OPTIONS.has(arg)) continue;
		if (
			GIT_INFO_OPTIONS.has(arg) ||
			arg.startsWith("--exec-path=") ||
			arg.startsWith("--list-cmds=")
		) {
			hasInfoOption = true;
			continue;
		}
		if (
			arg.startsWith("--config-env=") ||
			arg.startsWith("--git-dir=") ||
			arg.startsWith("--namespace=") ||
			arg.startsWith("--work-tree=")
		) {
			continue;
		}
		if (arg.startsWith("-")) return undefined;
		return { name: arg, args: args.slice(index + 1) };
	}
	return hasInfoOption ? "info" : undefined;
};

const isGitBranchSafe = (args: string[]): boolean => {
	let list = false;
	let positional = 0;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (
			[...GIT_BRANCH_WRITE_OPTIONS].some(
				(option) =>
					arg === option ||
					(option.startsWith("--")
						? arg.startsWith(`${option}=`)
						: arg.startsWith(option)),
			)
		) {
			return false;
		}
		if (arg === "--list" || arg === "-l") {
			list = true;
			continue;
		}
		if (GIT_BRANCH_READ_OPTIONS_WITH_VALUES.has(arg)) {
			if (!args[++index]) return false;
			continue;
		}
		if (arg === "--") {
			positional += args.length - index - 1;
			break;
		}
		if (!arg.startsWith("-")) positional++;
	}
	return positional === 0 || list;
};

const isGitConfigSafe = (args: string[]): boolean => {
	let readAction = false;
	let positional = 0;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (
			GIT_CONFIG_WRITE_OPTIONS.has(arg) ||
			[...GIT_CONFIG_WRITE_OPTIONS].some(
				(option) => option.startsWith("--") && arg.startsWith(`${option}=`),
			)
		) {
			return false;
		}
		if (GIT_CONFIG_READ_OPTIONS.has(arg)) {
			readAction = true;
			continue;
		}
		if (GIT_CONFIG_OPTIONS_WITH_VALUES.has(arg)) {
			if (!args[++index]) return false;
			continue;
		}
		if (arg === "--") {
			positional += args.length - index - 1;
			break;
		}
		if (!arg.startsWith("-")) {
			if (positional === 0 && GIT_CONFIG_WRITE_ACTIONS.has(arg)) return false;
			if (positional === 0 && GIT_CONFIG_READ_ACTIONS.has(arg)) {
				readAction = true;
			}
			positional++;
		}
	}
	return readAction || positional <= 1;
};

const isGitSafe = (args: string[]): boolean => {
	const invocation = getGitSubcommand(args);
	if (!invocation) return false;
	if (invocation === "info") return true;
	const { args: subcommandArgs, name: subcommand } = invocation;
	if (
		getOptionArgs(subcommandArgs).some(
			(arg) => arg === "--output" || arg.startsWith("--output="),
		)
	) {
		return false;
	}

	if (ShellUtils.safeCommandsGit.has(subcommand)) return true;
	if (subcommand === "branch") return isGitBranchSafe(subcommandArgs);
	if (subcommand === "config") return isGitConfigSafe(subcommandArgs);
	if (subcommand === "remote") {
		const remoteSubcommand = subcommandArgs.find((arg) => !arg.startsWith("-"));
		return (
			!remoteSubcommand || !GIT_REMOTE_WRITE_SUBCOMMANDS.has(remoteSubcommand)
		);
	}
	return false;
};

const uniqWrites = (args: string[]): boolean => {
	let positional = 0;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") return positional + args.length - index - 1 > 1;
		if (
			[
				"-f",
				"-s",
				"-w",
				"--check-chars",
				"--skip-chars",
				"--skip-fields",
			].includes(arg)
		) {
			index++;
			continue;
		}
		if (!arg.startsWith("-")) positional++;
	}
	return positional > 1;
};

const commandWrites = (command: string, args: string[]): boolean => {
	if (command === "find") {
		return args.some((arg) => FIND_WRITE_ACTIONS.has(arg));
	}
	const optionArgs = getOptionArgs(args);
	if (command === "sort") {
		return optionArgs.some(
			(arg) =>
				arg === "-o" ||
				arg.startsWith("-o") ||
				arg === "--output" ||
				arg.startsWith("--output="),
		);
	}
	if (command === "uniq") {
		return uniqWrites(args);
	}
	if (command === "diff") {
		return optionArgs.some(
			(arg) => arg === "--output" || arg.startsWith("--output="),
		);
	}
	if (command === "tree") {
		return optionArgs.some(
			(arg) =>
				arg === "-o" ||
				arg.startsWith("-o") ||
				arg === "--output" ||
				arg.startsWith("--output="),
		);
	}
	if (command === "sed") {
		return optionArgs.some(
			(arg) => arg.startsWith("-i") || arg.startsWith("--in-place"),
		);
	}
	if (command === "rg") {
		return optionArgs.some(
			(arg) => arg === "--pre" || arg.startsWith("--pre="),
		);
	}
	if (command === "fd") {
		return optionArgs.some(
			(arg) =>
				["--exec", "--exec-batch", "-X", "-x"].includes(arg) ||
				arg.startsWith("-X") ||
				arg.startsWith("-x") ||
				arg.startsWith("--exec=") ||
				arg.startsWith("--exec-batch="),
		);
	}
	return false;
};

type Whitelist = (command: string, args: string[]) => boolean;

/** A bare string is an allowed pattern; entries are matched in order. */
type ShellRule = string | { command: string; whitelist: boolean };

/**
 * Matches a whole command against `*` (any run of characters) and `?` globs.
 * The last rule that matches decides, so a later `whitelist: false` shadows
 * an earlier `whitelist: true` for the same command.
 */
const createWhitelist = (rules: readonly ShellRule[]): Whitelist => {
	const entries = rules
		.map((rule) =>
			typeof rule === "string" ? { command: rule, whitelist: true } : rule,
		)
		.map(({ command, whitelist }) => ({
			command: command.trim().replace(/\s+/g, " "),
			whitelist,
		}))
		.filter(({ command }) => command)
		.map(({ command: pattern, whitelist }) => ({
			whitelist,
			regex: new RegExp(
				`^${pattern
					.split("")
					.map((char) =>
						char === "*"
							? ".*"
							: char === "?"
								? "."
								: char.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
					)
					.join("")}$`,
			),
		}));
	return (command, args) => {
		const text = [command, ...args].join(" ");
		return (
			entries.findLast(({ regex }) => regex.test(text))?.whitelist ?? false
		);
	};
};

const isCommandBuiltinSafe = (words: Word[], context: Context): boolean => {
	const args = words.map((word) => word.value);
	let inspectsCommands = false;
	let index = 0;
	for (; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") {
			index++;
			break;
		}
		if (arg === "--help") return true;
		if (!arg.startsWith("-") || arg === "-") break;
		if (!/^-[pVv]+$/.test(arg)) return false;
		if (/[Vv]/.test(arg)) inspectsCommands = true;
	}
	if (inspectsCommands || index === args.length) return true;
	const command = words[index];
	return command
		? isInvocationSafe(command, words.slice(index + 1), context)
		: true;
};

const isInvocationSafe = (
	commandWord: Word,
	words: Word[],
	context: Context,
): boolean => {
	if (!isStaticWord(commandWord)) return false;
	const command = commandWord.value;
	const args = words.map((word) => word.value);
	if (context.whitelist(command, args)) return true;
	// Only normalize the system bin directory, not arbitrary paths that could
	// contain user-controlled executables with familiar names.
	const match = /^(?:\/usr\/bin\/|\/bin\/)/.exec(command);
	const name = match ? command.slice(match[0].length) : command;
	if (name === "command") return isCommandBuiltinSafe(words, context);
	if (name in FILE_OPERATIONS) return isFileOperationSafe(name, words, context);
	if (name === "env") return args.length === 0;
	if (name === "awk") {
		// awk programs can run commands or write files; permit only a single
		// regex pattern with a plain print action (no options or input files).
		return (
			args.length === 1 && /^\/(?:\\.|[^/\\])*\/\s*\{print\}$/.test(args[0])
		);
	}
	const safe = ShellUtils.safeCommands.has(name);
	const safeWrite = !commandWrites(name, args);
	const safeGit = name === "git" && isGitSafe(args);
	const result = (safe && safeWrite) || safeGit;
	if (AUDIT) {
		console.log(chalk.gray(`${name} ${args.join(" ")}`));
		console.log(
			result
				? `╰── safe`
				: `╰── not safe (safe: ${safe} safeWrite: ${safeWrite} safeGit: ${safeGit})`,
		);
	}
	return result;
};

/**
 * Visits every node of the syntax tree, stopping at the first one `check`
 * rejects.
 */
const walk = (
	script: ParsedScript,
	check: (item: Record<string, unknown>) => boolean,
): boolean => {
	// forEachChild resolves the lazy word parts and substitution scripts.
	const visit = (node: SyntaxNode): boolean => {
		if (!check(node as unknown as Record<string, unknown>)) return false;
		let safe = true;
		forEachChild(node, (child) => {
			if (safe) safe = visit(child);
		});
		return safe;
	};
	return visit(script);
};

const isScriptSafe = (script: ParsedScript, context: Context): boolean => {
	if (script.errors?.length) return false;

	// Paths are resolved against the starting directory, so once anything
	// changes it only absolute paths can be judged.
	const movesDirectory = !walk(
		script,
		(item) =>
			item.type !== "Command" ||
			!DIRECTORY_COMMANDS.has((item.name as Word | undefined)?.value ?? ""),
	);
	if (movesDirectory) context = { ...context, cwd: undefined };

	return walk(script, (item) => {
		if (
			item.type === "Script" &&
			(item as unknown as ParsedScript).errors?.length
		) {
			return false;
		}
		if ("operator" in item && "target" in item) {
			if (!isRedirectSafe(item as unknown as Redirect, context)) return false;
		}
		if (item.type === "Command") {
			const node = item as unknown as {
				name?: Word;
				suffix: (Word | Redirect)[];
			};
			if (!node.name) return true;
			const words = node.suffix.filter(
				(part): part is Word => part.type === "Word",
			);
			if (!isInvocationSafe(node.name, words, context)) return false;
		}
		return true;
	});
};

export const ShellUtils = {
	/** Read-only commands that can run without an approval prompt. */
	safeCommands: new Set([
		"cd",
		"ls",
		"pwd",
		"cat",
		"echo",
		"grep",
		"find",
		"head",
		"tail",
		"wc",
		"which",
		"whoami",
		"date",
		"uname",
		"ps",
		"df",
		"du",
		"file",
		"stat",
		"tree",
		"printenv",
		"sort",
		"uniq",
		"cut",
		"diff",
		"cmp",
		"column",
		"comm",
		"basename",
		"cksum",
		"dirname",
		"expand",
		"fd",
		"fmt",
		"fold",
		"groups",
		"id",
		"join",
		"jq",
		"md5sum",
		"nl",
		"od",
		"paste",
		"printf",
		"readlink",
		"realpath",
		"rev",
		"rg",
		"sed",
		"sha1sum",
		"sha256sum",
		"sha512sum",
		"strings",
		"tr",
		"true",
		"type",
		"unexpand",
		"false",
		"test",
		"[",
	]),

	/** `git` subcommands whose normal operation only reads repository state. */
	safeCommandsGit: new Set([
		"status",
		"diff",
		"log",
		"show",
		"describe",
		"blame",
		"rev-parse",
		"grep",
		"ls-files",
		"ls-tree",
		"cat-file",
		"check-attr",
		"check-ignore",
		"count-objects",
		"name-rev",
		"for-each-ref",
		"merge-base",
		"range-diff",
		"shortlog",
		"show-index",
		"show-ref",
		"verify-commit",
		"verify-pack",
		"verify-tag",
	]),

	/**
	 * Parses the full Bash syntax tree and rejects commands that may write to
	 * disk. Every simple command — including those in `$(...)`, pipes and `&&`
	 * chains — must be read-only or match a `whitelist` glob such as
	 * `npm run *`. Writes are allowed only inside whitelisted `folders`: file
	 * operations (`rm`, `mv`, `cp`, `mkdir`, `touch`, `tee`, `rmdir`) and
	 * output redirects whose every path resolves there. Relative paths resolve
	 * against `cwd` until the script changes directory. Paths are compared
	 * lexically, so a symlink inside a folder can still lead outside it.
	 *
	 * Only bash can be judged this way. A command in another `dialect` is safe
	 * only when it is, word for word, a whitelisted rule with no wildcards: a
	 * bash parser would misread it, and `*` could match a second statement.
	 */
	isSafe: (
		command: string,
		rules: readonly ShellRule[] = [],
		options: {
			folders?: readonly Folder[];
			cwd?: string;
			dialect?: ShellEnvironment["dialect"];
		} = {},
	): boolean => {
		if (!command.trim()) return false;
		if (options.dialect && options.dialect !== "bash") {
			const exact = rules.filter(
				(rule) => !/[*?]/.test(typeof rule === "string" ? rule : rule.command),
			);
			return createWhitelist(exact)(command.trim().replace(/\s+/g, " "), []);
		}
		try {
			const folders = (options.folders ?? []).flatMap((folder) => {
				const path = resolvePath(folder.path);
				return path ? [{ path, whitelist: folder.whitelist }] : [];
			});
			return isScriptSafe(parse(command), {
				whitelist: createWhitelist(rules),
				folders,
				cwd: options.cwd && resolvePath(options.cwd),
			});
		} catch {
			return false;
		}
	},

	/** Folders as `shell` spells their paths, so they compare with its own. */
	toShellFolders: <T extends { path: string }>(
		shell: ShellCapability,
		folders: readonly T[],
	): T[] =>
		folders.map((folder) =>
			shell.toShellPath
				? { ...folder, path: shell.toShellPath({ path: folder.path }) }
				: folder,
		),

	detect: (
		path: string | boolean,
		capabilities: Pick<Capabilities, "shell" | "chatShell">,
	): ShellCapability => {
		if (!capabilities.shell && !capabilities.chatShell) {
			// this shouldn't happen
			throw new Error(
				"You tried to access a path but no shell is accessible. This is most likely a bug. You can try another path if desired or note the issue and move on.",
			);
		}
		const isChat = typeof path === "boolean" ? path : PathUtils.isMounted(path);
		if (isChat) {
			if (!capabilities.chatShell) {
				throw new Error(
					`You tried to access a path inside of ${PathUtils.mount}, but the chat shell is not accessible.${capabilities.shell ? ` If you are able to use the user's shell, call this tool with a path outside of ${PathUtils.mount} and try again.` : ""}`,
				);
			}
			return capabilities.chatShell;
		} else {
			if (!capabilities.shell) {
				throw new Error(
					`You tried to access a path outside of ${PathUtils.mount}, but the user's shell is not accessible.${capabilities.chatShell ? ` If you are able to use the chat shell, call this tool with a path inside of ${PathUtils.mount} and try again.` : ""}`,
				);
			}
			return capabilities.shell;
		}
	},
} as const;
