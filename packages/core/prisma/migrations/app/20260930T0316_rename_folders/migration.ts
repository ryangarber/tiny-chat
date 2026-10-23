#!/usr/bin/env -S node
import {
	Migration,
	MigrationCLI,
	rawSql,
} from "@prisma/orm-postgres/migration";
import type { Contract as Start } from "../../snapshots/38a3fd02901cd86b75194b3408117233bc10b6d6f29ac7427298e19f50e6b9dd/contract";
import startContract from "../../snapshots/38a3fd02901cd86b75194b3408117233bc10b6d6f29ac7427298e19f50e6b9dd/contract.json" with {
	type: "json",
};
import type { Contract as End } from "../../snapshots/76bf7cddb83775240a8aee39bb637997b2d183a87894c0b31ee7f48fb69b4de5/contract";
import endContract from "../../snapshots/76bf7cddb83775240a8aee39bb637997b2d183a87894c0b31ee7f48fb69b4de5/contract.json" with {
	type: "json",
};

function check(
	description: string,
	sql: string,
	params: readonly (string | null)[],
) {
	return { description, sql, params };
}

// Check complete states so the runner's idempotency probe only skips a fully
// completed rename. Mixed states and destination-name collisions fail closed.
function checks(renamed: boolean) {
	const table = renamed ? "project" : "folder";
	const otherTable = renamed ? "folder" : "project";
	const column = renamed ? "projectId" : "folderId";
	const otherColumn = renamed ? "folderId" : "projectId";
	const constraints = [
		{
			table,
			name: `${table}_pkey`,
			other: `${otherTable}_pkey`,
			column: "id",
			kind: "p",
			referencedTable: null,
			onDelete: null,
		},
		{
			table,
			name: `${table}_userId_fkey`,
			other: `${otherTable}_userId_fkey`,
			column: "userId",
			kind: "f",
			referencedTable: "user",
			onDelete: "c",
		},
		{
			table: "chat",
			name: `chat_${column}_fkey`,
			other: `chat_${otherColumn}_fkey`,
			column,
			kind: "f",
			referencedTable: table,
			onDelete: "n",
		},
	];
	const indexes = [
		{
			table,
			name: `${table}_userId_idx`,
			other: `${otherTable}_userId_idx`,
			column: "userId",
		},
		{
			table: "chat",
			name: `chat_${column}_idx`,
			other: `chat_${otherColumn}_idx`,
			column,
		},
	];

	return [
		check(
			`ensure public.${table} is a table and public.${otherTable} is absent`,
			`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_type t ON t.oid = c.reltype AND t.typrelid = c.oid
        WHERE c.oid = pg_catalog.to_regclass($1) AND c.relkind = 'r'
      ) AND pg_catalog.to_regclass($2) IS NULL AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = $3
      ) AS result`,
			[`public.${table}`, `public.${otherTable}`, otherTable],
		),
		check(
			`ensure chat.${column} is nullable text and chat.${otherColumn} is absent`,
			`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = pg_catalog.to_regclass('public.chat')
          AND a.attname = $1 AND NOT a.attisdropped AND a.attnum > 0
          AND a.atttypid = 'pg_catalog.text'::regtype AND NOT a.attnotnull
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = pg_catalog.to_regclass('public.chat')
          AND a.attname = $2 AND NOT a.attisdropped AND a.attnum > 0
      ) AS result`,
			[column, otherColumn],
		),
		...constraints.map((constraint) =>
			check(
				`ensure ${constraint.name} has the expected definition and ${constraint.other} is absent`,
				`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid
          AND a.attname = $4 AND NOT a.attisdropped
        WHERE c.conrelid = pg_catalog.to_regclass($1) AND c.conname = $2
          AND c.contype = $5 AND c.conkey = ARRAY[a.attnum]
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND ($5 = 'p' OR (
            c.confrelid = pg_catalog.to_regclass($6)
            AND c.confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
              WHERE attrelid = c.confrelid AND attname = 'id' AND NOT attisdropped)]
            AND c.confdeltype = $7 AND c.confupdtype = 'c' AND c.confmatchtype = 's'
          ))
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = pg_catalog.to_regclass($1) AND conname = $3
      ) AS result`,
				[
					`public.${constraint.table}`,
					constraint.name,
					constraint.other,
					constraint.column,
					constraint.kind,
					constraint.referencedTable === null
						? null
						: `public.${constraint.referencedTable}`,
					constraint.onDelete,
				],
			),
		),
		// Index names share the schema-wide relation namespace. Check ownership and
		// definition as well as names; an unrelated index must never be renamed.
		...indexes.map((index) =>
			check(
				`ensure ${index.name} is the expected index and ${index.other} is absent`,
				`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid = c.relam
        JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid
          AND a.attname = $3 AND NOT a.attisdropped
        WHERE i.indexrelid = pg_catalog.to_regclass($1)
          AND i.indrelid = pg_catalog.to_regclass($2)
          AND c.relkind = 'i' AND am.amname = 'btree'
          AND i.indisvalid AND i.indisready AND i.indislive
          AND NOT i.indisunique AND i.indnatts = 1 AND i.indnkeyatts = 1
          AND i.indkey[0] = a.attnum AND i.indexprs IS NULL AND i.indpred IS NULL
      ) AND pg_catalog.to_regclass($4) IS NULL AS result`,
				[
					`public."${index.name}"`,
					`public.${index.table}`,
					index.column,
					`public."${index.other}"`,
				],
			),
		),
		// RENAME CONSTRAINT also renames the primary key's backing index.
		check(
			`ensure ${table}_pkey owns its primary index and ${otherTable}_pkey is absent`,
			`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid
        WHERE c.conrelid = pg_catalog.to_regclass($1) AND c.conname = $2
          AND c.contype = 'p' AND c.conindid = pg_catalog.to_regclass($3)
          AND i.indrelid = c.conrelid AND i.indisprimary AND i.indisvalid
      ) AND pg_catalog.to_regclass($4) IS NULL AS result`,
			[
				`public.${table}`,
				`${table}_pkey`,
				`public.${table}_pkey`,
				`public.${otherTable}_pkey`,
			],
		),
	];
}

// Recheck after taking DDL locks to close the gap between precheck and execute.
// All parameters below are migration-owned constants, never external input.
function lockedPrecheck() {
	const assertions = checks(false).map((step) => {
		const sql = step.sql.replace(/\$(\d+)/g, (_, index: string) => {
			const value = step.params[Number(index) - 1];
			return value == null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
		});
		return `IF (${sql}) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Folder rename precheck failed: ${step.description}';
    END IF;`;
	});
	return `DO $rename$ BEGIN ${assertions.join("\n")} END $rename$`;
}

export default class M extends Migration<Start, End> {
	override readonly startContractJson = startContract;
	override readonly endContractJson = endContract;

	override get operations() {
		return [
			// PostgreSQL preserves table/index/constraint OIDs and column attnums,
			// including all rows and FK links. The migration runner wraps these steps
			// and checks in its transaction, rolling everything back on failure.
			rawSql({
				id: "table.public.folder.rename-project",
				label: "Rename folder to project and preserve all data and references",
				operationClass: "widening",
				target: {
					id: "postgres",
					details: { schema: "public", objectType: "table", name: "project" },
				},
				precheck: checks(false),
				execute: [
					{
						description:
							"lock chat and folder for the duration of the migration",
						sql: 'LOCK TABLE "public"."chat", "public"."folder" IN ACCESS EXCLUSIVE MODE',
					},
					{
						description: "revalidate the source state under DDL locks",
						sql: lockedPrecheck(),
					},
					{
						description: "rename folder table",
						sql: 'ALTER TABLE "public"."folder" RENAME TO "project"',
					},
					{
						description: "rename chat folder reference column",
						sql: 'ALTER TABLE "public"."chat" RENAME COLUMN "folderId" TO "projectId"',
					},
					{
						description: "rename project primary key and its index",
						sql: 'ALTER TABLE "public"."project" RENAME CONSTRAINT "folder_pkey" TO "project_pkey"',
					},
					{
						description: "rename project user foreign key",
						sql: 'ALTER TABLE "public"."project" RENAME CONSTRAINT "folder_userId_fkey" TO "project_userId_fkey"',
					},
					{
						description: "rename chat project foreign key",
						sql: 'ALTER TABLE "public"."chat" RENAME CONSTRAINT "chat_folderId_fkey" TO "chat_projectId_fkey"',
					},
					{
						description: "rename project user index",
						sql: 'ALTER INDEX "public"."folder_userId_idx" RENAME TO "project_userId_idx"',
					},
					{
						description: "rename chat project index",
						sql: 'ALTER INDEX "public"."chat_folderId_idx" RENAME TO "chat_projectId_idx"',
					},
				],
				postcheck: checks(true),
			}),
		];
	}
}

MigrationCLI.run(import.meta.url, M);
