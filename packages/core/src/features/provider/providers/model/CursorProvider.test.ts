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
		expect(
			provider.getSdkOptions({
				user,
				config: { ...config, args: { "native-mode": "full-access" } },
				env: {},
			}),
		).toMatchObject({
			cursor: { builtinTools: "cursor", sandbox: false, autoReview: false },
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
				output: { status: "error", error: { message: "Blocked" } },
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

	it("reads native results as their Tiny Chat counterparts return them", () => {
		const output = (toolName: string, value: unknown) =>
			(
				transform({
					type: "tool-result",
					toolCallId: toolName,
					toolName,
					providerExecuted: true,
					output: { status: "success", value },
				}) as { value: { output: unknown[] } }[]
			)[0].value.output;

		expect(
			output("shell", {
				exitCode: 1,
				signal: "",
				stdout: "out",
				stderr: "err",
				executionTime: 5,
			}),
		).toMatchObject([
			{ type: "json", value: { stdout: "out", stderr: "err", code: 1 } },
		]);
		expect(
			output("read", { content: "hello", totalLines: 1, fileSize: 5 }),
		).toMatchObject([{ type: "json", value: { content: "hello" } }]);
		expect(output("edit", { linesAdded: 1, diffString: "+a" })).toEqual([]);
		expect(
			output("glob", {
				files: ["/p/a.ts"],
				totalFiles: 1,
				clientTruncated: false,
				ripgrepTruncated: false,
			}),
		).toMatchObject([{ type: "json", value: "/p/a.ts" }]);
		expect(
			output("grep", {
				workspaceResults: {
					"/p": {
						type: "content",
						output: {
							totalMatches: 1,
							matches: [
								{
									file: "/p/a.ts",
									lineNumber: 3,
									line: "foo",
									beforeContext: ["one", "two"],
									afterContext: ["four"],
								},
							],
						},
					},
				},
			}),
		).toMatchObject([
			{
				type: "json",
				value: { path: "/p/a.ts", snippet: "1-one\n2-two\n3:foo\n4-four" },
			},
		]);
		expect(
			output("ls", {
				directoryTreeRoot: {
					absPath: "/p",
					childrenDirs: [
						{
							absPath: "/p/src",
							childrenDirs: [],
							childrenFiles: [{ name: "b.ts" }],
						},
					],
					childrenFiles: [{ name: "a.ts" }],
				},
			}),
		).toMatchObject([
			{ type: "json", value: { path: "/p/src", is_dir: true } },
			{ type: "json", value: { path: "/p/src/b.ts", is_dir: false } },
			{ type: "json", value: { path: "/p/a.ts", is_dir: false } },
		]);
		expect(
			output("task", {
				isBackground: false,
				backgroundReason: "unspecified",
				conversationSteps: [
					{ assistantMessage: { text: "Looking" } },
					{ toolCall: {} },
					{ assistantMessage: { text: "Done" } },
				],
			}),
		).toMatchObject([{ type: "text", value: "Done" }]);
		expect(
			output("mcp", {
				isError: false,
				content: [
					{ text: { text: "Tea" } },
					{ image: { data: "AAAA", mimeType: "image/jpeg" } },
				],
			}),
		).toMatchObject([
			{ type: "text", value: "Tea" },
			{ type: "file", mime: "image/jpeg", data: "AAAA" },
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
