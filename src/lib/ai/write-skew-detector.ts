// Write-Skew Anomaly Detector for Zero-Lock Studio
// Analyzes transaction code for potential write-skew vulnerabilities using OpenAI GPT-4o

import { getOpenAIClient, AI_CONFIG, SYSTEM_PROMPTS } from './openai-client';

export interface WriteSkewAnalysis {
  hasAnomalies: boolean;
  conflictProbability: number;
  riskLevel: 'low' | 'medium' | 'high';
  analysis: {
    readSet: string[];
    writeSet: string[];
    overlap: boolean;
    patterns: DetectedPattern[];
  };
  recommendations: WriteSkewRecommendation[];
  formula?: {
    expression: string;
    variables: Record<string, number>;
    result: number;
  };
  fixedCode?: string;
}

export interface DetectedPattern {
  type: string;
  description: string;
  line?: number;
  risk: 'low' | 'medium' | 'high';
  codeSnippet?: string;
}

export interface WriteSkewRecommendation {
  type: 'SELECT_FOR_UPDATE' | 'SAFETY_GUARD_ROW' | 'ATOMIC_UPDATE' | 'SERIALIZABLE' | 'RETRY_LOGIC';
  priority: 'high' | 'medium' | 'low';
  description: string;
  codeFix?: string;
}

// Calculate theoretical conflict probability
// P(conflict) = 1 - e^(-N² * λ * t / 2K)
export function calculateConflictProbability(params: {
  concurrentTransactions: number; // N
  writeRate: number; // λ (writes per second)
  transactionDuration: number; // t (seconds)
  keySpaceSize: number; // K (unique keys)
}): { probability: number; formula: WriteSkewAnalysis['formula'] } {
  const { concurrentTransactions: N, writeRate: lambda, transactionDuration: t, keySpaceSize: K } = params;

  const exponent = (-N * N * lambda * t) / (2 * K);
  const probability = 1 - Math.exp(exponent);

  return {
    probability: Math.min(1, Math.max(0, probability)),
    formula: {
      expression: 'P(conflict) = 1 - e^(-N² × λ × t / 2K)',
      variables: {
        N,
        'λ (writes/sec)': lambda,
        't (seconds)': t,
        'K (key space)': K,
      },
      result: Math.round(probability * 10000) / 100, // Percentage with 2 decimals
    },
  };
}

// Static pattern detection for write-skew
export function detectWriteSkewPatterns(code: string): {
  patterns: DetectedPattern[];
  readSet: string[];
  writeSet: string[];
} {
  const patterns: DetectedPattern[] = [];
  const readSet: string[] = [];
  const writeSet: string[] = [];

  const lines = code.split('\n');

  let lastSelectTable: string | null = null;
  let lastSelectLine = 0;
  let inTransaction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track transaction boundaries
    if (/BEGIN|START\s+TRANSACTION/i.test(line)) {
      inTransaction = true;
    }
    if (/COMMIT|ROLLBACK/i.test(line)) {
      inTransaction = false;
    }

    // Track SELECT statements
    const selectMatch = line.match(/SELECT.*FROM\s+["']?(\w+)["']?/i);
    if (selectMatch) {
      lastSelectTable = selectMatch[1];
      lastSelectLine = lineNum;
      if (!readSet.includes(lastSelectTable)) {
        readSet.push(lastSelectTable);
      }

      // Check for missing FOR UPDATE
      if (inTransaction && !line.match(/FOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE)/i)) {
        // Look ahead for UPDATE before COMMIT/ROLLBACK
        const remainingLines = lines.slice(i + 1).join('\n');
        const updateIndex = remainingLines.search(/UPDATE/i);
        const commitIndex = remainingLines.search(/COMMIT|ROLLBACK/i);
        if (updateIndex !== -1 && (commitIndex === -1 || updateIndex < commitIndex)) {
          patterns.push({
            type: 'MISSING_FOR_UPDATE',
            description: `SELECT from '${lastSelectTable}' without FOR UPDATE - concurrent transactions can read stale data`,
            line: lineNum,
            risk: 'high',
            codeSnippet: line.trim().substring(0, 80),
          });
        }
      }
    }

    // Track UPDATE statements
    const updateMatch = line.match(/UPDATE\s+["']?(\w+)["']?/i);
    if (updateMatch) {
      const updateTable = updateMatch[1];
      if (!writeSet.includes(updateTable)) {
        writeSet.push(updateTable);
      }

      // Check for cross-table write-skew
      if (lastSelectTable && lastSelectTable.toLowerCase() !== updateTable.toLowerCase()) {
        patterns.push({
          type: 'CROSS_TABLE_WRITE_SKEW',
          description: `Reading from '${lastSelectTable}' (line ${lastSelectLine}) then updating '${updateTable}' - classic write-skew pattern`,
          line: lineNum,
          risk: 'high',
          codeSnippet: `SELECT...FROM ${lastSelectTable} → UPDATE ${updateTable}`,
        });
      }
    }

    // Detect read-modify-write anti-pattern
    const rmwMatch = line.match(/SET\s+(\w+)\s*=\s*(\w+)\s*([+-])/i);
    if (rmwMatch && !line.match(/SET\s+\w+\s*=\s*\w+\s*[+-]\s*\$\d+/i)) {
      // Not a parameterized atomic update
      if (line.match(/=\s*\w+\s*[+-]\s*\d+/)) {
        patterns.push({
          type: 'READ_MODIFY_WRITE',
          description: 'Non-atomic increment/decrement - should use atomic UPDATE',
          line: lineNum,
          risk: 'medium',
          codeSnippet: line.trim().substring(0, 60),
        });
      }
    }

    // Detect variable-based updates (fetched then used)
    if (line.match(/=\s*\$?\{?\w+Balance\}?/i) || line.match(/=\s*\$?\{?current\w+\}?/i)) {
      patterns.push({
        type: 'VARIABLE_BASED_UPDATE',
        description: 'Update uses previously fetched value - race condition possible',
        line: lineNum,
        risk: 'high',
        codeSnippet: line.trim().substring(0, 60),
      });
    }
  }

  return { patterns, readSet, writeSet };
}

// AI-powered comprehensive write-skew analysis using OpenAI GPT-4o
export async function analyzeWriteSkewWithAI(
  code: string,
  concurrencyModel?: {
    expectedThreads: number;
    writeRate: number;
    keySpaceSize: number;
  },
  options: {
    generateFix?: boolean;
  } = {}
): Promise<WriteSkewAnalysis> {
  const { generateFix = true } = options;

  // Start with static analysis
  const { patterns, readSet, writeSet } = detectWriteSkewPatterns(code);

  // Calculate conflict probability if concurrency model provided
  let probability = 0;
  let formula: WriteSkewAnalysis['formula'] | undefined;

  if (concurrencyModel) {
    const result = calculateConflictProbability({
      concurrentTransactions: concurrencyModel.expectedThreads,
      writeRate: concurrencyModel.writeRate,
      transactionDuration: 0.1, // Estimate 100ms transaction
      keySpaceSize: concurrencyModel.keySpaceSize,
    });
    probability = result.probability;
    formula = result.formula;
  }

  // Determine risk level from static analysis
  const highRiskCount = patterns.filter((p) => p.risk === 'high').length;
  const mediumRiskCount = patterns.filter((p) => p.risk === 'medium').length;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (highRiskCount > 0 || probability > 0.3) {
    riskLevel = 'high';
  } else if (mediumRiskCount > 0 || probability > 0.1) {
    riskLevel = 'medium';
  }

  // Generate recommendations based on patterns
  const recommendations: WriteSkewRecommendation[] = [];

  if (patterns.some((p) => p.type === 'MISSING_FOR_UPDATE')) {
    recommendations.push({
      type: 'SELECT_FOR_UPDATE',
      priority: 'high',
      description: 'Add FOR UPDATE to lock rows during read phase, preventing concurrent modifications',
      codeFix: `-- Before:
SELECT * FROM accounts WHERE id = $1;

-- After:
SELECT * FROM accounts WHERE id = $1 FOR UPDATE;`,
    });
  }

  if (patterns.some((p) => p.type === 'CROSS_TABLE_WRITE_SKEW')) {
    recommendations.push({
      type: 'SAFETY_GUARD_ROW',
      priority: 'high',
      description: 'Add a guard row that both transactions must lock to serialize access',
      codeFix: `-- Create guard table:
CREATE TABLE transaction_guards (
  scope TEXT PRIMARY KEY,
  epoch BIGINT DEFAULT 0
);

-- In transaction, update guard first:
UPDATE transaction_guards
SET epoch = epoch + 1
WHERE scope = 'transfer_guard';
-- Then proceed with business logic...`,
    });
  }

  if (patterns.some((p) => p.type === 'READ_MODIFY_WRITE' || p.type === 'VARIABLE_BASED_UPDATE')) {
    recommendations.push({
      type: 'ATOMIC_UPDATE',
      priority: 'high',
      description: 'Use atomic UPDATE with expressions instead of SELECT → calculate → UPDATE',
      codeFix: `-- Before (race condition):
SELECT balance FROM accounts WHERE id = $1;
-- calculate new balance in app
UPDATE accounts SET balance = $2 WHERE id = $1;

-- After (atomic):
UPDATE accounts
SET balance = balance - $1
WHERE id = $2
RETURNING balance;`,
    });
  }

  // Add retry logic recommendation if conflicts likely
  if (probability > 0.1 || patterns.length > 0) {
    recommendations.push({
      type: 'RETRY_LOGIC',
      priority: 'medium',
      description: 'Implement exponential backoff with full jitter for 40001 retries',
      codeFix: `async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 5;
  const BASE_DELAY = 50;
  const MAX_DELAY = 5000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.code === '40001' && attempt < MAX_RETRIES) {
        // Full jitter exponential backoff
        const maxDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}`,
    });
  }

  // If no API key or no patterns found, return static analysis
  if (!process.env.OPENAI_API_KEY || (patterns.length === 0 && !generateFix)) {
    return {
      hasAnomalies: patterns.length > 0,
      conflictProbability: probability,
      riskLevel,
      analysis: {
        readSet,
        writeSet,
        overlap: readSet.some((r) => writeSet.map(w => w.toLowerCase()).includes(r.toLowerCase())),
        patterns,
      },
      recommendations,
      formula,
    };
  }

  // Use AI for deeper analysis and code fixes
  try {
    const openai = getOpenAIClient();

    const userPrompt = `Analyze this transaction code for write-skew anomalies and race conditions.

Code to analyze:
\`\`\`typescript
${code}
\`\`\`

Static analysis found these patterns:
${patterns.length > 0 ? patterns.map((p) => `- [${p.risk}] ${p.type}: ${p.description}`).join('\n') : 'No obvious patterns detected'}

${concurrencyModel ? `Concurrency model:
- Expected concurrent transactions: ${concurrencyModel.expectedThreads}
- Write rate: ${concurrencyModel.writeRate} writes/sec
- Key space size: ${concurrencyModel.keySpaceSize} unique keys
- Calculated conflict probability: ${(probability * 100).toFixed(1)}%` : ''}

Provide your analysis in this JSON format:
{
  "additionalPatterns": [
    {"type": "PATTERN_TYPE", "description": "What the issue is", "risk": "high|medium|low"}
  ],
  "riskAssessment": "Explanation of overall risk",
  ${generateFix ? '"fixedCode": "// Complete fixed TypeScript code with proper error handling",' : ''}
  "additionalRecommendations": [
    {"type": "RECOMMENDATION_TYPE", "priority": "high|medium|low", "description": "What to do"}
  ]
}`;

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.maxTokens,
      temperature: AI_CONFIG.temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.writeSkewAnalyzer },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const aiResult = JSON.parse(content);

    // Merge AI findings
    const allPatterns = [
      ...patterns,
      ...(aiResult.additionalPatterns || []).map((p: any) => ({
        type: p.type,
        description: p.description,
        risk: p.risk || 'medium',
      })),
    ];

    const allRecommendations = [
      ...recommendations,
      ...(aiResult.additionalRecommendations || []).map((r: any) => ({
        type: r.type || 'CUSTOM',
        priority: r.priority || 'medium',
        description: r.description,
      })),
    ];

    // Update risk level based on AI analysis
    if (aiResult.additionalPatterns?.some((p: any) => p.risk === 'high')) {
      riskLevel = 'high';
    }

    return {
      hasAnomalies: allPatterns.length > 0,
      conflictProbability: probability,
      riskLevel,
      analysis: {
        readSet,
        writeSet,
        overlap: readSet.some((r) => writeSet.map(w => w.toLowerCase()).includes(r.toLowerCase())),
        patterns: allPatterns,
      },
      recommendations: allRecommendations,
      formula,
      fixedCode: aiResult.fixedCode || undefined,
    };
  } catch (error) {
    console.error('AI write-skew analysis error:', error);

    // Return static analysis on AI failure
    return {
      hasAnomalies: patterns.length > 0,
      conflictProbability: probability,
      riskLevel,
      analysis: {
        readSet,
        writeSet,
        overlap: readSet.some((r) => writeSet.map(w => w.toLowerCase()).includes(r.toLowerCase())),
        patterns,
      },
      recommendations,
      formula,
    };
  }
}

// Quick check for write-skew risk without AI
export function quickWriteSkewCheck(code: string): {
  hasRisk: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
} {
  const { patterns } = detectWriteSkewPatterns(code);

  const highRisk = patterns.filter((p) => p.risk === 'high').length;
  const mediumRisk = patterns.filter((p) => p.risk === 'medium').length;

  if (highRisk > 0) {
    return {
      hasRisk: true,
      riskLevel: 'high',
      summary: `Found ${highRisk} high-risk pattern(s): ${patterns.filter(p => p.risk === 'high').map(p => p.type).join(', ')}`,
    };
  }

  if (mediumRisk > 0) {
    return {
      hasRisk: true,
      riskLevel: 'medium',
      summary: `Found ${mediumRisk} medium-risk pattern(s): ${patterns.filter(p => p.risk === 'medium').map(p => p.type).join(', ')}`,
    };
  }

  return {
    hasRisk: false,
    riskLevel: 'low',
    summary: 'No obvious write-skew patterns detected',
  };
}
