// Test DSQL connection endpoint

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { ConnectionConfig, ConnectionTestResult } from '@/types/connection';

export async function POST(request: NextRequest): Promise<NextResponse<ConnectionTestResult>> {
  let pool: Pool | null = null;

  try {
    const config: ConnectionConfig = await request.json();

    // Validate required fields
    if (!config.clusterEndpoint || !config.region) {
      return NextResponse.json({
        success: false,
        message: 'Missing required fields: clusterEndpoint and region',
      });
    }

    if (!config.accessKeyId || !config.secretAccessKey) {
      return NextResponse.json({
        success: false,
        message: 'Missing AWS credentials',
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

    // Test connection
    const client = await pool.connect();

    try {
      // Get version
      const versionResult = await client.query('SELECT version()');
      const version = versionResult.rows[0]?.version || 'Unknown';

      // Get list of tables
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const tables = tablesResult.rows.map((r) => r.table_name);

      return NextResponse.json({
        success: true,
        message: 'Connected successfully',
        version,
        tables,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Connection test error:', error);

    let message = 'Connection failed';
    if (error instanceof Error) {
      if (error.message.includes('authentication')) {
        message = 'Authentication failed. Check your AWS credentials.';
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        message = 'Connection timed out. Check your cluster endpoint.';
      } else if (error.message.includes('ENOTFOUND')) {
        message = 'Cluster endpoint not found. Check the endpoint URL.';
      } else if (error.message.includes('certificate')) {
        message = 'SSL certificate error. Ensure the endpoint is correct.';
      } else {
        message = error.message;
      }
    }

    return NextResponse.json({
      success: false,
      message,
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}
