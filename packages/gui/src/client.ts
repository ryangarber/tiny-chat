import { createClient } from "#client/client.ts";
import HighlightWorker from "#core/core/services/HighlightWorker.ts?worker";
import type { zUser } from "#core/features/data/types/user.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import { runtime } from "#gui/client-runtime.ts";
import { useEditorStore } from "#gui/features/editor/stores/useEditorStore.ts";
import { EditorUtils } from "#gui/features/editor/utils/EditorUtils.ts";

async function getModelProviders({
	user,
}: {
	user: zUser;
}): Promise<ModelProvider<any>[]> {
	return [
		...(user.settings.useBrowserModels
			? [(await import("#gui/core/services/WebLLMProvider.ts")).WebLLMProvider]
			: []),
		...((await runtime.getModelProviders?.()) ?? []),
	];
}

export const client = createClient({
	env: {
		VITE_SERVER_URL: String(import.meta.env.VITE_SERVER_URL),
		VITE_SERVER_PORT: String(import.meta.env.VITE_SERVER_PORT),
		VITE_WEB_URL: String(import.meta.env.VITE_WEB_URL),
		VITE_WEB_PORT: String(import.meta.env.VITE_WEB_PORT),
		DEV: String(import.meta.env.DEV),
		DEV_HOST: String(import.meta.env.DEV_HOST),
		DEV_ENV: String(import.meta.env.DEV_ENV),
	},
	getToken: () => localStorage.getItem("token"),
	setToken: (token) => localStorage.setItem("token", token ?? ""),
	getStorage: (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
	setStorage: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
	highlighter: () => new HighlightWorker({ name: "highlight" }),
	providers: {
		getModelProviders,
		getProviderStates: async ({ user }) => {
			return await Promise.all(
				(await getModelProviders({ user })).map(async (provider) => ({
					...provider,
					status: await provider.getStatus({ user }),
				})),
			);
		},
	},
	input: {
		getData: () => {
			const { editor } = useEditorStore.getState();
			if (!editor) return [];

			return EditorUtils.getData(editor);
		},
		getText: () =>
			useEditorStore.getState().editor?.getText({ blockSeparator: "\n" }) ?? "",
		setData: ({ data }) => {
			const { editor } = useEditorStore.getState();
			if (!editor) return;

			EditorUtils.setData(editor, data);
		},
		insertNode: ({ node }) => {
			EditorUtils.insertNode(node);
		},
	},
	shell: runtime.shell,
	transports: runtime.transports,
	desktop: !!runtime.shell,
});
