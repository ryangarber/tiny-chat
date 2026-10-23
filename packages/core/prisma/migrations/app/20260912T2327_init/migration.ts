#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/d67b0152664f00b981ed6c555a078a08b0f770342c40e0fe6d0f9adc25cf490f/contract';
import endContract from '../../snapshots/d67b0152664f00b981ed6c555a078a08b0f770342c40e0fe6d0f9adc25cf490f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'Author',
        members: ['USER', 'MODEL'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'MemoryCategory',
        members: ['IDENTITY', 'PREFERENCES', 'PROJECTS', 'SKILLS', 'CONSTRAINTS'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'MemoryStability',
        members: ['SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'UploadKind',
        members: ['ATTACHMENT', 'SKILL', 'GITHUB'],
      }),
      this.createTable({
        schema: 'public',
        table: 'account',
        columns: [
          col('accessToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('accessTokenExpiresAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('accountId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('password', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refreshToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('refreshTokenExpiresAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('scope', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'account_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'action',
        columns: [
          col('config', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zConfig',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('data', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zData',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('embedding', '"vector"', { codecRef: { codecId: 'pg/vector@1', typeParams: {} } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastRanAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('schedule', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('timezone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'action_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'chat',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('folderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('incognito', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('temporary', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'chat_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'chat_memory',
        columns: [
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('memoryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['chatId', 'memoryId'], { name: 'chat_memory_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'dream',
        columns: [
          col('config', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zConfig',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('data', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zData',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zMetadata',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'dream_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'dream_message',
        columns: [
          col('dreamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['messageId', 'dreamId'], { name: 'dream_message_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'file',
        columns: [
          col('chatId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('data', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('embedding', '"vector"', { codecRef: { codecId: 'pg/vector@1', typeParams: {} } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mime', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('path', 'text[]', { notNull: true, codecRef: { codecId: 'pg/text@1', many: true } }),
          col('uploadId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'file_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'folder',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('cwd', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'folder_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'memory',
        columns: [
          col('category', '"MemoryCategory"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'MemoryCategory' } },
          }),
          col('confidence', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('config', '"jsonb"', {
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zConfig',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('embedding', '"vector"', { codecRef: { codecId: 'pg/vector@1', typeParams: {} } }),
          col('evidence', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('fact', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('stability', '"MemoryStability"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'MemoryStability' } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'memory_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'message',
        columns: [
          col('author', '"Author"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'Author' } },
          }),
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('config', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zConfig',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('data', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zData',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('embedding', '"vector"', { codecRef: { codecId: 'pg/vector@1', typeParams: {} } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zMetadata',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('previousId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'message_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'session',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ipAddress', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userAgent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'session_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'subagent',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('data', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zData',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', '"jsonb"', {
            notNull: true,
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zMetadata',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'subagent_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'upload',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', '"UploadKind"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'UploadKind' } },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('thumbnail', 'bytea', { codecRef: { codecId: 'pg/bytea@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'upload_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('cache', '"jsonb"', {
            notNull: true,
            default: lit({}),
            codecRef: {
              codecId: 'zod/json@1',
              typeParams: {
                export: 'SchemaTypes',
                key: 'zCache',
                module: '../../prisma/zod-extension.ts',
              },
            },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('emailVerified', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('image', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('isAnonymous', 'bool', { default: lit(false), codecRef: { codecId: 'pg/bool@1' } }),
          col('isEphemeral', 'bool', { default: lit(false), codecRef: { codecId: 'pg/bool@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('settings', '"jsonb"', {
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
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'user_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'verification',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('identifier', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'verification_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'account',
        index: 'account_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'action',
        index: 'action_messageId_idx',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'action',
        index: 'action_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat',
        index: 'chat_folderId_idx',
        columns: ['folderId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat',
        index: 'chat_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat_memory',
        index: 'chat_memory_chatId_idx',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat_memory',
        index: 'chat_memory_memoryId_idx',
        columns: ['memoryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dream',
        index: 'dream_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dream_message',
        index: 'dream_message_dreamId_idx',
        columns: ['dreamId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dream_message',
        index: 'dream_message_messageId_idx',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'file',
        index: 'file_chatId_idx',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'file',
        index: 'file_uploadId_idx',
        columns: ['uploadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'file',
        index: 'file_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'folder',
        index: 'folder_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'memory',
        index: 'memory_messageId_idx',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'memory',
        index: 'memory_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_chatId_idx',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_previousId_key',
        columns: ['previousId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'session_token_key',
        columns: ['token'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'session_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'subagent',
        index: 'subagent_messageId_idx',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'subagent',
        index: 'subagent_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'upload',
        index: 'upload_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'user_email_key',
        columns: ['email'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'verification',
        index: 'verification_identifier_idx',
        columns: ['identifier'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'account',
        foreignKey: {
          name: 'account_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'action',
        foreignKey: {
          name: 'action_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'action',
        foreignKey: {
          name: 'action_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'chat',
        foreignKey: {
          name: 'chat_folderId_fkey',
          columns: ['folderId'],
          references: { schema: 'public', table: 'folder', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'chat',
        foreignKey: {
          name: 'chat_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'chat_memory',
        foreignKey: {
          name: 'chat_memory_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'chat_memory',
        foreignKey: {
          name: 'chat_memory_memoryId_fkey',
          columns: ['memoryId'],
          references: { schema: 'public', table: 'memory', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dream',
        foreignKey: {
          name: 'dream_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dream_message',
        foreignKey: {
          name: 'dream_message_dreamId_fkey',
          columns: ['dreamId'],
          references: { schema: 'public', table: 'dream', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dream_message',
        foreignKey: {
          name: 'dream_message_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'file',
        foreignKey: {
          name: 'file_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'file',
        foreignKey: {
          name: 'file_uploadId_fkey',
          columns: ['uploadId'],
          references: { schema: 'public', table: 'upload', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'file',
        foreignKey: {
          name: 'file_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'folder',
        foreignKey: {
          name: 'folder_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'memory',
        foreignKey: {
          name: 'memory_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'memory',
        foreignKey: {
          name: 'memory_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_previousId_fkey',
          columns: ['previousId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'session',
        foreignKey: {
          name: 'session_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'subagent',
        foreignKey: {
          name: 'subagent_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'subagent',
        foreignKey: {
          name: 'subagent_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'upload',
        foreignKey: {
          name: 'upload_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'try_decode_utf8',
        label: 'Create function "try_decode_utf8"',
        operationClass: 'additive',
        target: {id: 'postgres'},
        precheck: [],
        execute: [
          {
            description: 'create or replace function public.try_decode_utf8',
            sql: `
              create or replace function public.try_decode_utf8(b bytea)
                  returns text
                  language plpgsql
                  immutable
                  parallel safe
              as
              $$
              DECLARE decoded text;
              BEGIN
                  decoded := convert_from(b, 'UTF8');
                  IF LENGTH(decoded) > 0 THEN
                      RETURN decoded;
                  END IF;
                  RETURN NULL;
              EXCEPTION WHEN OTHERS THEN
                  RETURN NULL;
              END;
              $$;
            `,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'try_extract_text',
        label: 'Create function "try_extract_text"',
        operationClass: 'additive',
        target: {id: 'postgres'},
        precheck: [],
        execute: [
          {
            description: 'create or replace function public.try_extract_text',
            sql: `
              create or replace function public.try_extract_text(j jsonb)
                  returns text
                  language plpgsql
                  immutable
                  parallel safe
              as
              $$
              DECLARE extracted text;
              BEGIN
                  SELECT string_agg("dataPart"->>'value', ' ')
                  INTO extracted
                  FROM jsonb_array_elements(j) AS "step",
                      jsonb_array_elements("step") AS "dataPart"
                  WHERE "dataPart"->>'type' = 'text';
                  return extracted;
              END;
              $$;
              `,
          }
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
