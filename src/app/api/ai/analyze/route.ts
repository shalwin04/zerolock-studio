// POST /api/ai/analyze - Analyze transaction code for write-skew and anomalies
import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeWriteSkewWithAI,
  calculateConflictProbability,
} from '@/lib/ai/write-skew-detector';

interface AnalyzeRequest {
  code: string;
  analysisType?: 'write-skew' | 'conflict-probability' | 'full';
  concurrencyModel?: {
    expectedThreads: number;
    writeRate: number;
    keySpaceSize: number;
  };
  autoFix?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();

    if (!body.code || typeof body.code !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_CODE',
            message: 'Code is required and must be a string',
          },
        },
        { status: 400 }
      );
    }

    const {
      code,
      analysisType = 'full',
      concurrencyModel,
      autoFix = false,
    } = body;

    // Perform analysis based on type
    if (analysisType === 'conflict-probability') {
      if (!concurrencyModel) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'MISSING_CONCURRENCY_MODEL',
              message: 'concurrencyModel is required for conflict-probability analysis',
            },
          },
          { status: 400 }
        );
      }

      const result = calculateConflictProbability({
        concurrentTransactions: concurrencyModel.expectedThreads,
        writeRate: concurrencyModel.writeRate,
        transactionDuration: 0.1, // 100ms estimate
        keySpaceSize: concurrencyModel.keySpaceSize,
      });

      return NextResponse.json({
        success: true,
        conflictProbability: result.probability,
        formula: result.formula,
        riskLevel:
          result.probability > 0.3
            ? 'high'
            : result.probability > 0.1
            ? 'medium'
            : 'low',
      });
    }

    // Full or write-skew analysis with optional auto-fix
    const analysis = await analyzeWriteSkewWithAI(code, concurrencyModel, {
      generateFix: autoFix,
    });

    return NextResponse.json({
      success: true,
      hasAnomalies: analysis.hasAnomalies,
      conflictProbability: analysis.conflictProbability,
      analysis: analysis.analysis,
      recommendations: analysis.recommendations,
      formula: analysis.formula,
      fixedCode: analysis.fixedCode,
    });
  } catch (error) {
    console.error('Analysis error:', error);

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
