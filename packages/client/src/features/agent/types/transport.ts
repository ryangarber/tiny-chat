import type { Transport } from "@modelcontextprotocol/client";

export interface ClientTransports {
	createStdio?: (_: {
		name: string;
		command: string[];
		env?: Record<string, string>;
		/**
		 * Receives what the server writes to stderr, which is never passed
		 * through to the host's own: in a terminal it would tear the UI.
		 */
		onStderr?: (text: string) => void;
	}) => Transport;

	createStreamableHttp?: (_: {
		name: string;
		url: URL;
		headers?: Record<string, string>;
	}) => Transport;
}
