import type { Model } from "#core/core/services/PostgresService.ts";
import type { PartialBy } from "#core/core/types/common.ts";
import type {
	FileState,
	FilesystemSpec,
} from "#core/features/file/types/file.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import {
	type FileMount,
	PathUtils,
} from "#core/features/file/utils/PathUtils.ts";

export interface Descendent<T> {
	children: Map<string, Descendent<T>>;
	node?: T;
}

export const FileUtils = {
	toFileState: (
		{ embedding, ...file }: PartialBy<Model["File"], "embedding">,
		mount?: FileMount,
		root = PathUtils.mount,
	): FileState => {
		return {
			...file,
			uri: PathUtils.toMount({
				mount: mount ?? (file.chatId ? "chat" : "uploads"),
				id: file.chatId ?? file.uploadId,
				path: file.path,
				root,
			}),
		};
	},

	toFileStates: (
		files: PartialBy<Model["File"], "embedding">[],
		mount?: FileMount,
	) => {
		return files.map((file) => FileUtils.toFileState(file, mount));
	},

	/**
	 * The same mount with one more upload or skill in it.
	 *
	 * A mount is a list of ids, so anything the user can reach can be added to
	 * one on the spot — which is how an upload nothing points into yet can still
	 * be listed and walked into.
	 */
	mount: ({
		filesystem,
		mount,
		id,
	}: {
		filesystem: FilesystemSpec;
		mount?: FileMount;
		id?: string;
	}): FilesystemSpec => {
		const add = (ids: string[] | undefined, into: FileMount) =>
			mount === into && id ? [...new Set([...(ids ?? []), id])] : ids;

		return {
			...filesystem,
			uploads: add(filesystem.uploads, "uploads"),
			skills: add(filesystem.skills, "skills"),
		};
	},

	getBase64FromBytes: ({ data }: { data: Uint8Array | string }) => {
		if (typeof data !== "string") {
			const chunkSize = 65536;
			let binary = "";
			for (let i = 0; i < data.length; i += chunkSize) {
				const chunk = data.subarray(i, i + chunkSize);
				binary += String.fromCharCode(...chunk);
			}
			return btoa(binary);
		}
		return data;
	},

	getBufferFromBytes: ({ data }: { data: Uint8Array | string }) => {
		if (typeof data === "string") {
			const binary = atob(data);
			data = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				data[i] = binary.charCodeAt(i);
			}
		}
		return data;
	},

	getBase64FromText: ({ text }: { text: string }) => {
		const data = new TextEncoder().encode(text);
		return FileUtils.getBase64FromBytes({ data });
	},

	getTextFromBytes: ({
		data,
		mime,
	}: {
		data: Uint8Array | string;
		mime?: string;
	}) => {
		data = FileUtils.getBufferFromBytes({ data });

		// Decode the view rather than its buffer: a Node `Buffer` is usually a
		// window onto a shared pool, and decoding the pool yields whatever else
		// happens to be in it.
		if (mime) {
			const charset = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(mime)?.[1]?.trim();
			if (charset) {
				try {
					return new TextDecoder(charset, { fatal: true }).decode(data);
				} catch {
					// ignore
				}
			}
		}

		const bom = FileTypeUtils.getBom({ data });
		if (bom) {
			return new TextDecoder(bom.encoding).decode(data.subarray(bom.skip));
		}
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(data);
		} catch {
			// ignore
		}

		return null;
	},

	/**
	 * Build a hierarchical tree from a list of file-like objects.
	 */
	toTree: <T extends { path: string[] }>({ nodes }: { nodes: T[] }) => {
		const root: Descendent<T> = { children: new Map() };

		for (const node of nodes) {
			let descendent = root;
			for (let i = 0; i < node.path.length; i++) {
				const segment = node.path[i];
				if (!descendent.children.has(segment)) {
					descendent.children.set(segment, { children: new Map() });
				}
				descendent = descendent.children.get(segment) as Descendent<T>;
				if (i === node.path.length - 1) {
					descendent.node = node;
				}
			}
		}

		return root;
	},
} as const;
