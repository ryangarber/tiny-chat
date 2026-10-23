#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/98bfe2e052f4a127a52e8868277e8ef7d69eb08a4e75ae39a58c50e40f1f28ad/contract';
import endContract from '../../snapshots/98bfe2e052f4a127a52e8868277e8ef7d69eb08a4e75ae39a58c50e40f1f28ad/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/41b79ce5f295f686b6ba210c993e88557414e0ce28e57ffcc5f660697beb9e67/contract';
import startContract from '../../snapshots/41b79ce5f295f686b6ba210c993e88557414e0ce28e57ffcc5f660697beb9e67/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'folder',
        column: col('settings', '"jsonb"', {
          notNull: true,
          default: lit({}),
          codecRef: {
            codecId: 'zod/json@1',
            typeParams: {
              export: 'SchemaTypes',
              key: 'zSettings',
              module: '../../prisma/zod-extension.ts',
            },
          },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
