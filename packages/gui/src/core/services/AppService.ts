import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import {
	type CapabilitiesType,
	type UploadsType,
	useAppStore,
} from "#gui/core/stores/useAppStore.ts";

export const AppService = {
	breakpoint: "48em",

	get isMobile() {
		return window.matchMedia(`(max-width: ${AppService.breakpoint})`).matches;
	},

	initialize: () => {
		const listener = () => {
			const { setMobile } = useAppStore.getState();
			setMobile(AppService.isMobile);
		};
		listener();
		window.addEventListener("resize", listener);
		return () => window.removeEventListener("resize", listener);
	},

	closeSidebar: () => {
		const { currentModal, currentDrawer, setCurrentDrawer } =
			useAppStore.getState();
		const { panels, setPanel } = useLayoutStore.getState();

		if (!currentModal) {
			if (currentDrawer) {
				setCurrentDrawer(null);
				return true;
			}

			if (panels.chats) {
				setPanel("chats", false);
				return true;
			}
		}

		return false;
	},

	closeAside: () => {
		const { currentModal } = useAppStore.getState();
		const { setPanel } = useLayoutStore.getState();

		if (!currentModal) {
			setPanel("files", false);
			return true;
		}

		return false;
	},

	openSidebar: () => {
		const { setPanel } = useLayoutStore.getState();

		setPanel("chats", true);
		return true;
	},

	openSettings: () => {
		const { setCurrentDrawer } = useAppStore.getState();

		setCurrentDrawer("settings");
		return true;
	},

	openUploads: (uploads?: UploadsType) => {
		const { setCurrentModal, setCurrentUploads } = useAppStore.getState();

		setCurrentModal("uploads");
		if (uploads) setCurrentUploads(uploads);
		return true;
	},

	openCapabilities: (capabilities?: CapabilitiesType) => {
		const { setCurrentModal, setCurrentCapabilities } = useAppStore.getState();

		setCurrentModal("capabilities");
		if (capabilities) setCurrentCapabilities(capabilities);
		return true;
	},

	openAccount: () => {
		const { setCurrentDrawer } = useAppStore.getState();

		setCurrentDrawer("account");
		return true;
	},

	openConfig: () => {
		const { setConfigOpen } = useAppStore.getState();

		setConfigOpen(true);
		return true;
	},

	/** Opens the memories, scrolled to the one with `id` if given. */
	openMemories: (id?: string) => {
		const { setCurrentModal } = useAppStore.getState();

		useLayoutStore.getState().setRecord(id ?? null);
		setCurrentModal("memories");
		return true;
	},

	/** Opens the actions, scrolled to the one with `id` if given. */
	openActions: (id?: string) => {
		const { setCurrentModal } = useAppStore.getState();

		useLayoutStore.getState().setRecord(id ?? null);
		setCurrentModal("actions");
		return true;
	},

	openConsole: () => {
		const { setCurrentModal } = useAppStore.getState();

		setCurrentModal("console");
		return true;
	},
} as const;
