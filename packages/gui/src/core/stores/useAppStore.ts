import { create } from "zustand";

type DrawerType = "settings" | "account";

type ModalType =
	| "embedding-config"
	| "delete-account"
	| "edit-chat"
	| "edit-project"
	| "capabilities"
	| "uploads"
	| "memories"
	| "actions"
	| "console";

export type UploadsType = "attachment" | "github";

export type CapabilitiesType =
	| "tools:native"
	| "tools:mcp"
	| "skills:native"
	| "skills:local";

interface LayoutStore {
	isMobile: boolean;
	setMobile: (value: boolean) => void;

	sidebarWidth: number;
	setSidebarWidth: (value: number) => void;

	asideWidth: number;
	setAsideWidth: (value: number) => void;

	currentDrawer: DrawerType | null;
	setCurrentDrawer: (drawer: DrawerType | null) => void;

	currentModal: ModalType | null;
	setCurrentModal: (modal: ModalType | null) => void;

	currentUploads: UploadsType;
	setCurrentUploads: (upload: UploadsType) => void;

	currentCapabilities: CapabilitiesType;
	setCurrentCapabilities: (capability: CapabilitiesType) => void;

	/** The editor's config popover, with the model, tools and skills. */
	isConfigOpen: boolean;
	setConfigOpen: (value: boolean) => void;
}

export const useAppStore = create<LayoutStore>((set) => ({
	isMobile: false,
	setMobile: (isMobile) => set({ isMobile }),

	sidebarWidth: 300,
	setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),

	asideWidth: 300,
	setAsideWidth: (asideWidth) => set({ asideWidth }),

	currentDrawer: null,
	setCurrentDrawer: (currentDrawer) => set({ currentDrawer }),

	currentModal: null,
	setCurrentModal: (currentModal) => set({ currentModal }),

	currentUploads: "attachment",
	setCurrentUploads: (currentUploads) => set({ currentUploads }),

	currentCapabilities: "tools:native",
	setCurrentCapabilities: (currentCapabilities) => set({ currentCapabilities }),

	isConfigOpen: false,
	setConfigOpen: (isConfigOpen) => set({ isConfigOpen }),
}));
