import { z } from "zod";
import { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";
import { ProjectLike } from "#core/features/data/types/chat.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import {
	zCommand,
	zFolder,
	zHiddenModels,
	zMCPServers,
	zTuiImages,
} from "#core/features/data/types/user.ts";
import { SettingsService } from "#server/features/user/services/SettingsService.ts";
import { procedure, router } from "#server/index.ts";

export const settings = router({
	get: procedure
		.input(
			z
				.object({
					project: ProjectLike.nullish(),
				})
				.default({}),
		)
		.query(async ({ ctx, input }) => {
			return await SettingsService.getSettings({
				user: ctx.session.user,
				project: input.project,
			});
		}),

	getRaw: procedure
		.input(
			z
				.object({
					project: ProjectLike.nullish(),
				})
				.default({}),
		)
		.query(async ({ ctx, input }): Promise<Record<string, unknown>> => {
			return (await SettingsService.getSettingsRaw({
				user: ctx.session.user,
				project: input.project,
			})) as Record<string, unknown>;
		}),

	setTheme: procedure
		.input(
			z.object({
				theme: z.enum(ThemeUtils.themes),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					theme: input.theme,
				}),
			});
		}),

	setCodeTheme: procedure
		.input(
			z.object({
				codeTheme: z.enum(ThemeUtils.codeThemes),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					codeTheme: input.codeTheme,
				}),
			});
		}),

	setTuiImages: procedure
		.input(
			z.object({
				tuiImages: zTuiImages,
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					tuiImages: input.tuiImages,
				}),
			});
		}),

	addInstruction: procedure
		.input(
			z.object({
				instruction: z.string(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					instructions: [...(settings.instructions ?? []), input.instruction],
				}),
			});
		}),

	updateInstruction: procedure
		.input(
			z.object({
				index: z.number(),
				instruction: z.string(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					instructions:
						settings.instructions?.map((v, i) =>
							i === input.index ? input.instruction : v,
						) ?? [],
				}),
			});
		}),

	removeInstruction: procedure
		.input(
			z.object({
				index: z.number(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					instructions:
						settings.instructions?.filter((_, i) => i !== input.index) ?? [],
				}),
			});
		}),

	addCommand: procedure
		.input(
			z.object({
				command: zCommand,
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					commands: [...(settings.commands ?? []), input.command],
				}),
			});
		}),

	updateCommand: procedure
		.input(
			z.object({
				index: z.number(),
				command: zCommand.partial(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					commands: [
						...(settings.commands ?? []).map((command, i) =>
							i === input.index ? { ...command, ...input.command } : command,
						),
					],
				}),
			});
		}),

	removeCommand: procedure
		.input(
			z.object({
				index: z.number(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					commands:
						settings.commands?.filter((_, i) => i !== input.index) ?? [],
				}),
			});
		}),

	addFolder: procedure
		.input(
			z.object({
				folder: zFolder,
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					folders: [...(settings.folders ?? []), input.folder],
				}),
			});
		}),

	updateFolder: procedure
		.input(
			z.object({
				index: z.number(),
				folder: zFolder.partial(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					folders:
						settings.folders?.map((folder, i) =>
							i === input.index ? { ...folder, ...input.folder } : folder,
						) ?? [],
				}),
			});
		}),

	/** Folders are tried in order, so the first that exists is where a shell starts. */
	moveFolder: procedure
		.input(
			z.object({
				index: z.number(),
				to: z.number(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => {
					const folders = [...(settings.folders ?? [])];
					const [folder] = folders.splice(input.index, 1);
					if (folder)
						folders.splice(
							Math.max(0, Math.min(input.to, folders.length)),
							0,
							folder,
						);
					return { ...settings, folders };
				},
			});
		}),

	removeFolder: procedure
		.input(
			z.object({
				index: z.number(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					folders: settings.folders?.filter((_, i) => i !== input.index) ?? [],
				}),
			});
		}),

	setMemoryBudget: procedure
		.input(
			z.object({
				tokens: z.number(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					memoryBudget: input.tokens,
				}),
			});
		}),

	setPreset: procedure
		.input(
			z.object({
				name: z.string().regex(/[A-Za-z0-9-_]+/),
				config: zConfig,
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					presets: {
						...settings.presets,
						[input.name]: input.config,
					},
				}),
			});
		}),

	unsetPreset: procedure
		.input(
			z.object({
				name: z.string().regex(/[A-Za-z0-9-_]+/),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => {
					const newPresets = { ...settings.presets };
					delete newPresets[input.name];
					return {
						...settings,
						presets: newPresets,
					};
				},
			});
		}),

	setHiddenModels: procedure
		.input(
			z.object({
				feature: zHiddenModels.keyType,
				models: zHiddenModels.valueType,
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => {
					settings.hiddenModels ??= { language: [], embedding: [] };
					settings.hiddenModels[input.feature] = input.models;
					return settings;
				},
			});
		}),

	setPreferredWebProvider: procedure
		.input(
			z.object({
				preferredWebProvider: z.string(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					preferredWebProvider: input.preferredWebProvider,
				}),
			});
		}),

	setEmbeddingConfig: procedure
		.input(
			z.object({ config: zConfig.nullish(), project: ProjectLike.nullish() }),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					embeddingConfig: input.config ?? undefined,
				}),
			});
		}),

	setUseEmbeddingSearch: procedure
		.input(
			z.object({
				useEmbeddingSearch: z.boolean(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					useEmbeddingSearch: input.useEmbeddingSearch,
				}),
			});
		}),

	setDreamConfig: procedure
		.input(
			z.object({ config: zConfig.nullish(), project: ProjectLike.nullish() }),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					dreamConfig: input.config ?? undefined,
				}),
			});
		}),

	setSubagentConfig: procedure
		.input(
			z.object({ config: zConfig.nullish(), project: ProjectLike.nullish() }),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					subagentConfig: input.config ?? undefined,
				}),
			});
		}),

	setProviderSetting: procedure
		.input(
			z.object({
				provider: z.string(),
				key: z.string(),
				value: z.string().nullish(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					providers: {
						...settings.providers,
						[input.provider]: {
							...settings.providers?.[input.provider],
							[input.key]: input.value ?? undefined,
						},
					},
				}),
			});
		}),

	setUseProviderCache: procedure
		.input(
			z.object({
				useProviderCache: z.boolean(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					useProviderCache: input.useProviderCache,
				}),
			});
		}),

	setUseBrowserModels: procedure
		.input(
			z.object({
				useBrowserModels: z.boolean(),
				project: ProjectLike.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					useBrowserModels: input.useBrowserModels,
				}),
			});
		}),

	setMcpServers: procedure
		.input(
			z.object({ mcpServers: zMCPServers, project: ProjectLike.nullish() }),
		)
		.mutation(async ({ ctx, input }) => {
			return SettingsService.setSettings({
				user: ctx.session.user,
				project: input.project,
				update: (settings) => ({
					...settings,
					mcpServers: input.mcpServers,
				}),
			});
		}),
});
