import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

describe("LaunchUtils", () => {
	const running = {
		...LaunchUtils.idle("a"),
		state: "running" as const,
		pid: 10,
		startedAt: 0,
		ports: [5173, 3000],
		cpu: 2.14,
		memory: 120 * 1024 * 1024,
		processes: 3,
	};

	it("reads a project's launches and never the user's", () => {
		const launch = { id: "a", name: "dev", script: "pnpm dev" };
		expect(LaunchUtils.of({ settings: { launches: [launch] } })).toEqual([
			launch,
		]);
		expect(LaunchUtils.of(null)).toEqual([]);
		expect(LaunchUtils.find({ launches: [launch], name: " DEV " })?.id).toBe(
			"a",
		);
	});

	it("writes a launch on one line and reads it back", () => {
		expect(LaunchUtils.parse("dev: pnpm dev:web")).toEqual({
			name: "dev",
			script: "pnpm dev:web",
		});
		// No `: ` means no name: the script names itself.
		expect(LaunchUtils.parse("pnpm dev:web")).toEqual({
			name: "pnpm dev:web",
			script: "pnpm dev:web",
		});
		expect(LaunchUtils.parse("  ")).toBeNull();
		for (const text of ["dev: pnpm dev:web", "pnpm dev"]) {
			const parsed = LaunchUtils.parse(text);
			expect(parsed && LaunchUtils.format(parsed)).toBe(text);
		}
	});

	it("sums up a running launch", () => {
		expect(LaunchUtils.details(running, 125_000)).toEqual([
			"2m 5s",
			":5173 :3000",
			"2.1% CPU",
			"120 MB",
		]);
		expect(LaunchUtils.details(LaunchUtils.idle("a"))).toEqual([]);
	});

	it("tells a crash from a clean finish", () => {
		const ended = { ...LaunchUtils.idle("a"), state: "exited" as const };
		expect(LaunchUtils.label({ ...ended, code: 0 })).toBe("finished");
		expect(LaunchUtils.label({ ...ended, code: 1 })).toBe("crashed (exit 1)");
		expect(LaunchUtils.label({ ...ended, signal: "SIGKILL" })).toBe(
			"crashed (SIGKILL)",
		);
	});

	it("describes a status for the model without ids or epochs", () => {
		const launch = { id: "a", name: "dev", script: "pnpm dev" };
		const described = LaunchUtils.describe({
			launch,
			status: running,
			now: 4_330_000,
		});
		expect(described).toMatchObject({
			name: "dev",
			state: "running",
			uptime: "1h 12m",
			ports: [5173, 3000],
			cpu: "2.1%",
			memory: "120 MB",
		});
		expect(JSON.stringify(described)).not.toContain('"a"');
	});

	it("formats sizes and keeps the end of output", () => {
		expect(LaunchUtils.formatBytes(900)).toBe("900 B");
		expect(LaunchUtils.formatBytes(1536)).toBe("1.5 KB");
		expect(LaunchUtils.formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
		expect(LaunchUtils.tail("a\nb\nc\n", 2)).toBe("b\nc");
		expect(LaunchUtils.stripAnsi("\x1b[32mready\x1b[0m\r\x1b[2Kdone")).toBe(
			"ready\ndone",
		);
	});
});
