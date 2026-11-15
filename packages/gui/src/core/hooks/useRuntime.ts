import { createContext, useContext } from "react";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";
import { RuntimeUtils } from "#gui/core/utils/RuntimeUtils.ts";

/**
 * The host the GUI runs in, as `mount` was given it; see `ClientRuntime`.
 * Outside it, as in a test, a browser tab's.
 */
export const RuntimeContext = createContext<ClientRuntime>(RuntimeUtils.web);

export const useRuntime = () => useContext(RuntimeContext);
