import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";
import type { AFMEvent } from "#core/features/provider/types/afm.ts";

interface Afmize {
	availability(): Promise<{ json: string }>;
	stream(options: { key: number; request: string }): Promise<{ id: number }>;
	cancel(options: { id: number }): Promise<void>;
	addListener(
		event: "event",
		listener: (data: { key: number; event: string }) => void,
	): Promise<PluginListenerHandle>;
}

const afmize = registerPlugin<Afmize>("afmize");

// One listener for every stream, dispatching by the key each stream was
// started with; `finish` is always last.
const listeners = new Map<number, (event: AFMEvent) => void>();
let next = 1;
const subscribed = afmize.addListener("event", ({ key, event }) => {
	const parsed = JSON.parse(event) as AFMEvent;
	listeners.get(key)?.(parsed);
	if (parsed.type === "finish") listeners.delete(key);
});

/** afmize through the Capacitor plugin in the iOS app. */
export const AFMProvider = createAFMProvider({
	availability: async () => (await afmize.availability()).json,
	stream: async (request, onEvent) => {
		await subscribed;
		const key = next++;
		listeners.set(key, onEvent);
		try {
			const { id } = await afmize.stream({
				key,
				request: JSON.stringify(request),
			});
			return id;
		} catch (error) {
			listeners.delete(key);
			throw error;
		}
	},
	cancel: async (id) => {
		await afmize.cancel({ id });
	},
});
