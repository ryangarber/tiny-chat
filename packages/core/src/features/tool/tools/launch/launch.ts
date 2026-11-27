import { z } from "zod";
import type { LaunchCapability } from "#core/core/types/capability.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import { zLaunchSignal } from "#core/features/tool/types/launch.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

/** How long a launch is watched after it starts, to catch it falling over. */
const SETTLE_MS = 2000;
/** Lines of output a start shows, to tell how it went. */
const START_LINES = 30;

const zAction = z.enum([
	"status",
	"start",
	"stop",
	"restart",
	"signal",
	"logs",
]);

export const launch = {
	name: "launch",
	description: `Control the project's launches — the scripts listed in <launches>, such as dev servers and watchers — on the user's machine, and see how they are doing. Processes outlive the call: they keep running until stopped or the app quits.

- \`status\`: state, pid, uptime, listening ports, CPU and memory, for one launch or (without \`name\`) all of them. This is the only source of truth for what is running; check it rather than assuming.
- \`start\` / \`restart\`: (re)starts it and returns its status a moment later, with the first of its output, so a crash on startup shows. Starting one that is running leaves it be.
- \`stop\`: SIGTERM (or \`signal\`), then SIGKILL for whatever is left after \`timeout\` ms.
- \`signal\`: sends \`signal\` to the launch and everything it started, e.g. SIGHUP to reload or SIGUSR2 for a custom handler. Windows only supports ending processes.
- \`logs\`: the last \`lines\` of its output (stdout and stderr together), optionally only lines matching \`filter\`.`,
	input: z.object({
		action: zAction,
		name: z
			.string()
			.optional()
			.describe(
				"The launch, by its name in <launches>. Required except for `status`.",
			),
		signal: zLaunchSignal
			.optional()
			.describe("For `signal` (required) and `stop` (default SIGTERM)."),
		timeout: z
			.number()
			.int()
			.min(0)
			.max(60_000)
			.optional()
			.describe("For `stop`: ms to wait before SIGKILL. Default 5000."),
		lines: z
			.number()
			.int()
			.min(1)
			.max(2000)
			.optional()
			.describe("For `logs`: how many lines from the end. Default 100."),
		filter: z
			.string()
			.optional()
			.describe(
				"For `logs`: a case-insensitive regular expression; only matching lines are returned.",
			),
	}),
	output: z.object({
		name: z.string(),
		state: z.string(),
		pid: z.number().nullable().optional(),
		uptime: z.string().nullable().optional(),
		ports: z.array(z.number()).optional(),
		cpu: z.string().optional(),
		memory: z.string().optional(),
		processes: z.number().optional(),
		ended: z.string().optional(),
		exit: z.string().nullable().optional(),
	}),
} as const satisfies ToolDefinition;

const VERBS: Record<z.infer<typeof zAction>, [string, string]> = {
	status: ["Checking", "Checked"],
	start: ["Starting", "Started"],
	stop: ["Stopping", "Stopped"],
	restart: ["Restarting", "Restarted"],
	signal: ["Signaling", "Signaled"],
	logs: ["Reading logs of", "Read logs of"],
};

const display: ToolDisplay<typeof launch> = {
	status: ({ input }) => [
		VERBS[input.action ?? "status"] ?? VERBS.status,
		input.name
			? { count: ["launch", "launches"], subject: input.name }
			: { count: ["launch", "launches"], subject: "all launches" },
		...(input.action === "signal" && input.signal
			? [` with ${input.signal}`]
			: []),
	],
	output: ({ output }) =>
		output.map((status) => ({
			type: "record",
			title: status.name,
			details: [
				status.state,
				...(status.uptime ? [`up ${status.uptime}`] : []),
				...(status.ports?.length
					? [status.ports.map((port) => `:${port}`).join(" ")]
					: []),
				...(status.cpu ? [`${status.cpu} CPU`] : []),
				...(status.memory ? [status.memory] : []),
				...(status.ended ? [`ended ${status.ended}`] : []),
			],
		})),
	text: { title: "output" },
};

const sleep = (ms: number, abort?: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		abort?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});

const getLaunches = (context: zAgentContext) =>
	LaunchUtils.of(context.chat?.project);

const findLaunch = (context: zAgentContext, name: string | undefined) => {
	const launches = getLaunches(context);
	const names = launches.map((launch) => `"${launch.name}"`).join(", ");
	if (!name) throw new Error(`Name a launch: ${names || "there are none"}.`);
	const found = LaunchUtils.find({ launches, name });
	if (!found)
		throw new Error(`No launch is named "${name}". Launches: ${names}.`);
	return found;
};

export const createLaunchTool: ToolFactory<
	Tool<typeof launch, { launch: LaunchCapability }>
> = (options) => ({
	...launch,
	...options,
	display,
	// A restart racing a stop of the same launch would leave it either way.
	sequential: true,
	validate: async ({ input, context }) => {
		if (input.action !== "status") findLaunch(context, input.name);
		if (input.action === "signal" && !input.signal) {
			throw new Error("`signal` needs a signal to send.");
		}
		if (input.filter) new RegExp(input.filter, "i");
		return undefined;
	},
	execute: async ({ input, context, abort }) => {
		const capability = options.capabilities.launch;
		const json = (
			launch: zLaunch,
			status: Awaited<ReturnType<LaunchCapability["start"]>>,
		) => ({
			type: "json" as const,
			value: LaunchUtils.describe({ launch, status }),
		});

		if (input.action === "status") {
			const launches = input.name
				? [findLaunch(context, input.name)]
				: getLaunches(context);
			const statuses = await capability.status({ launches });
			return launches.map((launch, index) =>
				json(launch, statuses[index] ?? LaunchUtils.idle(launch.id)),
			);
		}

		const target = findLaunch(context, input.name);

		if (input.action === "logs") {
			const raw = LaunchUtils.stripAnsi(
				await capability.logs({ launch: target, lines: 2000 }),
			);
			const lines = input.lines ?? 100;
			const pattern = input.filter ? new RegExp(input.filter, "i") : null;
			const kept = pattern
				? raw
						.split("\n")
						.filter((line) => pattern.test(line))
						.join("\n")
				: raw;
			const [status] = await capability.status({ launches: [target] });
			return [
				json(target, status ?? LaunchUtils.idle(target.id)),
				{
					type: "text",
					value: LaunchUtils.tail(kept, lines) || "(no output)",
				},
			];
		}

		if (input.action === "stop") {
			const status = await capability.stop({
				launch: target,
				signal: input.signal,
				timeout: input.timeout,
			});
			return [json(target, status)];
		}

		if (input.action === "signal" && input.signal) {
			const status = await capability.signal({
				launch: target,
				signal: input.signal,
			});
			return [json(target, status)];
		}

		// Started: watched for a moment, so a crash on startup is seen.
		const started =
			input.action === "restart"
				? await capability.restart({ launch: target })
				: await capability.start({ launch: target });
		await sleep(SETTLE_MS, abort);
		const [status] = await capability.status({ launches: [target] });
		const output = LaunchUtils.tail(
			LaunchUtils.stripAnsi(await capability.logs({ launch: target })),
			START_LINES,
		);
		return [
			json(target, status ?? started),
			{ type: "text", value: output || "(no output yet)" },
		];
	},
});
