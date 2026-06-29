// POST /api/ai/schema-migrate - Analyze and refactor schema for Aurora DSQL
import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeSchemaWithAI,
  analyzeSchemaStatic,
  convertToDrizzle,
  validateDSQLLimits,
} from '@/lib/ai/schema-agent';

interface SchemaMigrateRequest {
  schema: string;
  format?: 'sql' | 'drizzle';
  options?: {
    autoFix?: boolean;
    verbose?: boolean;
    suggestDrizzle?: boolean;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: SchemaMigrateRequest = await request.json();

    if (!body.schema || typeof body.schema !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_SCHEMA',
            message: 'Schema is required and must be a string',
          },
        },
        { status: 400 }
      );
    }

    const { schema, format = 'sql', options = {} } = body;
    const { autoFix = true, verbose = false, suggestDrizzle = false } = options;

    // Analyze schema
    let result;

    // Try AI analysis first, fall back to static
    try {
      result = await analyzeSchemaWithAI(schema, {
        autoFix,
        verbose,
      });
    } catch (error) {
      // Fall back to static analysis
      const staticIssues = analyzeSchemaStatic(schema);
      result = {
        compatible: staticIssues.filter((i) => i.severity === 'error').length === 0,
        issues: staticIssues,
      };
    }

    // Validate DSQL limits
    const limitsValidation = validateDSQLLimits(schema);
    if (limitsValidation.warnings.length > 0) {
      result.issues = [
        ...result.issues,
        ...limitsValidation.warnings.map((w) => ({
          severity: 'warning' as const,
          code: 'DSQL_LIMIT_WARNING',
          message: w,
          suggestion: 'Consider chunking operations or reducing data size',
        })),
      ];
    }

    // Generate Drizzle schema if requested
    let drizzleSchema: string | undefined;
    if (suggestDrizzle && format === 'sql') {
      drizzleSchema = await convertToDrizzle(schema);
    }

    return NextResponse.json({
      success: true,
      compatible: result.compatible,
      issues: result.issues,
      refactoredSchema: result.refactoredSchema,
      drizzleSchema,
      explanation: result.explanation,
    });
  } catch (error) {
    console.error('Schema migration error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
