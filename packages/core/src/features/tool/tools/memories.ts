import type {
	EmbeddingCapability,
	MemoriesCapability,
} from "#core/core/types/capability.ts";
import { createEditMemoriesTool } from "#core/features/tool/tools/memories/edit_memories.ts";
import { createSearchChatsTool } from "#core/features/tool/tools/memories/search_chats.ts";
import { createSearchMemoriesTool } from "#core/features/tool/tools/memories/search_memories.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";

export const createMemoriesToolset: ToolsetFactory<
	Toolset<{ embedding?: EmbeddingCapability; memories: MemoriesCapability }>
> = async (options) => ({
	name: "memories",
	tools: [
		await createSearchMemoriesTool(options),
		await createSearchChatsTool(options),
		await createEditMemoriesTool(options),
	],
	...options,
});
