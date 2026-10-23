#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/98bfe2e052f4a127a52e8868277e8ef7d69eb08a4e75ae39a58c50e40f1f28ad/contract';
import startContract from '../../snapshots/98bfe2e052f4a127a52e8868277e8ef7d69eb08a4e75ae39a58c50e40f1f28ad/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/73b5ffc094e2d533c2a7b96f2d919f88a382f6196892d12a27b242810978b825/contract';
import endContract from '../../snapshots/73b5ffc094e2d533c2a7b96f2d919f88a382f6196892d12a27b242810978b825/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'message_context',
        columns: [
          col('memoryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['messageId', 'memoryId'], { name: 'message_context_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_context',
        index: 'message_context_memoryId_idx',
        columns: ['memoryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_context',
        index: 'message_context_messageId_idx',
        columns: ['messageId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_context',
        foreignKey: {
          name: 'message_context_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_context',
        foreignKey: {
          name: 'message_context_memoryId_fkey',
          columns: ['memoryId'],
          references: { schema: 'public', table: 'memory', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
