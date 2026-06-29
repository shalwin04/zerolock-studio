// POST /api/schema/discover - Discover database schema
import { NextRequest, NextResponse } from 'next/server';
import { discoverSchema } from '@/lib/schema/introspector';
import { SchemaDiscoveryResult } from '@/types/schema';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Simple in-memory cache
let schemaCache: SchemaDiscoveryResult | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ConnectionConfig {
  clusterEndpoint?: string;
  region?: string;
  database?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

interface DiscoverRequest {
  forceRefresh?: boolean;
  connection?: ConnectionConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body: DiscoverRequest = await request.json().catch(() => ({}));
    const { forceRefresh = false, connection } = body;

    // Apply user-provided connection config if available
    if (connection?.clusterEndpoint) {
      process.env.AWS_DSQL_CLUSTER_ENDPOINT = connection.clusterEndpoint;
      if (connection.region) {
        process.env.AWS_REGION = connection.region;
      }
      if (connection.database) {
        process.env.AWS_DSQL_DATABASE = connection.database;
      }
      if (connection.accessKeyId) {
        process.env.AWS_ACCESS_KEY_ID = connection.accessKeyId;
      }
      if (connection.secretAccessKey) {
        process.env.AWS_SECRET_ACCESS_KEY = connection.secretAccessKey;
      }
    }

    // Check if DSQL is configured (either from env or user-provided)
    if (!process.env.AWS_DSQL_CLUSTER_ENDPOINT) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DSQL_NOT_CONFIGURED',
            message: 'Aurora DSQL cluster endpoint is not configured. Connect to a cluster first.',
          },
        },
        { status: 503 }
      );
    }

    // Check cache
    if (!forceRefresh && schemaCache) {
      const cacheAge = Date.now() - schemaCache.cachedAt;
      if (cacheAge < CACHE_TTL_MS) {
        return NextResponse.json({
          success: true,
          cached: true,
          cacheAge: Math.round(cacheAge / 1000),
          ...schemaCache,
        });
      }
    }

    console.log('Discovering schema from DSQL...');
    const result = await discoverSchema(forceRefresh);

    // Update cache
    schemaCache = result;

    return NextResponse.json({
      success: true,
      cached: false,
      tableCount: result.tables.length,
      hotspotCount: result.hotspots.length,
      ...result,
    });
  } catch (error) {
    console.error('Schema discovery error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}

// GET endpoint for quick status check
export async function GET() {
  if (!process.env.AWS_DSQL_CLUSTER_ENDPOINT) {
    return NextResponse.json({
      success: false,
      configured: false,
    });
  }

  return NextResponse.json({
    success: true,
    configured: true,
    cached: schemaCache !== null,
    cacheAge: schemaCache ? Math.round((Date.now() - schemaCache.cachedAt) / 1000) : null,
    tableCount: schemaCache?.tables.length || 0,
  });
}
