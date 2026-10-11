import type { PromiseOrValue } from "#core/core/types/common.ts";

/** A model afmize serves. */
export type AFMModel = "on-device" | "private-cloud-compute";

/** What afmize takes to start a stream, as JSON. */
export interface AFMRequest {
	model: AFMModel;
	temperature?: number;
	maximumResponseTokens?: number;
	reasoningLevel?: "light" | "moderate" | "deep";
	toolChoice?: string;
	tools?: { name: string; description?: string; inputSchema: unknown }[];
	messages: { role: string; parts: unknown[] }[];
}

/** One event of a stream, as afmize writes it. */
export type AFMEvent =
	| { type: "stream-start" }
	| { type: "reasoning-delta"; id: string; delta: string }
	| { type: "text-delta"; id: string; delta: string }
	| { type: "file"; mediaType: string; data: string }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	| { type: "error"; code: string; message: string }
	| {
			type: "finish";
			finishReason: string;
			usage?: {
				inputTokens: number;
				cachedInputTokens: number;
				outputTokens: number;
				reasoningTokens: number;
			};
	  };

/**
 * How a host reaches afmize — through a native plugin or helper in the apps, or
 * through FFI in the CLI. Each call mirrors one `afmize_*` function.
 */
export interface AFMBridge {
	/** afmize's availability report, as the JSON string it writes. */
	availability: () => PromiseOrValue<string>;
	/**
	 * Starts a stream, returning its id. Events arrive in order; after the
	 * `finish` event (which still arrives on cancel), no more do.
	 */
	stream: (
		request: AFMRequest,
		onEvent: (event: AFMEvent) => void,
	) => PromiseOrValue<number>;
	cancel: (id: number) => PromiseOrValue<void>;
}
