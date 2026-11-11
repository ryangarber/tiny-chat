import type { InstallProgress } from "computah/schema";
import {
	type ClientComputah,
	COMPUTAH_METHODS,
	type ComputahRequest,
	type ComputahSurface,
} from "#client/features/agent/types/computah.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

/**
 * computah's surfaces for a runtime that cannot hold them, as the desktop
 * app's webview cannot: every method is carried to a host that does
 * (`ComputahHostService.serve`). Only `abort` and `onProgress` cannot travel,
 * so an abort is sent after the call, and progress comes back by its id.
 */
export const ComputahRemoteService = {
	create: ({
		call,
		abort,
	}: {
		call: (request: ComputahRequest) => Promise<unknown>;
		abort: (_: { id: string }) => Promise<void>;
	}) => {
		const listeners = new Map<string, (progress: InstallProgress) => void>();

		const method =
			(surface: ComputahSurface, name: string) =>
			async (
				input: {
					abort?: AbortSignal;
					onProgress?: (progress: InstallProgress) => void;
				} & Record<string, unknown> = {},
			) => {
				const { abort: signal, onProgress, ...rest } = input;
				signal?.throwIfAborted();
				const id = CommonUtils.getRandomId();
				const onAbort = () => void abort({ id }).catch(() => {});
				signal?.addEventListener("abort", onAbort, { once: true });
				if (onProgress) listeners.set(id, onProgress);
				try {
					return await call({ id, surface, method: name, input: rest });
				} finally {
					signal?.removeEventListener("abort", onAbort);
					listeners.delete(id);
				}
			};

		const computah = Object.fromEntries(
			Object.entries(COMPUTAH_METHODS).map(([surface, names]) => [
				surface,
				Object.fromEntries(
					names.map((name) => [name, method(surface as ComputahSurface, name)]),
				),
			]),
		) as unknown as ClientComputah;

		return {
			computah,
			/** Install progress the host sent back, for the call it belongs to. */
			progress: ({ id, progress }: { id: string; progress: InstallProgress }) =>
				listeners.get(id)?.(progress),
		};
	},
} as const;
