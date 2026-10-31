import type { Model } from "#core/core/services/PostgresService.ts";

export type ActionState = Omit<Model["Action"], "embedding"> & {
	chatId: string;
} & {
	nextRunAt: Temporal.PlainDateTime | null;
};
