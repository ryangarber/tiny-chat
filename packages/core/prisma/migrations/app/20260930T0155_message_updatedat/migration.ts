#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/8a4302a2176d4a88b72dc07c1f206da319dcb403e4df6e11d85e343fe4d38dcf/contract';
import startContract from '../../snapshots/8a4302a2176d4a88b72dc07c1f206da319dcb403e4df6e11d85e343fe4d38dcf/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/84b5918e023dffb54fcac2df00357bb7cb3b4ea588fdf3a475021b75c80bb044/contract';
import endContract from '../../snapshots/84b5918e023dffb54fcac2df00357bb7cb3b4ea588fdf3a475021b75c80bb044/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('updatedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
