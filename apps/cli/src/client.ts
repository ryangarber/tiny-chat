import { AFMService } from "#cli/core/services/AFMService.ts";
import { StorageService } from "#cli/core/services/StorageService.ts";
import { TokenService } from "#cli/core/services/TokenService.ts";
import { createClient } from "#client/client.ts";
import { ComputerHostService } from "#client/features/agent/services/ComputerHostService.ts";
import { NodeTransportService } from "#client/features/agent/services/NodeTransportService.ts";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import type { CodeWorker } from "#core/core/utils/CodeUtils.ts";
import type { ProviderState } from "#core/features/provider/types/provider.ts";
import { EditorInputService } from "#tui/features/editor/services/EditorInputService.ts";

export const client = createClient({
	env: {
		VITE_SERVER_URL: String(process.env.VITE_SERVER_URL),
		VITE_SERVER_PORT: String(process.env.VITE_SERVER_PORT),
		VITE_WEB_URL: String(process.env.VITE_WEB_URL),
		VITE_WEB_PORT: String(process.env.VITE_WEB_PORT),
		DEV: String(process.env.DEV),
		DEV_HOST: String(process.env.DEV_HOST),
		DEV_ENV: String(process.env.DEV_ENV),
	},
	getToken: () => TokenService.get(),
	setToken: (token) => TokenService.set(token),
	getStorage: (key) => StorageService.get(key),
	setStorage: (key, value) => StorageService.set(key, value),
	highlighter: () => {
		// Bun's Web Worker (the CLI is typed against Node, not Bun)
		const { Worker } = globalThis as unknown as {
			Worker: new (url: URL) => CodeWorker & { unref: () => void };
		};
		// built beside the bundle (`scripts/compile.ts`); `import.meta.url` is
		// the bundle's, in `dist/` and in a compiled binary alike
		const worker = new Worker(new URL("./highlight.js", import.meta.url));
		// an idle highlighter shouldn't keep the CLI from exiting
		worker.unref();
		return worker;
	},
	transports: NodeTransportService.create(),
	providers: {
		getModelProviders: async () => {
			const afm = await AFMService.getProvider();
			return afm ? [afm] : [];
		},
		getProviderStates: async ({ user }) => {
			const afm = await AFMService.getProvider();
			if (!afm) return [];
			return [
				{ ...afm, status: await afm.getStatus({ user }) },
			] satisfies ProviderState<any>[];
		},
	},
	input: EditorInputService,
	shell: NodeShellService.create(),
	computer: ComputerHostService.create(),
	desktop: true,
});
