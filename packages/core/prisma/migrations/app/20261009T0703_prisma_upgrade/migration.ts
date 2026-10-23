#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ae17d2661aaf6704966ba519fccf927ab835fb8b7865a722f25263d350514897/contract';
import endContract from '../../snapshots/ae17d2661aaf6704966ba519fccf927ab835fb8b7865a722f25263d350514897/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/794cd63c8f9430acff5e147894ce7bc9cb6db546bb446062743b4a43194a967f/contract';
import startContract from '../../snapshots/794cd63c8f9430acff5e147894ce7bc9cb6db546bb446062743b4a43194a967f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
