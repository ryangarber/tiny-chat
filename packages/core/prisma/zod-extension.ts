import type { CodecTypes } from "prisma-orm-extension-zod/codec-types";
import {
	createZodExtension,
	defineZodSchema,
} from "prisma-orm-extension-zod/column-types";
import { zConfig } from "#core/features/data/types/message.ts";
import { zData, zMetadata } from "#core/features/data/types/part.ts";
import { zCache, zSettings } from "#core/features/data/types/user.ts";

const schemas = {
	zSettings: defineZodSchema(zSettings),
	zCache: defineZodSchema(zCache),
	zConfig: defineZodSchema(zConfig),
	zData: defineZodSchema(zData),
	zMetadata: defineZodSchema(zMetadata),
};
export type SchemaTypes = CodecTypes<typeof schemas>;

export const zod = createZodExtension(schemas, {
	module: "../../prisma/zod-extension.ts",
	export: "SchemaTypes",
});
