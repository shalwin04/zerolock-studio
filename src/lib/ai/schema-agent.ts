// Schema Migration Agent for Zero-Lock Studio
// Analyzes SQL/Drizzle schemas for Aurora DSQL compatibility using OpenAI GPT-4o

import { getOpenAIClient, AI_CONFIG, SYSTEM_PROMPTS } from './openai-client';

export interface SchemaIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  suggestion: string;
}

export interface SchemaAnalysisResult {
  compatible: boolean;
  issues: SchemaIssue[];
  refactoredSchema?: string;
  drizzleSchema?: string;
  explanation?: string;
}

// Known incompatibilities with Aurora DSQL
const DSQL_INCOMPATIBILITIES = {
  FOREIGN_KEY: {
    pattern: /FOREIGN\s+KEY|REFERENCES\s+\w+\s*\(/gi,
    code: 'UNSUPPORTED_FK',
    message: 'Foreign key constraints are not supported in Aurora DSQL',
    suggestion: "Use Drizzle's relations() API for application-level relationships",
  },
  TRIGGER: {
    pattern: /CREATE\s+TRIGGER/gi,
    code: 'UNSUPPORTED_TRIGGER',
    message: 'Triggers are not supported in Aurora DSQL',
    suggestion: 'Use AWS EventBridge with Lambda for event-driven logic',
  },
  STORED_PROCEDURE: {
    pattern: /CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)/gi,
    code: 'UNSUPPORTED_PROCEDURE',
    message: 'Stored procedures/functions are not supported in Aurora DSQL',
    suggestion: 'Move business logic to application layer or Lambda functions',
  },
  SERIAL: {
    pattern: /\bSERIAL\b|\bBIGSERIAL\b/gi,
    code: 'SERIAL_HOTSPOT',
    message: 'SERIAL primary keys cause write hotspots in distributed systems',
    suggestion: 'Use gen_random_uuid() for distributed UUID primary keys',
  },
  SEQUENCE: {
    pattern: /CREATE\s+SEQUENCE/gi,
    code: 'UNSUPPORTED_SEQUENCE',
    message: 'Sequences may cause hotspots and ordering issues',
    suggestion: 'Use UUID generation instead of sequences',
  },
  EXTENSION: {
    pattern: /CREATE\s+EXTENSION/gi,
    code: 'LIMITED_EXTENSION',
    message: 'Only limited PostgreSQL extensions are supported',
    suggestion: 'Check Aurora DSQL documentation for supported extensions',
  },
  AUTO_INCREMENT: {
    pattern: /AUTO_INCREMENT|IDENTITY/gi,
    code: 'AUTO_INCREMENT_HOTSPOT',
    message: 'Auto-increment IDs cause write hotspots',
    suggestion: 'Use UUID PRIMARY KEY DEFAULT gen_random_uuid()',
  },
};

// Static analysis without AI
export function analyzeSchemaStatic(schema: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  for (const [key, check] of Object.entries(DSQL_INCOMPATIBILITIES)) {
    let match;
    const regex = new RegExp(check.pattern.source, check.pattern.flags);

    while ((match = regex.exec(schema)) !== null) {
      // Find line number
      const beforeMatch = schema.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      issues.push({
        severity: key === 'SERIAL' || key === 'AUTO_INCREMENT' ? 'warning' : 'error',
        code: check.code,
        message: check.message,
        line: lineNumber,
        suggestion: check.suggestion,
      });
    }
  }

  return issues;
}

// AI-powered schema analysis using OpenAI GPT-4o
export async function analyzeSchemaWithAI(
  schema: string,
  options: {
    autoFix?: boolean;
    verbose?: boolean;
    generateDrizzle?: boolean;
  } = {}
): Promise<SchemaAnalysisResult> {
  const { autoFix = true, verbose = false, generateDrizzle = false } = options;

  // First, do static analysis
  const staticIssues = analyzeSchemaStatic(schema);

  // If no API key, return static analysis only
  if (!process.env.OPENAI_API_KEY) {
    return {
      compatible: staticIssues.filter((i) => i.severity === 'error').length === 0,
      issues: staticIssues,
    };
  }

  try {
    const openai = getOpenAIClient();

    const userPrompt = `Analyze this SQL schema for Aurora DSQL compatibility.

Already identified issues from static analysis:
${staticIssues.length > 0 ? staticIssues.map((i) => `- Line ${i.line || '?'}: [${i.severity}] ${i.code} - ${i.message}`).join('\n') : 'None found'}

Schema to analyze:
\`\`\`sql
${schema}
\`\`\`

Provide your response in this exact JSON format:
{
  "additionalIssues": [
    {"severity": "error|warning|info", "code": "ISSUE_CODE", "message": "Description", "line": 1, "suggestion": "How to fix"}
  ],
  "refactoredSchema": ${autoFix ? '"-- DSQL-compatible SQL schema here"' : 'null'},
  ${generateDrizzle ? '"drizzleSchema": "// Drizzle ORM schema here",' : ''}
  "explanation": "${verbose ? 'Detailed explanation of changes' : ''}"
}`;

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.maxTokens,
      temperature: AI_CONFIG.temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.schemaAnalyzer },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const aiResult = JSON.parse(content);

    // Merge static and AI issues
    const allIssues = [
      ...staticIssues,
      ...(aiResult.additionalIssues || []).map((i: SchemaIssue) => ({
        ...i,
        severity: i.severity || 'warning',
      })),
    ];

    return {
      compatible: allIssues.filter((i) => i.severity === 'error').length === 0,
      issues: allIssues,
      refactoredSchema: aiResult.refactoredSchema || undefined,
      drizzleSchema: aiResult.drizzleSchema || undefined,
      explanation: verbose ? aiResult.explanation : undefined,
    };
  } catch (error) {
    console.error('AI analysis error:', error);

    // Fall back to static analysis
    return {
      compatible: staticIssues.filter((i) => i.severity === 'error').length === 0,
      issues: staticIssues,
      explanation: `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. Showing static analysis only.`,
    };
  }
}

// Convert SQL schema to Drizzle ORM format using AI
export async function convertToDrizzle(sqlSchema: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return generateBasicDrizzleSchema(sqlSchema);
  }

  try {
    const openai = getOpenAIClient();

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.maxTokens,
      temperature: AI_CONFIG.temperature,
      messages: [
        {
          role: 'system',
          content: `You are an expert at converting SQL schemas to Drizzle ORM TypeScript code.

Convert the SQL schema to Drizzle ORM format with these requirements:
1. Use UUID primary keys with defaultRandom()
2. Use proper Drizzle column types (text, integer, decimal, timestamp, uuid, etc.)
3. Add relations() for any foreign key relationships
4. Include proper TypeScript types
5. Make the code production-ready

Return only the TypeScript code, no explanations.`,
        },
        { role: 'user', content: `Convert this SQL to Drizzle ORM:\n\n${sqlSchema}` },
      ],
    });

    return response.choices[0]?.message?.content || generateBasicDrizzleSchema(sqlSchema);
  } catch (error) {
    console.error('Drizzle conversion error:', error);
    return generateBasicDrizzleSchema(sqlSchema);
  }
}

// Basic Drizzle schema generator (fallback)
function generateBasicDrizzleSchema(sqlSchema: string): string {
  let drizzle = `import { pgTable, uuid, text, timestamp, integer, decimal, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

`;

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
  let match;

  while ((match = tableRegex.exec(sqlSchema)) !== null) {
    const tableName = match[1];
    const columns = match[2];

    drizzle += `export const ${tableName} = pgTable('${tableName}', {\n`;

    const columnLines = columns.split(',').map((c) => c.trim()).filter(Boolean);

    for (const col of columnLines) {
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)/i.test(col)) continue;

      const colMatch = col.match(/^(\w+)\s+(\w+)/);
      if (!colMatch) continue;

      const [, colName, colType] = colMatch;
      let drizzleType = 'text';
      let extra = '';

      if (/uuid/i.test(colType)) {
        drizzleType = 'uuid';
        if (/PRIMARY\s+KEY/i.test(col)) {
          extra = ".primaryKey().defaultRandom()";
        }
      } else if (/int|serial|bigint/i.test(colType)) {
        drizzleType = 'integer';
      } else if (/decimal|numeric|money/i.test(colType)) {
        drizzleType = 'decimal';
      } else if (/timestamp|date|time/i.test(colType)) {
        drizzleType = 'timestamp';
        if (/DEFAULT\s+(NOW|CURRENT_TIMESTAMP)/i.test(col)) {
          extra = ".defaultNow()";
        }
      } else if (/bool/i.test(colType)) {
        drizzleType = 'boolean';
      } else if (/text|varchar|char/i.test(colType)) {
        drizzleType = 'text';
      }

      if (/NOT\s+NULL/i.test(col) && !extra.includes('primaryKey')) {
        extra += ".notNull()";
      }

      drizzle += `  ${colName}: ${drizzleType}('${colName}')${extra},\n`;
    }

    drizzle += `});\n\n`;
  }

  return drizzle;
}

// Validate schema against DSQL limits
export function validateDSQLLimits(
  schema: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for potential large batch inserts
  const insertMatches = schema.match(/INSERT\s+INTO[\s\S]*?VALUES[\s\S]*?\);/gi) || [];
  for (const insert of insertMatches) {
    const valueGroups = (insert.match(/\([^)]+\)/g) || []).length - 1; // -1 for column list
    if (valueGroups > 3000) {
      warnings.push(
        `INSERT statement has ${valueGroups} rows - exceeds 3,000 row limit per transaction`
      );
    }
  }

  // Check for TEXT columns that might be large
  const textCols = (schema.match(/\bTEXT\b/gi) || []).length;
  if (textCols > 5) {
    warnings.push(
      `${textCols} TEXT columns detected - large text data may exceed 10MB commit limit`
    );
  }

  // Check for potentially long transactions
  if (/BEGIN[\s\S]{5000,}COMMIT/gi.test(schema)) {
    warnings.push(
      'Transaction appears very long - keep under 5 minute execution time'
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
