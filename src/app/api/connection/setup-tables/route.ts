// Setup test tables endpoint

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { ConnectionConfig, SetupTablesResult } from '@/types/connection';

// Individual table creation statements
const TABLE_STATEMENTS = [
  {
    name: 'accounts',
    create: `
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        balance DECIMAL(15,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    seed: `
      INSERT INTO accounts (id, name, balance)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'Alice', 10000.00),
        ('22222222-2222-2222-2222-222222222222', 'Bob', 10000.00),
        ('33333333-3333-3333-3333-333333333333', 'Charlie', 10000.00)
      ON CONFLICT (id) DO UPDATE SET
        balance = EXCLUDED.balance,
        updated_at = CURRENT_TIMESTAMP
    `,
  },
  {
    name: 'counters',
    create: `
      CREATE TABLE IF NOT EXISTS counters (
        id VARCHAR(50) PRIMARY KEY,
        value INTEGER DEFAULT 0,
        update_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    seed: `
      INSERT INTO counters (id, value, update_count)
      VALUES ('hot_counter', 0, 0)
      ON CONFLICT (id) DO UPDATE SET
        value = 0,
        update_count = 0,
        last_updated = CURRENT_TIMESTAMP
    `,
  },
  {
    name: 'inventory',
    create: `
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_name VARCHAR(100) NOT NULL,
        quantity INTEGER DEFAULT 0,
        reserved INTEGER DEFAULT 0,
        price DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    seed: `
      INSERT INTO inventory (id, product_name, quantity, reserved, price)
      VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Widget A', 100, 0, 29.99),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Widget B', 50, 0, 49.99),
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Widget C', 25, 0, 99.99)
      ON CONFLICT (id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reserved = 0
    `,
  },
  {
    name: 'orders',
    create: `
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_name VARCHAR(100),
        product_id UUID,
        quantity INTEGER NOT NULL,
        total_amount DECIMAL(15,2),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    seed: null, // No seed data for orders
  },
];

export async function POST(request: NextRequest): Promise<NextResponse<SetupTablesResult>> {
  let pool: Pool | null = null;
  const tablesCreated: string[] = [];
  const errors: string[] = [];

  try {
    const config: ConnectionConfig = await request.json();

    // Validate required fields
    if (!config.clusterEndpoint || !config.region) {
      return NextResponse.json({
        success: false,
        message: 'Missing required fields',
        tablesCreated: [],
        errors: ['Missing clusterEndpoint or region'],
      });
    }

    if (!config.accessKeyId || !config.secretAccessKey) {
      return NextResponse.json({
        success: false,
        message: 'Missing AWS credentials',
        tablesCreated: [],
        errors: ['Missing AWS credentials'],
      });
    }

    // Set AWS credentials for this request
    process.env.AWS_ACCESS_KEY_ID = config.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = config.secretAccessKey;
    process.env.AWS_REGION = config.region;

    // Generate auth token
    const signer = new DsqlSigner({
      hostname: config.clusterEndpoint,
      region: config.region,
    });

    const token = await signer.getDbConnectAdminAuthToken();

    // Create connection pool
    pool = new Pool({
      host: config.clusterEndpoint,
      port: 5432,
      database: config.database || 'postgres',
      user: 'admin',
      password: token,
      ssl: { rejectUnauthorized: true },
      max: 1,
      connectionTimeoutMillis: 10000,
    });

    const client = await pool.connect();

    try {
      // Create and seed each table
      for (const table of TABLE_STATEMENTS) {
        try {
          // Create table
          await client.query(table.create);

          // Seed data if available
          if (table.seed) {
            await client.query(table.seed);
          }

          tablesCreated.push(table.name);
        } catch (tableError) {
          const message = tableError instanceof Error ? tableError.message : String(tableError);
          errors.push(`${table.name}: ${message}`);
        }
      }

      const success = tablesCreated.length > 0;
      const message = success
        ? `Created ${tablesCreated.length} tables: ${tablesCreated.join(', ')}`
        : 'No tables were created';

      return NextResponse.json({
        success,
        message,
        tablesCreated,
        errors,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Setup tables error:', error);

    const message = error instanceof Error ? error.message : 'Setup failed';
    return NextResponse.json({
      success: false,
      message,
      tablesCreated,
      errors: [...errors, message],
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}
