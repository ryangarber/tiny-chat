#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from "@prisma/orm-postgres/migration";
import type { Contract as End } from "../../snapshots/41b79ce5f295f686b6ba210c993e88557414e0ce28e57ffcc5f660697beb9e67/contract";
import endContract from "../../snapshots/41b79ce5f295f686b6ba210c993e88557414e0ce28e57ffcc5f660697beb9e67/contract.json" with {
	type: "json",
};
import type { Contract as Start } from "../../snapshots/d67b0152664f00b981ed6c555a078a08b0f770342c40e0fe6d0f9adc25cf490f/contract";
import startContract from "../../snapshots/d67b0152664f00b981ed6c555a078a08b0f770342c40e0fe6d0f9adc25cf490f/contract.json" with {
	type: "json",
};

export default class M extends Migration<Start, End> {
	override readonly startContractJson = startContract;
	override readonly endContractJson = endContract;

	override get operations() {
		return [
			this.addColumn({
				schema: "public",
				table: "file",
				column: col("updatedAt", "timestamp(3)", {
					codecRef: {
						codecId: "pg/timestamp-temporal@1",
						typeParams: { precision: 3 },
					},
				}),
			}),
			this.addColumn({
				schema: "public",
				table: "memory",
				column: col("updatedAt", "timestamp(3)", {
					codecRef: {
						codecId: "pg/timestamp-temporal@1",
						typeParams: { precision: 3 },
					},
				}),
			}),
			this.createIndex({
				schema: "public",
				table: "message",
				index: "message_search_idx",
				expression:
					"\"id\", (COALESCE(try_extract_text(\"data\"), '')::pdb.simple('alias=text'))",
				extras: {
					type: "paradedb",
					options: {
						key_field: "id",
					},
				},
			}),
			this.dropColumn({
				schema: "public",
				table: "message",
				column: "lexicon",
			}),
			this.createIndex({
				schema: "public",
				table: "action",
				index: "action_search_idx",
				expression:
					"\"id\", (COALESCE(try_extract_text(\"data\"), '')::pdb.simple('alias=text'))",
				extras: {
					type: "paradedb",
					options: {
						key_field: "id",
					},
				},
			}),
			this.dropColumn({
				schema: "public",
				table: "action",
				column: "lexicon",
			}),
			this.createIndex({
				schema: "public",
				table: "memory",
				index: "memory_search_idx",
				expression:
					'"id", "evidence", (COALESCE("fact", \'\')::pdb.simple(\'alias=text\'))',
				extras: {
					type: "paradedb",
					options: {
						key_field: "id",
					},
				},
			}),
			this.dropColumn({
				schema: "public",
				table: "action",
				column: "lexicon",
			}),
			this.createIndex({
				schema: "public",
				table: "file",
				index: "file_search_idx",
				expression:
					'"id", "path", (COALESCE(try_decode_utf8("data"), \'\')::pdb.simple(\'alias=text\'))',
				extras: {
					type: "paradedb",
					options: {
						key_field: "id",
					},
				},
			}),
			this.dropColumn({
				schema: "public",
				table: "file",
				column: "lexicon",
			}),
		];
	}
}

MigrationCLI.run(import.meta.url, M);
