#!/usr/bin/env npx ts-node

/**
 * Database Setup Script for Zero-Lock Studio
 *
 * Creates test tables in Aurora DSQL for chaos testing demos:
 * - accounts: For balance transfer tests (conflict-prone)
 * - users: For basic CRUD operations
 * - counters: For hot-key conflict tests
 * - transaction_guards: For safety guard pattern demos
 * - orders: For batch insert tests
 *
 * Usage:
 *   npx ts-node scripts/setup-database.ts
 *   # or
 *   npm run db:setup
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

const TABLES = {
  // Accounts table for balance transfer tests
  accounts: `
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,

  // Users table for basic operations
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,

  // Counters table for hot-key conflict tests
  counters: `
    CREATE TABLE IF NOT EXISTS counters (
      id TEXT PRIMARY KEY,
      value BIGINT NOT NULL DEFAULT 0,
      last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      update_count BIGINT DEFAULT 0
    );
  `,

  // Transaction guards for safety guard pattern demos
  transaction_guards: `
    CREATE TABLE IF NOT EXISTS transaction_guards (
      scope TEXT PRIMARY KEY,
      epoch BIGINT NOT NULL DEFAULT 0,
      last_locked_at TIMESTAMP WITH TIME ZONE,
      lock_count BIGINT DEFAULT 0
    );
  `,

  // Orders table for batch insert tests
  orders: `
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL,
      product_id UUID NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(15,2) NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,

  // Inventory table for write-skew demos
  inventory: `
    CREATE TABLE IF NOT EXISTS inventory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL,
      warehouse_id UUID NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      available INTEGER GENERATED ALWAYS AS (quantity - reserved) STORED,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (product_id, warehouse_id)
    );
  `,
};

const SEED_DATA = {
  accounts: `
    INSERT INTO accounts (id, name, email, balance) VALUES
      ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@example.com', 10000.00),
      ('22222222-2222-2222-2222-222222222222', 'Bob', 'bob@example.com', 5000.00),
      ('33333333-3333-3333-3333-333333333333', 'Charlie', 'charlie@example.com', 7500.00),
      ('44444444-4444-4444-4444-444444444444', 'Diana', 'diana@example.com', 3000.00),
      ('55555555-5555-5555-5555-555555555555', 'Eve', 'eve@example.com', 15000.00)
    ON CONFLICT (id) DO NOTHING;
  `,

  counters: `
    INSERT INTO counters (id, value) VALUES
      ('global_visits', 0),
      ('api_calls', 0),
      ('active_users', 0),
      ('total_orders', 0),
      ('hot_counter', 0)
    ON CONFLICT (id) DO NOTHING;
  `,

  transaction_guards: `
    INSERT INTO transaction_guards (scope, epoch) VALUES
      ('transfer_guard', 0),
      ('inventory_guard', 0),
      ('order_guard', 0)
    ON CONFLICT (scope) DO NOTHING;
  `,

  inventory: `
    INSERT INTO inventory (product_id, warehouse_id, quantity, reserved) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 100, 0),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 50, 0),
      ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 200, 0)
    ON CONFLICT (product_id, warehouse_id) DO NOTHING;
  `,
};

async function getAuthToken(): Promise<string> {
  const hostname = process.env.AWS_DSQL_CLUSTER_ENDPOINT;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!hostname) {
    throw new Error('AWS_DSQL_CLUSTER_ENDPOINT is not set');
  }

  const signer = new DsqlSigner({
    hostname,
    region,
  });

  return signer.getDbConnectAdminAuthToken();
}

async function createPool(): Promise<Pool> {
  const token = await getAuthToken();

  return new Pool({
    host: process.env.AWS_DSQL_CLUSTER_ENDPOINT,
    port: 5432,
    database: process.env.AWS_DSQL_DATABASE || 'postgres',
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 5,
  });
}

async function runSetup() {
  console.log('🚀 Zero-Lock Studio Database Setup\n');
  console.log(`Cluster: ${process.env.AWS_DSQL_CLUSTER_ENDPOINT}`);
  console.log(`Region:  ${process.env.AWS_REGION || 'us-east-1'}\n`);

  let pool: Pool | null = null;

  try {
    console.log('🔐 Generating auth token...');
    pool = await createPool();
    console.log('✅ Connected to Aurora DSQL\n');

    // Create tables
    console.log('📦 Creating tables...\n');
    for (const [name, sql] of Object.entries(TABLES)) {
      try {
        await pool.query(sql);
        console.log(`  ✅ ${name}`);
      } catch (error) {
        console.error(`  ❌ ${name}: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Seed data
    console.log('\n🌱 Seeding test data...\n');
    for (const [name, sql] of Object.entries(SEED_DATA)) {
      try {
        const result = await pool.query(sql);
        console.log(`  ✅ ${name}`);
      } catch (error) {
        console.error(`  ❌ ${name}: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Verify setup
    console.log('\n📊 Verifying setup...\n');
    const tables = ['accounts', 'users', 'counters', 'transaction_guards', 'orders', 'inventory'];
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ${table}: ${result.rows[0].count} rows`);
      } catch (error) {
        console.log(`  ${table}: (table not found)`);
      }
    }

    console.log('\n✅ Database setup complete!\n');
    console.log('You can now run the playground at http://localhost:3000/playground\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run if called directly
runSetup().catch(console.error);
