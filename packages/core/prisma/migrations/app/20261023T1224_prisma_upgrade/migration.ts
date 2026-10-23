#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/308cff4a25d99fec950f55c3607e3204a27cdd0a417d49488270c666310721de/contract';
import endContract from '../../snapshots/308cff4a25d99fec950f55c3607e3204a27cdd0a417d49488270c666310721de/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ae17d2661aaf6704966ba519fccf927ab835fb8b7865a722f25263d350514897/contract';
import startContract from '../../snapshots/ae17d2661aaf6704966ba519fccf927ab835fb8b7865a722f25263d350514897/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addCheckConstraint({
        schema: 'public',
        table: 'file',
        constraint: 'file_path_elem_not_null_afae3f60',
        expression: sql`array_position("path", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'memory',
        constraint: 'memory_evidence_elem_not_null_baca93e3',
        expression: sql`array_position("evidence", NULL) IS NULL`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
