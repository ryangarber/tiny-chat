import { createAfmize } from "@afmize/capacitor";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";

/** Apple Foundation Models through `@afmize/capacitor`, in the iOS app. */
export const AFMProvider = createAFMProvider(createAfmize());
