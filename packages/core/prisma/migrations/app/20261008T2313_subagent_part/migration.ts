#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/794cd63c8f9430acff5e147894ce7bc9cb6db546bb446062743b4a43194a967f/contract';
import endContract from '../../snapshots/794cd63c8f9430acff5e147894ce7bc9cb6db546bb446062743b4a43194a967f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/adc1189487a89874a3397507d2e94da3d98df2ffcd60b8979aa3c65d44b3c170/contract';
import startContract from '../../snapshots/adc1189487a89874a3397507d2e94da3d98df2ffcd60b8979aa3c65d44b3c170/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, placeholder } from '@prisma/orm-postgres/migration';
import postgres from '@prisma/orm-postgres/runtime';
import paradedb from '@prisma/orm-extension-paradedb/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import {zod} from '../../../zod-extension.ts';

const db = postgres<End>({ contractJson: endContract, extensions: [paradedb, pgvector, zod.runtime] });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'subagent',
        column: col('partId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(db.contract, 'ensure-no-subagents', {
        check: () => db.sql.public.subagent.select().limit(1),
        run: () => db.sql.public.subagent.delete(),
      }),
      this.setNotNull({ schema: 'public', table: 'subagent', column: 'partId' }),
      this.createIndex({
        schema: 'public',
        table: 'subagent',
        index: 'subagent_partId_key',
        columns: ['partId'],
        extras: { unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
