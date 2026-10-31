import type { Client } from "@modelcontextprotocol/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { useCapabilities } from "#client/core/hooks/useCapabilities.ts";
import { useStableKey } from "#client/core/hooks/useStableKey.ts";
import { useMcp } from "#client/features/agent/hooks/useMcp.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zDataSimplePart } from "#core/features/data/types/part.ts";
import type { zMCPServers } from "#core/features/data/types/user.ts";
import { ToolService } from "#core/features/tool/services/ToolService.ts";
import type { Tool, Toolset } from "#core/features/tool/types/tool.ts";

export interface McpToolset extends Toolset<void> {
	server: NonNullable<zMCPServers>[keyof NonNullable<zMCPServers>];
	client: Client;
}

export const nativeToolsQueryKey = ["useTools", "nativeTools"] as const;
export const mcpToolsQueryKey = ["useTools", "mcpTools"] as const;

export const useTools = () => {
	const { capabilities } = useCapabilities({ future: true });
	const { mcpServers, refreshMcpServers } = useMcp();
	const capabilitiesKey = useStableKey({ capabilities: capabilities.data });

	const nativeTools = useQuery({
		queryKey: [...nativeToolsQueryKey, capabilitiesKey],
		queryFn: async () => {
			return await ToolService.getTools({
				capabilities: capabilities.data ?? {},
			});
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const serversKey = useStableKey({ mcpServers: mcpServers.data });

	const mcpTools = useQuery({
		queryKey: [...mcpToolsQueryKey, serversKey],
		queryFn: async () => {
			return (
				mcpServers.data?.map(
					({ name, server, client, tools, error }): McpToolset => ({
						name: name.replace("-", "_").toLowerCase(),
						prefix: name.replace("-", "_").toLowerCase(),
						instructions: client.getInstructions(),
						capabilities: void 0,
						status: {
							valid: !error,
							error,
						},
						tools: tools.map(
							(tool): Tool<any, void> => ({
								name: tool.name,
								description: tool.description ?? "",
								// A server's tool may change files, and never says which.
								tracksChanges: !tool.annotations?.readOnlyHint,

								input: z.fromJSONSchema(
									tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0],
								),
								output: tool.outputSchema
									? z.fromJSONSchema(
											tool.outputSchema as Parameters<
												typeof z.fromJSONSchema
											>[0],
										)
									: z.unknown(),

								execute: async ({
									input,
									...rest
								}): Promise<zDataSimplePart[]> => {
									console.log("[useTools] calling mcp tool:", {
										input,
										...rest,
									});
									const { isError, content } = await client.callTool({
										name: tool.name,
										arguments: input,
									});
									console.log("[useTools] mcp response:", { isError, content });
									if (isError) throw new Error(JSON.stringify(content));
									return content.map((part): zDataSimplePart => {
										if (part.type === "text") {
											return {
												id: CommonUtils.getRandomId(),
												type: "text",
												value: part.text,
											};
										} else if (part.type === "image" || part.type === "audio") {
											return {
												id: CommonUtils.getRandomId(),
												type: "file",
												mime: part.mimeType,
												data: part.data,
											};
										}
										console.warn(
											"[useTools] mcp returned part with unknown support:",
											part,
										);
										return {
											id: CommonUtils.getRandomId(),
											type: "json",
											value: part,
										};
									});
								},

								capabilities: void 0,
							}),
						),
						server,
						client,
					}),
				) ?? []
			);
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { tools, toolsets } = useMemo(() => {
		const toolsets = [...(nativeTools.data ?? []), ...(mcpTools.data ?? [])];
		const tools = toolsets.flatMap((toolset) => toolset.tools);
		return { tools, toolsets };
	}, [nativeTools.data, mcpTools.data]);

	return {
		nativeTools,
		mcpTools,
		mcpServers,
		refreshMcpServers,
		tools,
		toolsets,
		capabilities,
	};
};
