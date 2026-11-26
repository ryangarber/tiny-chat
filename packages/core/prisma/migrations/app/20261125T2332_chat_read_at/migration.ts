#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/308cff4a25d99fec950f55c3607e3204a27cdd0a417d49488270c666310721de/contract';
import startContract from '../../snapshots/308cff4a25d99fec950f55c3607e3204a27cdd0a417d49488270c666310721de/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fc38c12f519691b04f842e7ec53874864fa8a67f54d4d42d3850e6cf2fc0f90c/contract';
import endContract from '../../snapshots/fc38c12f519691b04f842e7ec53874864fa8a67f54d4d42d3850e6cf2fc0f90c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'chat',
        column: col('readAt', 'timestamp(3)', {
          notNull: true,
          default: fn(sql`now()`),
          codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
