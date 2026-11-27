import { z } from "zod";

/**
 * Where a launch's process is in its life on one host.
 *
 * - `running`: started, and not yet asked to stop.
 * - `stopping`: asked to stop, and not gone yet.
 * - `stopped`: stopped on request, or never started here.
 * - `exited`: ended on its own — finished, or crashed.
 */
export const zLaunchState = z.enum([
	"running",
	"stopping",
	"stopped",
	"exited",
]);
export type zLaunchState = z.infer<typeof zLaunchState>;

/** The signals worth sending a process by hand. */
export const zLaunchSignal = z.enum([
	"SIGINT",
	"SIGTERM",
	"SIGHUP",
	"SIGQUIT",
	"SIGKILL",
	"SIGUSR1",
	"SIGUSR2",
]);
export type zLaunchSignal = z.infer<typeof zLaunchSignal>;

/**
 * A launch's process as its host sees it now. Times are epoch milliseconds,
 * and usage is summed over the script and everything it started.
 */
export const zLaunchStatus = z.object({
	id: z.string(),
	state: zLaunchState,
	pid: z.number().nullable(),
	/** When the current run, or the last, started. */
	startedAt: z.number().nullable(),
	/** When the last run ended; null while one is going. */
	endedAt: z.number().nullable(),
	/** How the last run ended. */
	code: z.number().nullable(),
	signal: z.string().nullable(),
	/** TCP ports its processes listen on. */
	ports: z.array(z.number()),
	/** Percent of one core. */
	cpu: z.number().nullable(),
	/** Resident memory, in bytes. */
	memory: z.number().nullable(),
	/** How many processes it is made of. */
	processes: z.number(),
});
export type zLaunchStatus = z.infer<typeof zLaunchStatus>;

/** A launch as its host is told to run it. */
export const zLaunchProcess = z.object({
	id: z.string(),
	script: z.string(),
	/** Where it runs, as the host spells it; the host's home when unset. */
	cwd: z.string().optional(),
});
export type zLaunchProcess = z.infer<typeof zLaunchProcess>;
