import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";
import type { RuntimeKeyboard } from "#gui/core/types/runtime.ts";

interface Keyboard {
	addListener(
		event: "change",
		listener: (keyboard: RuntimeKeyboard) => void,
	): Promise<PluginListenerHandle>;
}

const keyboard = registerPlugin<Keyboard>("keyboard");

/** The iOS app's `KeyboardPlugin`, which keeps the webview still under the keyboard. */
export const KeyboardService = {
	onKeyboard: (listener: (keyboard: RuntimeKeyboard) => void) => {
		const handle = keyboard.addListener("change", listener);
		return () => void handle.then((handle) => handle.remove());
	},
} as const;
