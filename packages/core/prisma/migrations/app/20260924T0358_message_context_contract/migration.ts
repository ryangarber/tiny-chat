#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ce2bfe4a7aeb65235e15c0e74606b5080c31a0e0c24193f16d6f12272a2d46a8/contract';
import endContract from '../../snapshots/ce2bfe4a7aeb65235e15c0e74606b5080c31a0e0c24193f16d6f12272a2d46a8/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/73b5ffc094e2d533c2a7b96f2d919f88a382f6196892d12a27b242810978b825/contract';
import startContract from '../../snapshots/73b5ffc094e2d533c2a7b96f2d919f88a382f6196892d12a27b242810978b825/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropTable({ schema: 'public', table: 'chat_memory' })];
  }
}

MigrationCLI.run(import.meta.url, M);
