import type { ComputerCapability } from "#core/core/types/capability.ts";
import { ComputerService } from "#core/features/tool/services/ComputerService.ts";
import type { zComputerNode } from "#core/features/tool/types/computer.ts";

/**
 * Stands in for `ComputerHostService`: one app window, whose tree is read with fresh
 * handles every time, as the real library does.
 */
const createLibrary = () => {
	let handle = 0;
	let live = new Map<number, string>();
	const calls: { method: string; params: any }[] = [];
	let staleOnce = false;

	const tree = () => {
		live = new Map();
		const node = (
			parent: number | null,
			fields: Omit<zComputerNode, "handle" | "parent">,
		) => {
			const id = ++handle;
			live.set(id, fields.name ?? fields.role);
			return { handle: id, parent, ...fields };
		};
		const window = node(null, { role: "window", name: "Calc", stableId: "/1" });
		return [
			window,
			node(window.handle, {
				role: "button",
				name: "7",
				actions: ["press"],
				stableId: "/2",
				bounds: { x: 0, y: 0, width: 10, height: 10 },
			}),
			node(window.handle, {
				role: "text_field",
				name: "Display",
				value: "0",
				states: ["editable"],
			}),
		];
	};

	const capability: ComputerCapability = {
		call: async ({ method, params }) => {
			calls.push({ method, params });
			const ok = (result: unknown = null) => ({ ok: true, result });
			switch (method) {
				case "status":
					return ok({
						os: "linux",
						pid: 1,
						input: true,
						missing: [],
						errors: {},
					});
				case "windows":
					return ok([
						{
							id: 1,
							pid: 1,
							app: "tiny-chat",
							title: "Tiny Chat",
							focused: true,
						},
						{
							id: 2,
							pid: 50,
							app: "gnome-calculator",
							title: "Calculator",
							focused: false,
						},
					]);
				case "tree":
					return ok({ nodes: tree(), truncated: false });
				case "act": {
					const { handle } = params as { handle: number };
					if (staleOnce || !live.has(handle)) {
						staleOnce = false;
						return { ok: false, error: { code: "stale", message: "stale" } };
					}
					return ok();
				}
				default:
					return ok();
			}
		},
	};

	return {
		capability,
		calls,
		makeStale: () => {
			staleOnce = true;
		},
	};
};

describe("ComputerService", () => {
	it("hides Tiny Chat's own windows and targets by app name", async () => {
		const { capability } = createLibrary();
		const result = await ComputerService.run({
			capability,
			window: "calc",
			steps: [{ action: "windows" }],
		});
		expect(result.window).toEqual({
			id: "w2",
			app: "gnome-calculator",
			title: "Calculator",
		});
		expect(result.steps[0]?.value).toEqual([
			{ id: "w2", app: "gnome-calculator", title: "Calculator", target: true },
		]);
	});

	it("keeps refs across reads and re-finds stale ones", async () => {
		const { capability, calls, makeStale } = createLibrary();
		const first = await ComputerService.run({
			capability,
			window: "w2",
			steps: [{ action: "read" }],
		});
		expect(first.steps[0]?.value).toBe(
			[
				'- window "Calc":',
				'  - button "7" [ref=e1]',
				'  - text_field "Display" [ref=e2]: 0',
			].join("\n"),
		);

		const second = await ComputerService.run({
			capability,
			steps: [{ action: "read" }],
		});
		expect(second.steps[0]?.value).toBe(first.steps[0]?.value);

		makeStale();
		const click = await ComputerService.run({
			capability,
			steps: [{ action: "click", ref: "e1" }],
		});
		expect(click.steps).toEqual([
			{ action: "click", ok: true, value: "pressed" },
		]);
		// The second read's button (5) went stale, so it read the window a third
		// time and pressed that read's button (8).
		const acts = calls.filter((call) => call.method === "act");
		expect(acts.map((call) => call.params.handle)).toEqual([5, 8]);
	});

	it("stops at the first failing step", async () => {
		const { capability } = createLibrary();
		const result = await ComputerService.run({
			capability,
			window: "w2",
			steps: [
				{ action: "click", x: 5, y: 5 },
				{ action: "press", keys: "Enter" },
			],
		});
		expect(result.steps).toEqual([
			{
				action: "click",
				ok: false,
				error: "x/y are pixels in a screenshot; take one first, or use a ref",
			},
		]);
		expect(result.skipped).toBe(1);
	});

	it("reports what is missing", async () => {
		const status = await ComputerService.status({
			call: async () => ({
				ok: true,
				result: {
					os: "macos",
					pid: 1,
					input: true,
					missing: ["accessibility"],
					errors: {},
				},
			}),
		});
		expect(status.available).toBe(false);
		expect(status.error).toContain("Privacy & Security › Accessibility");
	});
});
