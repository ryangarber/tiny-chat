import {
	ActionIcon,
	Box,
	Button,
	Card,
	Checkbox,
	Collapse,
	Group,
	Modal,
	ScrollArea,
	SegmentedControl,
	Space,
	Stack,
	Switch,
	Tabs,
	TagsInput,
	Text,
	TextInput,
} from "@mantine/core";
import {
	ArrowClockwiseIcon,
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	CheckCircleIcon,
	FloppyDiskIcon,
	GraduationCapIcon,
	PlusIcon,
	TrashIcon,
	WarningCircleIcon,
	WarningDiamondIcon,
	WrenchIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { hashKey, useIsFetching } from "@tanstack/react-query";
import { type ReactNode, useContext, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { useBrowser } from "#client/features/agent/hooks/useBrowser.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { mcpServerQueryKey } from "#client/features/agent/hooks/useMcp.ts";
import {
	localSkillsQueryKey,
	useSkills,
} from "#client/features/agent/hooks/useSkills.ts";
import { useSurface } from "#client/features/agent/hooks/useSurface.ts";
import {
	type McpToolset,
	useTools,
} from "#client/features/agent/hooks/useTools.ts";
import {
	selectMcpLogs,
	useMcpLogStore,
} from "#client/features/agent/stores/useMcpLogStore.ts";
import type { ComputahSurface } from "#client/features/agent/types/computah.ts";
import { SurfaceUtils } from "#client/features/agent/utils/SurfaceUtils.ts";
import { useMcpServerSettings } from "#client/features/settings/hooks/useMcpServerSettings.ts";
import { useModelSettings } from "#client/features/settings/hooks/useModelSettings.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zMCPServers } from "#core/features/data/types/user.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import { read_files } from "#core/features/tool/tools/shell/read_files.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";
import { LogList } from "#gui/core/components/Console.tsx";
import {
	type CapabilitiesType,
	useAppStore,
} from "#gui/core/stores/useAppStore.ts";
import scrollable from "#gui/core/styles/scrollable.module.css";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import ConfigPanel from "#gui/features/editor/components/ConfigPanel.tsx";
import Dropzone from "#gui/features/upload/components/Dropzone.tsx";

const SHELL_TOOLSET = "shell";
/** Toolsets over computah's surfaces, each with its status beside it. */
const SURFACE_TOOLSETS: Record<string, ComputahSurface> = {
	browser: "browser",
	terminal: "terminal",
	computer: "computer",
};
const SUBAGENTS_TOOLSET = "subagents";
const MODAL_Z_INDEX = 1000;
type McpServers = NonNullable<zMCPServers>;
type McpServerSetting = McpServers[keyof McpServers];

const getMcpToolsetName = (name: string) =>
	name.replace("-", "_").toLowerCase();

function KeyValueFields({
	label,
	value,
	onChange,
	onSubmit,
	disabled,
}: {
	label: string;
	value: Record<string, string>;
	onChange: (value: Record<string, string>) => void;
	/** Enter in a field, which saves what the fields belong to. */
	onSubmit: () => void;
	disabled: boolean;
}) {
	const [entries, setEntries] = useState(() =>
		Object.entries(value).map(([key, entryValue]) => ({
			id: CommonUtils.getRandomId(),
			key,
			value: entryValue,
		})),
	);
	const updateEntries = (
		nextEntries: { id: string; key: string; value: string }[],
	) => {
		setEntries(nextEntries);
		onChange(toRecord(nextEntries));
	};
	const toRecord = (nextEntries = entries) =>
		Object.fromEntries(
			nextEntries
				.filter((entry) => entry.key)
				.map((entry) => [entry.key, entry.value]),
		);

	return (
		<Stack gap={5}>
			<Text size="xs" fw={500}>
				{label}
			</Text>
			{entries.map((entry) => (
				<Group key={entry.id} gap="xs" wrap="nowrap">
					<TextInput
						aria-label={`${label} key`}
						placeholder="Name"
						value={entry.key}
						onChange={(event) => {
							updateEntries(
								entries.map((candidate) =>
									candidate.id === entry.id
										? { ...candidate, key: event.currentTarget.value }
										: candidate,
								),
							);
						}}
						onKeyDown={ControlUtils.onEnter(onSubmit)}
						flex={1}
					/>
					<TextInput
						aria-label={`${label} value`}
						placeholder="Value"
						value={entry.value}
						onChange={(event) => {
							updateEntries(
								entries.map((candidate) =>
									candidate.id === entry.id
										? { ...candidate, value: event.currentTarget.value }
										: candidate,
								),
							);
						}}
						onKeyDown={ControlUtils.onEnter(onSubmit)}
						flex={1}
					/>
					<ActionIcon
						variant="subtle"
						color="red"
						disabled={disabled}
						aria-label={`Remove ${label.toLowerCase()} entry`}
						onClick={() => {
							const nextEntries = entries.filter(
								(candidate) => candidate.id !== entry.id,
							);
							updateEntries(nextEntries);
						}}
					>
						<TrashIcon size={16} />
					</ActionIcon>
				</Group>
			))}
			<Button
				variant="subtle"
				size="compact-xs"
				leftSection={<PlusIcon size={14} />}
				style={{ alignSelf: "flex-start" }}
				disabled={disabled}
				onClick={() =>
					updateEntries([
						...entries,
						{ id: CommonUtils.getRandomId(), key: "", value: "" },
					])
				}
			>
				Add {label.toLowerCase()}
			</Button>
		</Stack>
	);
}

/**
 * A server's connection attempts and what it wrote to stderr. Mounted only
 * while its card is open, so a busy server renders nothing otherwise.
 */
function McpServerLogs({ name }: { name: string }) {
	const logs = useMcpLogStore(selectMcpLogs(name));

	return (
		<Stack gap={5}>
			<Text size="sm" fw={500}>
				Logs
			</Text>
			{logs.length ? (
				<ScrollArea.Autosize mah={240} offsetScrollbars className="selectable">
					<LogList logs={logs} />
				</ScrollArea.Autosize>
			) : (
				<Text size="xs" c="dimmed">
					Nothing logged yet
				</Text>
			)}
		</Stack>
	);
}

function McpServerCard({
	name,
	server,
	toolset,
	disabled,
	onUpdate,
	onDelete,
	onRefresh,
}: {
	name: string;
	server: McpServerSetting;
	toolset?: McpToolset;
	disabled: boolean;
	onUpdate: (name: string, nextName: string, server: McpServerSetting) => void;
	onDelete: (name: string) => void;
	onRefresh: (name: string) => void;
}) {
	const { config, setConfig } = useConfig();
	const [expanded, setExpanded] = useState(false);
	const isConnecting =
		useIsFetching({ queryKey: [...mcpServerQueryKey, name] }) > 0;
	const [draftName, setDraftName] = useState(name);
	const [draft, setDraft] = useState(server);
	// Remounts the key-value fields, which keep their own rows, on discard.
	const [revision, setRevision] = useState(0);
	const toolsetName = getMcpToolsetName(name);
	const status = toolset?.status;

	// Edits stay a draft until saved, since every save reconnects the server.
	// Hashed with sorted keys, as the stored settings come back reordered.
	const dirty =
		draftName.trim() !== name || hashKey([draft]) !== hashKey([server]);
	const canSave = dirty && !!draftName.trim() && !disabled;

	const save = () => {
		if (!canSave) return;
		const nextName = draftName.trim();
		if (nextName !== name && config.toolsets.includes(toolsetName)) {
			setConfig({
				...config,
				toolsets: config.toolsets.map((value) =>
					value === toolsetName ? getMcpToolsetName(nextName) : value,
				),
			});
		}
		onUpdate(name, nextName, draft);
	};

	const discard = () => {
		setDraftName(name);
		setDraft(server);
		setRevision((value) => value + 1);
	};

	return (
		<Card withBorder padding={0}>
			<Box
				role="button"
				tabIndex={0}
				p="xs"
				w="100%"
				style={{ cursor: "pointer" }}
				onClick={() => setExpanded((value) => !value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						setExpanded((value) => !value);
					}
				}}
			>
				<Group wrap="nowrap" align="flex-start">
					<Box pt={2}>
						{expanded ? (
							<CaretDownIcon size={16} />
						) : (
							<CaretRightIcon size={16} />
						)}
					</Box>
					<Checkbox
						mt={2}
						checked={toolset ? ToolUtils.checkOne({ toolset, config }) : false}
						disabled={disabled || status?.valid === false}
						onClick={(event) => event.stopPropagation()}
						onChange={() => {
							setConfig({
								...config,
								toolsets: !config.toolsets.includes(toolsetName)
									? [...config.toolsets, toolsetName]
									: config.toolsets.filter((value) => value !== toolsetName),
							});
						}}
					/>
					<Stack gap={5} miw={0} flex={1}>
						<Text size="xs">{name}</Text>
						<Text size="xs" c="dimmed">
							{isConnecting || !toolset
								? "Connecting…"
								: toolset.tools.map((tool) => tool.name).join(", ") ||
									"No tools"}
						</Text>
						{!isConnecting && !!status?.error && (
							<Group gap="xs" c="red">
								<WarningCircleIcon size={14} />
								<Text size="xs">{CommonUtils.formatError(status)}</Text>
							</Group>
						)}
					</Stack>
					<ActionIcon
						variant="transparent"
						c="dimmed"
						aria-label={`Reconnect ${name}`}
						loading={isConnecting}
						disabled={disabled}
						onClick={(event) => {
							event.stopPropagation();
							onRefresh(name);
						}}
					>
						<ArrowClockwiseIcon size={18} />
					</ActionIcon>
				</Group>
			</Box>
			<Collapse expanded={expanded}>
				<Stack px="xs" pb="xs" gap="xs">
					<TextInput
						label="Name"
						value={draftName}
						disabled={disabled}
						onChange={(event) => setDraftName(event.currentTarget.value)}
						onKeyDown={ControlUtils.onEnter(save)}
					/>
					<SegmentedControl
						fullWidth
						value={"command" in draft ? "stdio" : "http"}
						data={[
							{ label: "stdio", value: "stdio" },
							{ label: "HTTP", value: "http" },
						]}
						disabled={disabled}
						onChange={(value) => {
							setDraft(value === "stdio" ? { command: "" } : { url: "" });
						}}
					/>
					{"command" in draft ? (
						<>
							<TextInput
								label="Command"
								placeholder="npx"
								value={draft.command}
								disabled={disabled}
								onChange={(event) =>
									setDraft({ ...draft, command: event.currentTarget.value })
								}
								onKeyDown={ControlUtils.onEnter(save)}
							/>
							<TagsInput
								label="Arguments"
								placeholder="Add argument"
								value={draft.args ?? []}
								disabled={disabled}
								onChange={(args) => setDraft({ ...draft, args })}
							/>
							<KeyValueFields
								key={revision}
								label="Environment"
								value={draft.env ?? {}}
								onChange={(env) => setDraft({ ...draft, env })}
								onSubmit={save}
								disabled={disabled}
							/>
						</>
					) : (
						<>
							<TextInput
								label="URL"
								placeholder="https://example.com/mcp"
								value={draft.url}
								disabled={disabled}
								onChange={(event) =>
									setDraft({ ...draft, url: event.currentTarget.value })
								}
								onKeyDown={ControlUtils.onEnter(save)}
							/>
							<KeyValueFields
								key={revision}
								label="Headers"
								value={draft.headers ?? {}}
								onChange={(headers) => setDraft({ ...draft, headers })}
								onSubmit={save}
								disabled={disabled}
							/>
						</>
					)}
					{expanded && <McpServerLogs name={name} />}
					<Group justify="space-between">
						<Button
							variant="subtle"
							color="red"
							size="compact-xs"
							leftSection={<TrashIcon size={14} />}
							disabled={disabled}
							onClick={() => onDelete(name)}
						>
							Remove server
						</Button>
						{dirty && (
							<Group gap="xs">
								<Button
									variant="subtle"
									size="compact-xs"
									disabled={disabled}
									onClick={discard}
								>
									Discard
								</Button>
								<Button
									variant="default"
									size="compact-xs"
									leftSection={<FloppyDiskIcon size={14} />}
									disabled={!canSave}
									onClick={save}
								>
									Save
								</Button>
							</Group>
						)}
					</Group>
				</Stack>
			</Collapse>
		</Card>
	);
}

function ToolsetCard({
	toolset,
	panel,
}: {
	toolset: McpToolset | Toolset<any>;
	panel?: ReactNode;
}) {
	const { config, setConfig } = useConfig();
	const [expanded, setExpanded] = useState(false);

	const toolsetName = ToolUtils.name({ toolset });
	const toolNames = toolset.tools.map((tool) =>
		ToolUtils.name({ toolset, tool }),
	);

	const card = (
		<Checkbox.Card
			p="xs"
			withBorder={!panel}
			checked={ToolUtils.checkOne({ toolset, config })}
			onClick={() => {
				setConfig({
					...config,
					toolsets: !config.toolsets.includes(toolsetName)
						? [...config.toolsets, toolsetName]
						: config.toolsets.filter((name) => name !== toolsetName),
				});
			}}
			style={{
				cursor: !toolset.status.valid ? "not-allowed" : undefined,
			}}
			disabled={!toolset.status.valid}
			opacity={!toolset.status.valid ? 0.5 : 1}
		>
			<Group wrap="nowrap" align="flex-start">
				<Checkbox.Indicator />
				<Stack gap={5} miw={0} flex={1}>
					<Text size="xs">{toolsetName}</Text>
					<Text size="xs" c="dimmed">
						{toolNames.map((toolName, i) => (
							<span key={toolName}>
								{`${toolName}${i < toolset.tools.length - 1 ? ", " : ""}`}
							</span>
						))}
					</Text>
					{!!toolset.status.error && (
						<Group gap="xs" c="red">
							<WarningCircleIcon size={14} />
							<Text size="xs">{CommonUtils.formatError(toolset.status)}</Text>
						</Group>
					)}
				</Stack>
			</Group>
		</Checkbox.Card>
	);

	if (!panel) return card;

	return (
		<Card withBorder padding={0}>
			<Group wrap="nowrap" gap={0} align="flex-start">
				<Box flex={1} miw={0}>
					{card}
				</Box>
				<ActionIcon
					m={6}
					variant="transparent"
					c="dimmed"
					aria-label={`${expanded ? "Collapse" : "Expand"} ${toolsetName}`}
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? <CaretDownIcon size={16} /> : <CaretLeftIcon size={16} />}
				</ActionIcon>
			</Group>
			<Collapse expanded={expanded}>
				<Box px="xs" pb="xs">
					{expanded && panel}
				</Box>
			</Collapse>
		</Card>
	);
}

function ToolsetView({
	toolsets,
}: {
	toolsets: McpToolset[] | Toolset<any>[];
}) {
	const client = useContext(ClientContext);

	return toolsets.map((toolset) => {
		const toolsetName = ToolUtils.name({ toolset });
		return (
			<ToolsetCard
				key={toolsetName}
				toolset={toolset}
				panel={
					SURFACE_TOOLSETS[toolsetName] && client.computah ? (
						<SurfaceView surface={SURFACE_TOOLSETS[toolsetName]} />
					) : toolsetName === SUBAGENTS_TOOLSET ? (
						<SubagentView />
					) : undefined
				}
			/>
		);
	});
}

function Requirement({
	label,
	found,
	optional,
	children,
}: {
	label: string;
	found: boolean;
	/** Missing it only limits what can be done, so it warns rather than fails. */
	optional?: boolean;
	children: ReactNode;
}) {
	return (
		<Card withBorder padding="xs">
			<Group wrap="nowrap" align="flex-start">
				<Box pt={2} c={found ? "green" : optional ? "yellow" : "red"}>
					{found ? (
						<CheckCircleIcon size={16} />
					) : optional ? (
						<WarningCircleIcon size={16} />
					) : (
						<XCircleIcon size={16} />
					)}
				</Box>
				<Stack gap={5} miw={0} flex={1}>
					<Text size="xs">{label}</Text>
					{children}
				</Stack>
			</Group>
		</Card>
	);
}

const pathStyle = {
	fontFamily: "monospace",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
} as const;

const SURFACE_DESCRIPTIONS: Record<ComputahSurface, string> = {
	browser: "Drives a browser of its own, with its own sign-ins.",
	terminal: "Runs interactive programs in tmux sessions you can attach to.",
	computer:
		"Uses apps through their accessibility trees, in the background, with a cursor of its own.",
};

/** Whether to show the browser's window, which only the browser has. */
function BrowserWindowSetting({ display }: { display?: boolean }) {
	const { browserSettings, setBrowserSettings } = useBrowser();
	return (
		<Switch
			size="xs"
			label="Show the browser window"
			description={
				display === false
					? "Not available here; the browser runs headless"
					: undefined
			}
			checked={browserSettings.data?.headed ?? false}
			onChange={(event) =>
				setBrowserSettings.mutate({ headed: event.currentTarget.checked })
			}
		/>
	);
}

/**
 * A computah surface's status beside its toolset: what it needs and has, the
 * grants it is missing, and installing what it lacks.
 */
function SurfaceView({ surface }: { surface: ComputahSurface }) {
	const {
		surfaceStatus,
		recheckSurface,
		installSurface,
		installProgress,
		requestPermission,
	} = useSurface(surface);
	const isChecking =
		surfaceStatus.isFetching || recheckSurface.isPending || !surfaceStatus.data;
	const report = recheckSurface.data ?? surfaceStatus.data;
	const busy = isChecking || installSurface.isPending;

	return (
		<Stack gap="xs">
			<Group justify="space-between" wrap="nowrap">
				{surface === "browser" ? (
					<BrowserWindowSetting
						display={
							report?.requirements.find(
								(requirement) => requirement.key === "display",
							)?.found
						}
					/>
				) : (
					<Text size="xs" c="dimmed">
						{SURFACE_DESCRIPTIONS[surface]}
					</Text>
				)}
				<ActionIcon
					variant="transparent"
					loading={isChecking}
					aria-label={`Recheck ${surface}`}
					onClick={() => recheckSurface.mutate()}
				>
					<ArrowClockwiseIcon size={18} />
				</ActionIcon>
			</Group>
			{report && !isChecking && (
				<>
					{report.requirements.map((requirement) => (
						<Requirement
							key={requirement.key}
							label={requirement.label}
							found={requirement.found}
							optional={requirement.optional}
						>
							<Text size="xs" c="dimmed" style={pathStyle}>
								{requirement.detail}
							</Text>
						</Requirement>
					))}
					{report.permissions.map((permission) => (
						<Requirement
							key={permission.key}
							label={permission.label}
							found={permission.granted}
						>
							{permission.granted ? (
								<Text size="xs" c="dimmed">
									Granted
								</Text>
							) : (
								<Button
									size="compact-xs"
									variant="light"
									w="fit-content"
									loading={
										requestPermission.isPending &&
										requestPermission.variables.key === permission.key
									}
									onClick={() => requestPermission.mutate(permission)}
								>
									{permission.promptable ? "Request" : "Open settings"}
								</Button>
							)}
						</Requirement>
					))}
					{report.install && (
						<Group gap="xs" wrap="nowrap">
							<Button
								size="compact-xs"
								variant="light"
								loading={installSurface.isPending}
								disabled={busy && !installSurface.isPending}
								onClick={() => installSurface.mutate()}
							>
								Install {report.install}
							</Button>
							{installProgress && (
								<Text size="xs" c="dimmed" truncate>
									{SurfaceUtils.progress(installProgress)}
								</Text>
							)}
						</Group>
					)}
					{report.note && (
						<Text size="xs" c="dimmed">
							{report.note}
						</Text>
					)}
					{[
						report.error,
						installSurface.data,
						installSurface.error?.message,
						requestPermission.error?.message,
					]
						.filter(Boolean)
						.map((message) => (
							<Group key={message} gap="xs" c="red" wrap="nowrap">
								<WarningCircleIcon size={14} />
								<Text size="xs">{message}</Text>
							</Group>
						))}
				</>
			)}
		</Stack>
	);
}

function SubagentView() {
	const { subagentConfig, updateSubagentConfig } = useModelSettings();

	return (
		<Stack gap={5}>
			<Text size="xs" c="dimmed">
				Subagent settings
			</Text>
			<ConfigPanel
				config={subagentConfig}
				setConfig={updateSubagentConfig}
				onClear={() => updateSubagentConfig(null)}
				zIndex={MODAL_Z_INDEX + 1}
			/>
		</Stack>
	);
}

function SkillView({ skills, native }: { skills: zSkill[]; native?: boolean }) {
	const { config, setConfig } = useConfig();
	const { deleteNativeSkill } = useSkills();

	return skills.map((skill) => (
		<Group key={skill.name + skill.path}>
			<Box flex={1} miw={0}>
				<Checkbox.Card
					p="xs"
					checked={config.skills?.includes(skill.path)}
					disabled={!skill.name}
					onClick={() => {
						setConfig({
							...config,
							skills: !config.skills?.includes(skill.path)
								? [...config.skills, skill.path]
								: config.skills?.filter((cs) => cs !== skill.path),
						});
					}}
				>
					<Group wrap="nowrap" align="flex-start">
						<Checkbox.Indicator />
						<Stack gap={5} miw={0}>
							<Text size="xs">{skill.name}</Text>
							<Text
								size="xs"
								c="dimmed"
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{DataUtils.getTextCleaned({ data: skill.description })}
							</Text>
							{config.skills?.includes(skill.path) &&
								!config.toolsets?.includes(SHELL_TOOLSET) && (
									<Group gap={5} c="yellow">
										<WarningDiamondIcon size={14} />
										<Text size="xs">
											Needs{" "}
											<span style={{ fontWeight: 450 }}>{read_files.name}</span>
										</Text>
									</Group>
								)}
						</Stack>
					</Group>
				</Checkbox.Card>
			</Box>
			{native && (
				<ActionIcon
					variant="subtle"
					color="red"
					loading={
						deleteNativeSkill.isPending &&
						deleteNativeSkill.variables.id ===
							(PathUtils.fromMountOrThrow(skill).id as string)
					}
					disabled={
						deleteNativeSkill.isPending &&
						deleteNativeSkill.variables.id ===
							(PathUtils.fromMountOrThrow(skill).id as string)
					}
					onClick={() =>
						deleteNativeSkill.mutate({
							id: PathUtils.fromMountOrThrow(skill).id as string,
						})
					}
				>
					<TrashIcon size={18} />
				</ActionIcon>
			)}
		</Group>
	));
}

export default function Capabilities() {
	const client = useContext(ClientContext);
	const { nativeTools, mcpTools, refreshMcpServers } = useTools();
	const { localSkills, nativeSkills } = useSkills();
	const { mcpServerSettingsUnparsed, setMcpServerSettings } =
		useMcpServerSettings();

	const isMobile = useAppStore((state) => state.isMobile);
	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);
	const currentCapabilities = useAppStore((state) => state.currentCapabilities);
	const setCurrentCapabilities = useAppStore(
		(state) => state.setCurrentCapabilities,
	);

	const mcpServers = mcpServerSettingsUnparsed.data ?? {};

	const areMcpServersConnecting =
		useIsFetching({ queryKey: mcpServerQueryKey }) > 0;
	const areLocalSkillsUpdating =
		useIsFetching({ queryKey: localSkillsQueryKey }) > 0;
	const mcpSettingsDisabled =
		mcpServerSettingsUnparsed.isPending || setMcpServerSettings.isPending;
	const updateMcpServers = (next: McpServers) => {
		setMcpServerSettings.mutate({ mcpServers: next });
	};

	return (
		<Modal
			opened={currentModal === "capabilities"}
			onClose={() => setCurrentModal(null)}
			title="Tools & Skills"
			zIndex={MODAL_Z_INDEX}
			size="lg"
			centered
			classNames={scrollable}
		>
			<Tabs
				value={currentCapabilities}
				onChange={(value) => setCurrentCapabilities(value as CapabilitiesType)}
				variant="pills"
			>
				<Tabs.List mb="md">
					<Group gap={10}>
						<Group gap={7} mr={10}>
							<Box c="dimmed">
								<WrenchIcon size={16} />
							</Box>
							<Tabs.Tab value="tools:native">Native</Tabs.Tab>
							<Tabs.Tab value="tools:mcp">MCP</Tabs.Tab>
						</Group>
						<Group gap={7}>
							<Box c="dimmed">
								<GraduationCapIcon size={16} />
							</Box>
							<Tabs.Tab value="skills:native">Native</Tabs.Tab>
							{(client.desktop || !isMobile) && (
								<Tabs.Tab value="skills:local" disabled={!client.desktop}>
									Local
								</Tabs.Tab>
							)}
						</Group>
					</Group>
				</Tabs.List>
				<Tabs.Panel value="tools:native">
					<ScrollArea type="auto" offsetScrollbars h={400}>
						<Stack gap="xs">
							<ToolsetView
								toolsets={ToolUtils.selectable(nativeTools.data ?? [])}
							/>
						</Stack>
					</ScrollArea>
				</Tabs.Panel>
				<Tabs.Panel value="tools:mcp">
					<ScrollArea type="auto" offsetScrollbars h={400}>
						<Stack gap="xs">
							<Group justify="space-between">
								<Button
									variant="subtle"
									size="compact-xs"
									leftSection={<PlusIcon size={14} />}
									disabled={mcpSettingsDisabled}
									onClick={() => {
										let name = "server";
										let suffix = 2;
										while (name in mcpServers) name = `server-${suffix++}`;
										updateMcpServers({
											...mcpServers,
											[name]: { command: "" },
										});
									}}
								>
									Add server
								</Button>
								<ActionIcon
									variant="transparent"
									loading={areMcpServersConnecting}
									aria-label="Refresh MCP servers"
									onClick={() => refreshMcpServers.mutate({})}
								>
									<ArrowClockwiseIcon size={18} />
								</ActionIcon>
							</Group>
							{Object.entries(mcpServers).map(([name, server]) => (
								<McpServerCard
									key={name}
									name={name}
									server={server}
									toolset={mcpTools.data?.find(
										(toolset) => toolset.name === getMcpToolsetName(name),
									)}
									disabled={mcpSettingsDisabled}
									onUpdate={(oldName, nextName, value) => {
										const servers = { ...mcpServers };
										delete servers[oldName];
										servers[nextName] = value;
										updateMcpServers(servers);
									}}
									onDelete={(serverName) => {
										const servers = { ...mcpServers };
										delete servers[serverName];
										updateMcpServers(servers);
									}}
									onRefresh={(serverName) =>
										refreshMcpServers.mutate({ name: serverName })
									}
								/>
							))}
						</Stack>
					</ScrollArea>
				</Tabs.Panel>
				<Tabs.Panel value="skills:native">
					<Dropzone
						kind="SKILL"
						accept={{ "application/zip": [".zip"], "text/markdown": [".md"] }}
						options={{ onSuccess: () => void nativeSkills.refetch() }}
					/>
					<Space h="md" />
					<ScrollArea type="auto" offsetScrollbars h={280}>
						<Stack gap="xs">
							<SkillView skills={nativeSkills.data ?? []} native />
						</Stack>
					</ScrollArea>
				</Tabs.Panel>
				<Tabs.Panel value="skills:local">
					<ScrollArea type="auto" offsetScrollbars h={400}>
						<Stack gap="xs">
							<TextInput
								placeholder="~/.agent/skills"
								disabled
								readOnly
								styles={{
									input: {
										fontFamily: "monospace",
										fontSize: 12.5,
										paddingBottom: 3,
									},
								}}
								rightSection={
									<ActionIcon
										variant="transparent"
										loading={areLocalSkillsUpdating}
										onClick={() => void localSkills.refetch()}
									>
										<ArrowClockwiseIcon size={18} />
									</ActionIcon>
								}
							/>
							<SkillView skills={localSkills.data ?? []} />
						</Stack>
					</ScrollArea>
				</Tabs.Panel>
			</Tabs>
		</Modal>
	);
}
