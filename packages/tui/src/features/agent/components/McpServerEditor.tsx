import { hashKey } from "@tanstack/react-query";
import chalk from "chalk";
import { useWindowSize } from "ink";
import { useState } from "react";
import type { McpToolset } from "#client/features/agent/hooks/useTools.ts";
import {
	selectMcpLogs,
	useMcpLogStore,
} from "#client/features/agent/stores/useMcpLogStore.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zMCPServers } from "#core/features/data/types/user.ts";
import Box from "#tui/core/components/Box.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import LogView from "#tui/core/components/LogView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import Choice from "#tui/features/settings/components/Choice.tsx";
import Details, {
	type DetailsItem,
} from "#tui/features/settings/components/Details.tsx";
import TextList, {
	type Draft,
	type TextEntry,
} from "#tui/features/settings/components/TextList.tsx";

export type McpServer = NonNullable<zMCPServers>[string];

/**
 * The server's connection attempts and what it wrote to stderr, which the CLI
 * never lets through to the terminal. Subscribed only while open.
 */
function McpServerLogs({ name }: { name: string }) {
	const { rows } = useWindowSize();
	const logs = useMcpLogStore(selectMcpLogs(name));

	return (
		<Box flexDirection="column" height={Math.max(4, Math.floor(rows / 2))}>
			<LogView logs={logs} />
			<HelpText actions={[{ key: "↑↓", name: "scroll" }, "back"]} />
		</Box>
	);
}

/** Server names are the keys of the settings, which only take these. */
const toName = (text: string) =>
	text
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, "-");

const toEntries = (record: Record<string, string> = {}): TextEntry[] =>
	Object.entries(record).map(([label, text]) => ({ label, text }));

/** `NAME=value`, split at the first `=`. */
const parseEntry = (text: string) => {
	const at = text.indexOf("=");
	const key = (at < 0 ? text : text.slice(0, at)).trim();
	return key ? { key, value: at < 0 ? "" : text.slice(at + 1).trim() } : null;
};

/**
 * One MCP server's connection — its name, transport and what it runs with —
 * like a server's card in the app's tools and skills. Its fields are a draft
 * until saved, since every save reconnects the server.
 */
export default function McpServerEditor({
	name,
	server,
	toolset,
	isConnecting,
	onSave,
	onDelete,
	onRefresh,
	onClose,
}: {
	name: string;
	server: McpServer;
	toolset?: McpToolset;
	isConnecting: boolean;
	/** Saves the server, under a new name when it was renamed. */
	onSave: (nextName: string, server: McpServer) => void;
	onDelete: () => void;
	onRefresh: () => void;
	onClose: () => void;
}) {
	const logCount = useMcpLogStore((state) => selectMcpLogs(name)(state).length);

	const [path, setPath] = useState<string[]>([]);
	const route = path.at(-1) ?? null;
	const push = (next: string) => setPath((current) => [...current, next]);
	const pop = () => setPath((current) => current.slice(0, -1));

	const [draft, setDraft] = useState<Draft | null>(null);
	const [selected, setSelected] = useState(0);

	const [nextName, setNextName] = useState(name);
	const [nextServer, setNextServer] = useState(server);
	// Hashed with sorted keys, as the stored settings come back reordered.
	const dirty =
		nextName !== name || hashKey([nextServer]) !== hashKey([server]);
	/** Set by leaving with unsaved edits, which leaving again discards. */
	const [leaving, setLeaving] = useState(false);

	usePage({
		onBack: () => {
			if (draft) setDraft(null);
			else if (path.length) pop();
			else if (dirty && !leaving) setLeaving(true);
			else onClose();
			return false;
		},
	});

	/** Changes the draft, which only the save row writes. */
	const change = (next: McpServer) => {
		setNextServer(next);
		setLeaving(false);
	};
	const commit = () => {
		setLeaving(false);
		// The save row goes with the edits, so the cursor goes back to the top.
		setSelected(() => 0);
		onSave(nextName, nextServer);
	};

	/** A record of the server's — env or headers — edited as `NAME=value`. */
	const recordList = (
		record: Record<string, string> | undefined,
		set: (record: Record<string, string>) => void,
	) => {
		const entries = Object.entries(record ?? {});
		return (
			<TextList
				entries={toEntries(record)}
				draft={draft}
				setDraft={setDraft}
				placeholder="NAME=value"
				mask
				onAdd={(text) => {
					const entry = parseEntry(text);
					if (entry) set({ ...record, [entry.key]: entry.value });
				}}
				onEdit={(index, value) =>
					set({ ...record, [entries[index][0]]: value })
				}
				onRemove={(index) =>
					set(Object.fromEntries(entries.filter((_, other) => other !== index)))
				}
			/>
		);
	};

	/** A single text of the server's, written in place. */
	const textField = (
		label: string,
		text: string,
		placeholder: string,
		set: (text: string) => void,
	) => (
		<TextList
			entries={[{ label, text }]}
			draft={draft}
			setDraft={setDraft}
			placeholder={placeholder}
			onEdit={(_, text) => set(text)}
		/>
	);

	if (route === "name") {
		return textField("name", nextName, "server", (text) => {
			const renamed = toName(text);
			if (renamed) setNextName(renamed);
			setLeaving(false);
		});
	}
	if (route === "transport") {
		const current = "command" in nextServer ? "stdio" : "http";
		return (
			<Choice
				groups={[
					{
						items: ["stdio", "http"].map((value) => ({
							name: value,
							value,
							active: value === current,
						})),
					},
				]}
				onSelect={(item) => {
					if (item.value !== current) {
						change(item.value === "stdio" ? { command: "" } : { url: "" });
					}
					pop();
				}}
			/>
		);
	}
	if (route === "command" && "command" in nextServer) {
		return textField("command", nextServer.command, "npx", (command) =>
			change({ ...nextServer, command }),
		);
	}
	if (route === "args" && "command" in nextServer) {
		const args = nextServer.args ?? [];
		return (
			<TextList
				entries={args.map((text) => ({ text }))}
				draft={draft}
				setDraft={setDraft}
				placeholder="argument"
				onAdd={(arg) => change({ ...nextServer, args: [...args, arg] })}
				onEdit={(index, arg) =>
					change({ ...nextServer, args: args.with(index, arg) })
				}
				onRemove={(index) =>
					change({
						...nextServer,
						args: args.filter((_, other) => other !== index),
					})
				}
			/>
		);
	}
	if (route === "env" && "command" in nextServer) {
		return recordList(nextServer.env, (env) => change({ ...nextServer, env }));
	}
	if (route === "url" && "url" in nextServer) {
		return textField("url", nextServer.url, "https://example.com/mcp", (url) =>
			change({ ...nextServer, url }),
		);
	}
	if (route === "headers" && "url" in nextServer) {
		return recordList(nextServer.headers, (headers) =>
			change({ ...nextServer, headers }),
		);
	}
	if (route === "logs") return <McpServerLogs name={name} />;
	const count = (record?: Record<string, string>) =>
		String(Object.keys(record ?? {}).length);

	const groups: CompletionGroup<DetailsItem>[] = [
		{
			name: "server",
			items: [
				{ name: "name", value: "name", state: nextName, route: "name" },
				{
					name: "transport",
					value: "transport",
					state: "command" in nextServer ? "stdio" : "http",
					route: "transport",
				},
			],
		},
		{
			name: "connection",
			items:
				"command" in nextServer
					? [
							{
								name: "command",
								value: "command",
								state: nextServer.command || undefined,
								route: "command",
							},
							{
								name: "arguments",
								value: "arguments",
								state: String(nextServer.args?.length ?? 0),
								route: "args",
							},
							{
								name: "environment",
								value: "environment",
								state: count(nextServer.env),
								route: "env",
							},
						]
					: [
							{
								name: "url",
								value: "url",
								state: nextServer.url || undefined,
								route: "url",
							},
							{
								name: "headers",
								value: "headers",
								state: count(nextServer.headers),
								route: "headers",
							},
						],
		},
		{
			name: "output",
			items: [
				{ name: "logs", value: "logs", state: String(logCount), route: "logs" },
			],
		},
	];

	const error = toolset?.status.error;

	return (
		<Details
			groups={groups}
			selected={selected}
			setSelected={setSelected}
			onOpen={push}
			save={dirty ? { run: commit } : undefined}
			remove={{
				name: "remove",
				label: `remove "${name}"?`,
				run: () => {
					onDelete();
					onClose();
				},
			}}
			refresh={{ run: onRefresh }}
			after={
				leaving ? (
					<Text color="textSubtle">{chalk.bold("esc again")} back</Text>
				) : (
					<Text color={!isConnecting && error ? "redBright" : "textSubtle"}>
						{isConnecting || !toolset
							? "connecting..."
							: error
								? CommonUtils.formatError(toolset.status)
								: `${toolset.tools.length} tool${toolset.tools.length === 1 ? "" : "s"}`}
					</Text>
				)
			}
		/>
	);
}
