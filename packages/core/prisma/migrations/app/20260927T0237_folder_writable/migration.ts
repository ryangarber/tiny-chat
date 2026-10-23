#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8a4302a2176d4a88b72dc07c1f206da319dcb403e4df6e11d85e343fe4d38dcf/contract';
import endContract from '../../snapshots/8a4302a2176d4a88b72dc07c1f206da319dcb403e4df6e11d85e343fe4d38dcf/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ce2bfe4a7aeb65235e15c0e74606b5080c31a0e0c24193f16d6f12272a2d46a8/contract';
import startContract from '../../snapshots/ce2bfe4a7aeb65235e15c0e74606b5080c31a0e0c24193f16d6f12272a2d46a8/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'folder',
        column: col('cwdWritable', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
