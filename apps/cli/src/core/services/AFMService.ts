import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import library from "#cli/core/services/AFMLibrary.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";
import type { AFMBridge, AFMEvent } from "#core/features/provider/types/afm.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";

/**
 * The embedded library's path: absolute in a compiled binary (its own virtual
 * file system), relative to the bundle in `dist/`.
 */
const resolve = (library: string) =>
	isAbsolute(library)
		? library
		: fileURLToPath(new URL(library, import.meta.url));

let provider: Promise<ModelProvider<any> | null> | undefined;

export const AFMService = {
	/**
	 * afmize's C ABI from its dynamic library at `path`, through Bun's FFI
	 * (the CLI's and the desktop app's main process both run on Bun). Throws on a
	 * macOS too old for FoundationModels, or a library missing its symbols.
	 */
	open: async (path: string): Promise<AFMBridge> => {
		const { CString, dlopen, FFIType, JSCallback } = await import("bun:ffi");

		const { symbols } = dlopen(path, {
			afmize_availability: { args: [], returns: FFIType.pointer },
			afmize_string_free: { args: [FFIType.pointer], returns: FFIType.void },
			afmize_stream_start: {
				args: [FFIType.cstring, FFIType.pointer, FFIType.function],
				returns: FFIType.i64,
			},
			afmize_stream_cancel: { args: [FFIType.i64], returns: FFIType.void },
		});

		// afmize hands each stream's context back with its events; here that is
		// a key to the listener, rather than a pointer to anything.
		const listeners = new Map<number, (event: AFMEvent) => void>();
		let next = 1;

		// Events arrive from afmize's own threads. Each string is ours to free,
		// and NULL follows the last.
		const onEvent = new JSCallback(
			(context: number, pointer: number | null) => {
				if (!pointer) {
					listeners.delete(context);
					return;
				}
				const json = new CString(pointer as never).toString();
				symbols.afmize_string_free(pointer as never);
				listeners.get(context)?.(JSON.parse(json));
			},
			{
				args: [FFIType.pointer, FFIType.pointer],
				returns: FFIType.void,
				threadsafe: true,
			},
		);

		return {
			availability: () => {
				const pointer = symbols.afmize_availability();
				if (!pointer) return "{}";
				const json = new CString(pointer).toString();
				symbols.afmize_string_free(pointer);
				return json;
			},
			stream: (request, listener) => {
				const context = next++;
				listeners.set(context, listener);
				const id = Number(
					symbols.afmize_stream_start(
						Buffer.from(`${JSON.stringify(request)}\0`),
						context as never,
						onEvent.ptr,
					),
				);
				// Rejected outright, so no events, and no NULL, will follow.
				if (id < 0) listeners.delete(context);
				return id;
			},
			cancel: (id) => {
				symbols.afmize_stream_cancel(id);
			},
		};
	},

	/**
	 * Apple Foundation Models, if afmize was built into the CLI and loads here.
	 */
	getProvider: (): Promise<ModelProvider<any> | null> =>
		(provider ??= (async () => {
			if (!library || process.platform !== "darwin" || !process.versions.bun)
				return null;

			// Fails on a macOS too old for FoundationModels (or the symbols afmize
			// was built against), which only leaves AFM out.
			try {
				return createAFMProvider(await AFMService.open(resolve(library)));
			} catch (error) {
				// Outside development, stderr would draw over the UI.
				if (CommonUtils.isTruthy(process.env.DEV))
					console.warn("[AFMService] failed to load afmize", error);
				return null;
			}
		})()),
} as const;
