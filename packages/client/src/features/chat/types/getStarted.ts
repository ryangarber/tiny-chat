import type { ProjectRef } from "#client/features/chat/types/activeChat.ts";

/** Where a get-started link goes. */
export type GetStartedTarget =
	| { type: "chat"; id: string }
	/** A new chat in the project. */
	| { type: "project"; project: ProjectRef };

export interface GetStartedLink {
	label: string;
	description?: string;
	target: GetStartedTarget;
}

/**
 * A renderer-agnostic piece of the new chat page. Runtimes (app, CLI) know how
 * to draw each of these, the way they draw a `ToolBlock`, so a new widget
 * needs no UI code of its own.
 */
export type GetStartedBlock = { type: "links"; links: GetStartedLink[] };

/** One thing the new chat page offers: a title over its blocks. */
export interface GetStartedWidget {
	id: string;
	title: string;
	blocks: GetStartedBlock[];
}
