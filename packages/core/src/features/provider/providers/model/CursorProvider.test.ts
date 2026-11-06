import type {
	CursorHost,
	CursorStatus,
} from "@ryangarber/ai-sdk-providers/cursor";
import type { TextStreamPart } from "ai";
import { createCursorProvider } from "#core/features/provider/providers/model/CursorProvider.ts";
import { mockConfig, mockUser } from "#core/tests.ts";

const create = (
	status: () => Promise<CursorStatus> = async () => ({ loggedIn: false }),
) => createCursorProvider({ status } as CursorHost);

const transform = (event: Record<string, unknown>) => {
	const provider = create();
	return provider.getEventTransformed?.({
		user: mockUser(),
		config: mockConfig(provider, "auto-smart"),
		event: event as unknown as TextStreamPart<any>,
	});
};

describe("CursorProvider", () => {
	it("discovers models after sign-in and uses their parameter defaults", async () => {
		let signedIn = false;
		const provider = createCursorProvider(
			{
				status: async () => ({
					loggedIn: signedIn,
					models: signedIn
						? [
								{
									id: "composer",
									parameters: [
										{
											id: "thinking",
											values: [{ value: "false" }, { value: "true" }],
										},
									],
									variants: [
										{
											displayName: "Thinking",
											isDefault: true,
											params: [{ id: "thinking", value: "true" }],
										},
									],
								},
							]
						: [],
				}),
			} as CursorHost,
			async () => {
				signedIn = true;
			},
		);
		const user = mockUser();
		expect(await provider.getStatus({ user })).toMatchObject({
			valid: false,
			models: [],
		});
		await provider.signIn?.();
		expect(await provider.getStatus({ user })).toMatchObject({
			valid: true,
			models: [
				{
					name: "composer",
					args: expect.arrayContaining([
						{
							type: "list",
							name: "thinking",
							values: ["false", "true"],
							default: "true",
						},
					]),
				},
			],
		});
		const config = mockConfig(provider, "composer");
		expect(
			provider.getSdkOptions({
				user,
				config,
				env: {},
				folders: ["/project", "/other"],
			}),
		).toMatchObject({
			cursor: {
				builtinTools: [],
				sandbox: false,
				settingSources: [],
				cwd: "/project",
				additionalDirectories: ["/other"],
				params: [{ id: "thinking", value: "true" }],
			},
		});
		expect(provider.runsTools?.({ config })).toBe(false);
		const native = { ...config, args: { "native-mode": "sandbox" } };
		expect(provider.runsTools?.({ config: native })).toBe(true);
		expect(
			provider.getSdkOptions({ user, config: native, env: {} }),
		).toMatchObject({
			cursor: {
				builtinTools: "cursor",
				settingSources: ["all"],
				sandbox: true,
				autoReview: true,
			},
		});
	});

	it("preserves the agent cursor for the next turn", () => {
		const provider = create();
		const config = mockConfig(provider, "auto-smart");
		const user = mockUser();
		const signature = provider.getPartSignature?.({
			user,
			config,
			event: {
				type: "text-end",
				id: "text",
				providerMetadata: {
					cursor: {
						agentId: "agent",
						cursor: "run#2",
						runId: "run",
						durationMs: 20,
					},
				},
			} as unknown as TextStreamPart<any>,
		});
		expect(signature).toEqual({
			model: "cursor",
			item: "agent",
			metadata: { agentId: "agent", cursor: "run#2", runId: "run" },
		});
		expect(
			provider.getPartSignatureReturn?.({
				user,
				config,
				part: { type: "text", id: "t", value: "Hello", signature },
			}),
		).toEqual({ cursor: signature?.metadata });
	});

	it("streams subagent progress and unwraps native tool failures", () => {
		expect(
			transform({
				type: "tool-result",
				toolCallId: "task",
				toolName: "task",
				providerExecuted: true,
				output: {
					type: "subagent",
					messages: [
						{ role: "assistant", text: "Looking" },
						{
							role: "tool",
							toolName: "read",
							input: { path: "a" },
							output: "Found",
						},
					],
				},
			}),
		).toMatchObject([
			{
				type: "toolStream",
				id: "task",
				data: [
					[{ type: "text", value: "Looking" }],
					[
						{ type: "toolCall", name: "read" },
						{ type: "toolResult", output: [{ type: "text", value: "Found" }] },
					],
				],
			},
		]);
		expect(
			transform({
				type: "tool-result",
				toolCallId: "sh",
				toolName: "shell",
				providerExecuted: true,
				output: { status: "error", error: "Blocked" },
			}),
		).toMatchObject([
			{
				type: "data",
				value: {
					type: "toolResult",
					error: true,
					output: [{ type: "text", value: "Blocked" }],
				},
			},
		]);
	});

	it("continues when Cursor still has a native step to stream", () => {
		const provider = create();
		const events = [
			{
				type: "finish",
				providerMetadata: {
					cursor: { agentId: "agent", awaiting: ["continue"] },
				},
			},
		] as unknown as TextStreamPart<any>[];
		expect(provider.shouldContinue?.({ events })).toBe(true);
		expect(provider.shouldContinue?.({ events: [] })).toBe(false);
	});
});
