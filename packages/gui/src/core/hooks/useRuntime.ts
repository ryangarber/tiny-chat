import { createContext, useContext } from "react";
import { runtime } from "#gui/client-runtime.ts";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";

/** The host the GUI runs in; see `ClientRuntime`. */
export const RuntimeContext = createContext<ClientRuntime>(runtime);

export const useRuntime = () => useContext(RuntimeContext);
