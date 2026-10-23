#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/76bf7cddb83775240a8aee39bb637997b2d183a87894c0b31ee7f48fb69b4de5/contract';
import startContract from '../../snapshots/76bf7cddb83775240a8aee39bb637997b2d183a87894c0b31ee7f48fb69b4de5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/adc1189487a89874a3397507d2e94da3d98df2ffcd60b8979aa3c65d44b3c170/contract';
import endContract from '../../snapshots/adc1189487a89874a3397507d2e94da3d98df2ffcd60b8979aa3c65d44b3c170/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'subagent',
        constraint: 'subagent_messageId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'subagent', index: 'subagent_messageId_idx' }),
      this.dropColumn({ schema: 'public', table: 'subagent', column: 'messageId' }),
      this.createTable({
        schema: 'public',
        table: 'message_subagent',
        columns: [
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subagentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['messageId', 'subagentId'], { name: 'message_subagent_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_subagent',
        index: 'message_subagent_messageId_idx',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_subagent',
        index: 'message_subagent_subagentId_idx',
        columns: ['subagentId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_subagent',
        foreignKey: {
          name: 'message_subagent_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_subagent',
        foreignKey: {
          name: 'message_subagent_subagentId_fkey',
          columns: ['subagentId'],
          references: { schema: 'public', table: 'subagent', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
