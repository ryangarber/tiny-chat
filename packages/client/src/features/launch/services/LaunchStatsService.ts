import { execFile } from "node:child_process";
import si from "systeminformation";

/** What a process tree is using, summed over every process in it. */
export interface ProcessTreeStats {
	pids: number[];
	cpu: number;
	/** Bytes. */
	memory: number;
	ports: number[];
}

/** How long one reading of the machine's processes is good for. */
const TTL_MS = 1500;

type Snapshot = {
	at: number;
	children: Map<number, number[]>;
	/** Members of each process group, by its leader; empty on Windows. */
	groups: Map<number, number[]>;
	usage: Map<number, { cpu: number; memory: number }>;
};

let snapshot: Promise<Snapshot> | undefined;
let snapshotAt = 0;

/** Every process on the machine, read at most once per `TTL_MS`. */
const getSnapshot = ({ fresh = false }: { fresh?: boolean } = {}) => {
	if (snapshot && !fresh && Date.now() - snapshotAt < TTL_MS) return snapshot;
	snapshotAt = Date.now();
	snapshot = Promise.all([si.processes(), getGroups()]).then(
		([{ list }, groups]) => {
			const children = new Map<number, number[]>();
			const usage = new Map<number, { cpu: number; memory: number }>();
			for (const process of list) {
				const siblings = children.get(process.parentPid);
				if (siblings) siblings.push(process.pid);
				else children.set(process.parentPid, [process.pid]);
				usage.set(process.pid, {
					cpu: Number.isFinite(process.cpu) ? process.cpu : 0,
					// systeminformation reports resident memory in KB.
					memory: (process.memRss ?? 0) * 1024,
				});
			}
			return { at: Date.now(), children, groups, usage };
		},
	);
	snapshot.catch(() => {
		snapshot = undefined;
	});
	return snapshot;
};

const run = (program: string, args: string[]) =>
	new Promise<string>((resolve) => {
		execFile(
			program,
			args,
			{ timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
			// lsof exits 1 when nothing matched, which is an answer too.
			(_, stdout) => resolve(stdout ?? ""),
		);
	});

/**
 * Each process group's members. A launch runs in a group of its own, which
 * holds what its shell started even once the shell is gone and they have been
 * reparented out of its tree. systeminformation does not report groups.
 */
const getGroups = async () => {
	const groups = new Map<number, number[]>();
	if (process.platform === "win32") return groups;
	const stdout = await run("ps", ["-A", "-o", "pid=,pgid="]);
	for (const line of stdout.split("\n")) {
		const [pid, pgid] = line.trim().split(/\s+/).map(Number);
		if (!pid || !pgid) continue;
		const members = groups.get(pgid);
		if (members) members.push(pid);
		else groups.set(pgid, [pid]);
	}
	return groups;
};

/**
 * TCP ports the processes listen on. systeminformation reads them from
 * `netstat` everywhere, whose output newer macOS no longer prints the way it
 * parses, so macOS asks `lsof` instead.
 */
const getPorts = async (pids: number[]): Promise<number[]> => {
	if (!pids.length) return [];
	const ports = new Set<number>();
	if (process.platform === "darwin") {
		const stdout = await run("lsof", [
			"-nP",
			"-a",
			"-iTCP",
			"-sTCP:LISTEN",
			"-p",
			pids.join(","),
			"-F",
			"n",
		]);
		for (const line of stdout.split("\n")) {
			const match = line.startsWith("n") && line.match(/:(\d+)$/);
			if (match) ports.add(Number(match[1]));
		}
	} else {
		const wanted = new Set(pids);
		const connections = await si.networkConnections().catch(() => []);
		for (const connection of connections) {
			if (
				wanted.has(connection.pid) &&
				connection.state?.toUpperCase().startsWith("LISTEN") &&
				connection.protocol?.toLowerCase().startsWith("tcp")
			) {
				const port = Number(connection.localPort);
				if (Number.isInteger(port) && port > 0) ports.add(port);
			}
		}
	}
	return [...ports].sort((a, b) => a - b);
};

export const LaunchStatsService = {
	/**
	 * Each root's tree as it stands: the root and every process under it, what
	 * they use, and the ports they listen on. Roots are read together, since
	 * listing the machine's processes is the slow part.
	 */
	get: async (roots: number[]): Promise<Map<number, ProcessTreeStats>> => {
		const result = new Map<number, ProcessTreeStats>();
		if (!roots.length) return result;
		let { at, children, groups, usage } = await getSnapshot();
		// A launch started since the last reading is not in it yet.
		if (roots.some((root) => !usage.has(root)) && Date.now() - at > 100) {
			({ at, children, groups, usage } = await getSnapshot({ fresh: true }));
		}

		const trees = roots.map((root) => {
			const pids: number[] = [];
			// The launch's group leads, as its shell may be gone.
			const queue = [root, ...(groups.get(root) ?? [])];
			const seen = new Set<number>();
			while (queue.length) {
				const pid = queue.shift() as number;
				if (seen.has(pid)) continue;
				seen.add(pid);
				// A root that has just started may not be listed yet.
				if (usage.has(pid) || pid === root) pids.push(pid);
				queue.push(...(children.get(pid) ?? []));
			}
			return { root, pids };
		});

		const ports = await Promise.all(
			trees.map(({ pids }) => getPorts(pids).catch(() => [])),
		);

		trees.forEach(({ root, pids }, index) => {
			let cpu = 0;
			let memory = 0;
			for (const pid of pids) {
				const used = usage.get(pid);
				cpu += used?.cpu ?? 0;
				memory += used?.memory ?? 0;
			}
			result.set(root, {
				pids: pids.filter((pid) => usage.has(pid)),
				cpu,
				memory,
				ports: ports[index] ?? [],
			});
		});
		return result;
	},
} as const;
