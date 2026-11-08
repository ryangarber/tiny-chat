import { z } from "zod";
import type { DistributiveOmit } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import type {
	zFilePart,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import type {
	OutputPart,
	Tool,
	ToolDefinition,
	Toolset,
} from "#core/features/tool/types/tool.ts";

export type ToolCall<T extends ToolDefinition> = Omit<
	zToolCallPart,
	"name" | "input"
> & { name: T["name"]; input: z.infer<T["input"]> };

export type ToolResult<T extends ToolDefinition> = Omit<
	zToolResultPart,
	"name" | "output"
> & {
	name: T["name"];
	output: T["output"] extends z.ZodNever
		? never
		: DistributiveOmit<OutputPart<T>, "id">[];
};

/**
 * Resolved-name lookup per `toolsets` array identity.
 *
 * `find` used to rescan every toolset and rebuild a `RegExp` per tool on each
 * call, and `ToolCallUtils.getDetails` calls it once per `is()` branch — over
 * twenty full scans for a single tool call. Indexing once per toolset list
 * turns that into a map lookup. Keyed weakly so a replaced list is collected.
 */
const indexes = new WeakMap<
	Toolset<any>[],
	Map<string, { toolset: Toolset<any>; tool: Tool<any, any> }>
>();

const getIndex = (toolsets: Toolset<any>[]) => {
	let index = indexes.get(toolsets);
	if (index) return index;

	index = new Map();
	for (const toolset of toolsets) {
		for (const tool of toolset.tools) {
			// First match wins, matching the original scan order.
			const name = ToolUtils.name({ toolset, tool });
			if (!index.has(name)) index.set(name, { toolset, tool });
		}
	}

	indexes.set(toolsets, index);
	return index;
};

const addAdditionalProperties = (schema: unknown): unknown => {
	if (!schema || typeof schema !== "object") return schema;
	const result = { ...(schema as Record<string, any>) };
	const types = Array.isArray(result.type) ? result.type : [result.type];
	if (types.includes("object")) {
		result.additionalProperties =
			result.additionalProperties &&
			typeof result.additionalProperties === "object"
				? addAdditionalProperties(result.additionalProperties)
				: false;
		if (result.properties) {
			result.properties = Object.fromEntries(
				Object.entries(result.properties).map(([key, value]) => [
					key,
					addAdditionalProperties(value),
				]),
			);
		}
	}
	if (result.items)
		result.items = Array.isArray(result.items)
			? result.items.map(addAdditionalProperties)
			: addAdditionalProperties(result.items);
	for (const key of ["anyOf", "allOf", "oneOf"] as const) {
		if (result[key]) result[key] = result[key].map(addAdditionalProperties);
	}
	if (result.definitions) {
		result.definitions = Object.fromEntries(
			Object.entries(result.definitions).map(([key, value]) => [
				key,
				addAdditionalProperties(value),
			]),
		);
	}
	return result;
};

/**
 * The function-tool shape the AI SDK prepares for providers. Keeping this in
 * core gives token estimation and cache keys the same serialized definition
 * that generation uses instead of the opaque Zod object identity.
 */
const getPromptDefinition = (tool: ToolDefinition) => {
	const input = tool.input as unknown;
	let inputSchema = input;
	if (input && typeof input === "object" && "_zod" in input) {
		inputSchema = addAdditionalProperties(
			z.toJSONSchema(input as z.ZodType, {
				target: "draft-7",
				io: "input",
				reused: "inline",
			}),
		);
	}

	return {
		type: "function" as const,
		name: tool.name,
		description: tool.description,
		inputSchema,
	};
};

export const ToolUtils = {
	getPromptDefinition,

	name: ({
		toolset,
		tool,
	}: {
		toolset: Toolset<any>;
		tool?: Tool<any, any>;
	}) => {
		const prefix = tool?.prefix ?? toolset.prefix;
		let name = tool?.name ?? toolset.name;
		if (prefix === name) return name;
		if (prefix) {
			name = name.replace(
				new RegExp(`^${CommonUtils.escapeRegex(prefix)}[_-]?`),
				"",
			);
		}
		return `${prefix ? `${prefix}_` : ""}${name}`;
	},

	find: ({
		toolsets,
		name,
		part,
	}: {
		toolsets: Toolset<any>[];
		name?: string;
		part?: zToolCallPart | zToolResultPart;
	}) => {
		name ??= part?.name;
		if (name === undefined) return { toolset: null, tool: null };

		return getIndex(toolsets).get(name) ?? { toolset: null, tool: null };
	},

	/** The toolsets the user turns on, leaving out those the chat does. */
	selectable: <T extends Toolset<any>>(toolsets: T[]): T[] =>
		toolsets.filter((toolset) => !toolset.when),

	checkOne: ({
		toolset,
		config,
	}: {
		toolset: Toolset<any>;
		config: zConfig;
	}) => {
		return (
			toolset.status.valid &&
			config.toolsets?.includes(ToolUtils.name({ toolset }))
		);
	},

	checkAll: ({
		toolsets: _toolsets,
		config,
	}: {
		toolsets: Toolset<any>[];
		config: zConfig;
	}) => {
		const toolsets = _toolsets.filter((toolset) =>
			ToolUtils.checkOne({ toolset, config }),
		);
		const tools = toolsets.flatMap((toolset) => toolset.tools);
		return { toolsets, tools };
	},

	/**
	 * Runs a bulk tool's steps in order, stopping at the first that fails. What
	 * ran is reported either way, so the model knows what is already applied.
	 */
	runSteps: async <TStep, TResult>({
		steps,
		run,
		failed,
		abort,
	}: {
		steps: TStep[];
		run: (step: TStep) => Promise<TResult>;
		/** The failed step's result, given the error it threw. */
		failed: (step: TStep, error: string) => TResult;
		abort?: AbortSignal;
	}): Promise<{ steps: TResult[]; skipped?: number }> => {
		const results: TResult[] = [];
		for (const [index, step] of steps.entries()) {
			abort?.throwIfAborted();
			try {
				results.push(await run(step));
			} catch (error) {
				results.push(failed(step, CommonUtils.formatError({ error })));
				const skipped = steps.length - index - 1;
				return { steps: results, ...(skipped ? { skipped } : {}) };
			}
		}
		return { steps: results };
	},

	is: <T extends ToolDefinition>(
		toolsets: Toolset<any>[],
		part: zToolCallPart | Extract<RenderedPart, { type: "toolCall" }>,
		isTool: T,
	): part is ToolCall<T> & { result: ToolResult<T> } => {
		const { tool } = ToolUtils.find({ toolsets, part });
		return tool?.name === isTool.name;
	},

	json: <T extends ToolDefinition>(
		value?: zToolResultPart | zToolResultPart["output"],
		multiple?: boolean,
	): z.infer<T["output"]>[] => {
		if (!value) return [];
		if (!Array.isArray(value)) value = value.output;
		let json = value
			.filter((part) => part.type === "json")
			.map(({ value }) => value);
		if (multiple && Array.isArray(json[0])) json = json.flat();
		return json as z.infer<T["output"]>[];
	},

	file: (
		value?: zToolResultPart | zToolResultPart["output"],
		multiple?: boolean,
	): zFilePart[] => {
		if (!value) return [];
		if (!Array.isArray(value)) value = value.output;
		let file = value.filter((part) => part.type === "file");
		if (multiple && Array.isArray(file[0])) file = file.flat();
		return file as zFilePart[];
	},
} as const;
