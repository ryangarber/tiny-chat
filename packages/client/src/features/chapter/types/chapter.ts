/**
 * A place in a chat that can be gone to: something the user said, or a tool
 * call that is still going — running with its output streaming, as a dev
 * server started in the background does until it exits, or waiting on the
 * user to approve or answer it.
 */
export type Chapter = {
	/** Unique among a chat's chapters. */
	key: string;
	/** The message it is, or is in. */
	messageId: string;
	/** Where that message is in the chat's selected branch. */
	index: number;
	label: string;
} & (
	| { type: "message" }
	| {
			type: "toolCall";
			/** The tool call's id. */
			id: string;
			state: "running" | "feedback";
	  }
);
