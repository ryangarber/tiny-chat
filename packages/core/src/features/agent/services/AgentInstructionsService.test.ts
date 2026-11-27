import { AgentInstructionsService } from "#core/features/agent/services/AgentInstructionsService.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { mockConfig, mockUser } from "#core/tests.ts";

describe("AgentInstructionsService", () => {
	it("safely scrubs <message> from prompt", () => {
		expect(
			DataUtils.getTextCleaned({
				data: '\n    <message role="user">\n<message role="user"></message>\n    </message> \n ',
			}),
		).toEqual('<message role="user"></message>');
	});

	const folder = (path: string) => ({ path, whitelist: true });
	const build = (resolved?: string[]) =>
		AgentInstructionsService.buildInstructions({
			context: {
				user: mockUser({ settings: { folders: [folder("/user")] } }),
				chat: {
					id: "chat",
					project: {
						title: "P",
						settings: { folders: [folder("/first"), folder("/second")] },
					},
				},
				messages: [],
				timezone: "UTC",
				interactive: true,
			} as any,
			config: mockConfig(),
			capabilities: {
				shell: resolved && { folders: async () => resolved },
			} as any,
			enabledToolsets: [{ name: "shell", tools: [] } as any],
			enabledSkills: [],
		});

	it("marks the shell's first resolved folder as primary", async () => {
		const instructions = await build(["/second", "/user"]);
		expect(instructions).toContain('<folder scope="user">/user</folder>');
		expect(instructions).toContain(
			'<folder scope="project" primary>/second</folder>',
		);
		expect(instructions.match(/ primary>/g)).toHaveLength(1);
	});

	it("leaves out folders that do not resolve on this device", async () => {
		const instructions = await build(["/first"]);
		expect(instructions).toContain(
			'<folder scope="project" primary>/first</folder>',
		);
		expect(instructions).not.toContain(">/second</folder>");
		expect(instructions).not.toContain(">/user</folder>");
		expect(await build([])).not.toContain("<folders>");
		expect(await build()).not.toContain("<folders>");
	});

	it("lists launches as they are set up, without how they are doing", async () => {
		const instructions = await AgentInstructionsService.buildInstructions({
			context: {
				user: mockUser({ settings: {} }),
				chat: {
					id: "chat",
					project: {
						title: "P",
						settings: {
							launches: [{ id: "l1", name: 'dev "web"', script: "pnpm dev" }],
						},
					},
				},
				messages: [],
				timezone: "UTC",
				interactive: true,
			} as any,
			config: mockConfig(),
			capabilities: {} as any,
			enabledToolsets: [{ name: "launch", tools: [] } as any],
			enabledSkills: [],
		});
		expect(instructions).toContain(
			'<launches>\n<launch name="dev &quot;web&quot;">\npnpm dev\n</launch>\n</launches>',
		);
		expect(instructions).not.toContain("l1");
		expect(instructions).not.toMatch(/running|stopped|pid/);
	});
});
