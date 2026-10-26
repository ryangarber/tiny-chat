import type {
	ClientComputer,
	ClientShell,
	ClientTransports,
} from "#client/client.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";

export type RuntimePlatform =
	| "web"
	| "macos"
	| "windows"
	| "linux"
	| "ios"
	| "android";

export interface RuntimeUpdate {
	version: string;
	/** When it was released, if the host knows. */
	date?: string;
}

/**
 * Signing in through the system browser, which returns to the app by the URL
 * scheme it registers (`CommonUtils.nativeAuthCallbackUrl`).
 */
export interface RuntimeAuth {
	/**
	 * URLs the app is opened with, including the one it was launched with, if
	 * the listener is the first. Returns an unsubscribe.
	 */
	onUrl: (listener: (url: string) => void) => () => void;
}

export interface RuntimeKeyboard {
	/** How far the keyboard reaches up the page, in CSS pixels; 0 once it is away. */
	height: number;
	/** Seconds it takes to get there. */
	duration: number;
}

/**
 * What the app can do beyond a browser tab. The web's is
 * `#gui/client-runtime.ts`; each host app (`apps/desktop`, `apps/mobile`)
 * builds the GUI with its own module in that one's place, which is the web's
 * outside the host.
 */
export interface ClientRuntime {
	platform: RuntimePlatform;

	/** Opens a link outside the app. */
	open: (url: string) => Promise<void>;

	/**
	 * Signing in directly, where the host receives its URL scheme; otherwise
	 * the app borrows the web's sign-in by cloning its session.
	 */
	auth?: RuntimeAuth;

	/**
	 * Writes to the system clipboard, where the webview's own clipboard is
	 * missing or only works during a click, which a copy that waits on the
	 * server outlives.
	 */
	copy?: (_: { mime: string; data: Blob }) => Promise<void>;

	/** Asks the user for a folder; null if they cancel. */
	pickFolder?: (_: { defaultPath?: string }) => Promise<string | null>;

	/**
	 * The software keyboard, where the host leaves the page where it is under
	 * it, neither scrolling nor resizing it, so the page makes room itself.
	 * Returns an unsubscribe.
	 */
	onKeyboard?: (listener: (keyboard: RuntimeKeyboard) => void) => () => void;

	/** Native model providers, such as Apple Foundation Models. */
	getModelProviders?: () => Promise<ModelProvider<any>[]>;

	/** The device's shell and file system; only a desktop has them. */
	shell?: ClientShell;

	/** The apps on the computer, through xa11y; only a desktop has them. */
	computer?: ClientComputer;

	/** MCP transports for servers the webview cannot reach itself. */
	transports?: ClientTransports;

	/** Quits the app, where it is an app of its own rather than a tab. */
	quit?: () => Promise<void>;

	/** Updates to the app itself, where it updates itself. */
	update?: {
		check: () => Promise<RuntimeUpdate | null>;
		/** Downloads and applies it, then relaunches the app. */
		install: (_: { onProgress: (fraction: number) => void }) => Promise<void>;
	};
}
