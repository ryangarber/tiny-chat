import type {
	BrowserCapability,
	ComputerCapability,
	TerminalCapability,
} from "#core/core/types/capability.ts";

/**
 * computah's surfaces as a host holds them: a browser, tmux, and the apps on
 * the computer. Only a host with Node's APIs can (the CLI, the desktop app's
 * main process, through `ComputahHostService`); a webview reaches them over
 * its host's RPC, through `ComputahRemoteService`.
 */
export interface ClientComputah {
	browser: BrowserCapability;
	terminal: TerminalCapability;
	computer: ComputerCapability;
}

export type ComputahSurface = keyof ClientComputah;

/** What a host carries for a remote caller: one method of one surface. */
export interface ComputahRequest {
	/** Names the call, so it can be aborted and report install progress. */
	id: string;
	surface: ComputahSurface;
	method: string;
	/** The method's argument, less its `abort` and `onProgress`. */
	input?: unknown;
}

/** Each surface's methods, as a remote caller may ask for them. */
export const COMPUTAH_METHODS = {
	browser: [
		"status",
		"install",
		"permissions",
		"requestPermissions",
		"run",
		"tabs",
		"readTab",
	],
	terminal: [
		"status",
		"install",
		"permissions",
		"requestPermissions",
		"run",
		"touchesForeign",
	],
	computer: [
		"status",
		"install",
		"permissions",
		"requestPermissions",
		"run",
		"windows",
	],
} as const satisfies {
	[S in ComputahSurface]: readonly (keyof ClientComputah[S])[];
};
