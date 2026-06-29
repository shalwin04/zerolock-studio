// Transaction code templates for Zero-Lock Studio

export interface CodeTemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'conflict' | 'retry' | 'batch' | 'advanced';
  language: 'typescript' | 'sql';
  code: string;
  highlightLines?: number[];  // Lines to highlight for learning
}

export const TEMPLATES: CodeTemplate[] = [
  // Basic Operations
  {
    id: 'simple-insert',
    name: 'Simple Insert',
    description: 'Basic INSERT operation with UUID primary key',
    category: 'basic',
    language: 'typescript',
    code: `import { Client } from 'pg';

async function insertUser(client: Client) {
  const result = await client.query(\`
    INSERT INTO users (id, name, email, created_at)
    VALUES (gen_random_uuid(), $1, $2, NOW())
    RETURNING *
  \`, ['John Doe', 'john@example.com']);

  return result.rows[0];
}`,
  },
  {
    id: 'simple-select',
    name: 'Simple Query',
    description: 'Basic SELECT with pagination',
    category: 'basic',
    language: 'typescript',
    code: `import { Client } from 'pg';

async function getUsers(client: Client, limit = 10, offset = 0) {
  const result = await client.query(\`
    SELECT id, name, email, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  \`, [limit, offset]);

  return result.rows;
}`,
  },

  // Conflict-Prone Operations
  {
    id: 'balance-transfer',
    name: 'Balance Transfer (Conflict-Prone)',
    description: 'Classic example that triggers OCC conflicts under concurrency',
    category: 'conflict',
    language: 'typescript',
    highlightLines: [8, 9, 14, 15],
    code: `import { Client } from 'pg';

async function transfer(client: Client, fromId: string, toId: string, amount: number) {
  await client.query('BEGIN');

  try {
    // Read both balances (creates read-set)
    const fromResult = await client.query('SELECT balance FROM accounts WHERE id = $1', [fromId]);
    const toResult = await client.query('SELECT balance FROM accounts WHERE id = $1', [toId]);

    const fromBalance = fromResult.rows[0].balance;
    const toBalance = toResult.rows[0].balance;

    // Update both accounts (creates write-set)
    // This is where OCC conflicts happen under concurrency!
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [fromBalance - amount, fromId]);
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [toBalance + amount, toId]);

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}`,
  },
  {
    id: 'counter-increment',
    name: 'Counter Increment (Hot Key)',
    description: 'Incrementing a shared counter - guaranteed conflicts',
    category: 'conflict',
    language: 'typescript',
    code: `import { Client } from 'pg';

// ANTI-PATTERN: This will cause massive conflicts under load
async function incrementCounterBad(client: Client, counterId: string) {
  await client.query('BEGIN');

  // Read current value
  const result = await client.query('SELECT value FROM counters WHERE id = $1', [counterId]);
  const currentValue = result.rows[0].value;

  // Increment and write back - race condition here!
  await client.query('UPDATE counters SET value = $1 WHERE id = $2', [currentValue + 1, counterId]);

  await client.query('COMMIT');
}

// BETTER: Use atomic increment
async function incrementCounterGood(client: Client, counterId: string) {
  await client.query(\`
    UPDATE counters
    SET value = value + 1
    WHERE id = $1
  \`, [counterId]);
}`,
  },

  // Retry Patterns
  {
    id: 'retry-exponential',
    name: 'Exponential Backoff with Jitter',
    description: 'Production-ready retry pattern for OCC conflicts',
    category: 'retry',
    language: 'typescript',
    highlightLines: [6, 7, 8, 23, 24, 25],
    code: `import { Client } from 'pg';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;
const MAX_DELAY_MS = 5000;

// Full jitter exponential backoff formula:
// delay = random(0, min(MAX_DELAY, BASE_DELAY * 2^attempt))
function calculateDelay(attempt: number): number {
  const maxDelay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt));
  return Math.random() * maxDelay;
}

async function executeWithRetry<T>(
  client: Client,
  operation: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      // Check if it's an OCC conflict (40001)
      if (error.code === '40001' && attempt < MAX_RETRIES) {
        const delay = calculateDelay(attempt);
        console.log(\`Conflict detected, retry #\${attempt + 1} after \${delay.toFixed(0)}ms\`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}`,
  },
  {
    id: 'retry-bad',
    name: 'Fixed Interval Retry (Anti-Pattern)',
    description: 'Shows what NOT to do - causes retry storms',
    category: 'retry',
    language: 'typescript',
    highlightLines: [8, 9],
    code: `import { Client } from 'pg';

// ANTI-PATTERN: Fixed delay causes "retry storms"
// When many clients retry at the same interval, they keep colliding!
async function executeWithBadRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      if (error.code === '40001') {
        // BAD: Fixed 100ms delay - all clients retry together!
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}`,
  },

  // Batch Operations
  {
    id: 'batch-insert',
    name: 'Chunked Batch Insert',
    description: 'Insert large datasets within DSQL limits (3000 rows max)',
    category: 'batch',
    language: 'typescript',
    code: `import { Client } from 'pg';

const DSQL_MAX_ROWS = 3000;
const BATCH_SIZE = 500;  // Safe batch size

interface User {
  name: string;
  email: string;
}

async function batchInsertUsers(client: Client, users: User[]) {
  const results = [];

  // Process in chunks to stay within DSQL limits
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    // Build multi-row INSERT
    const values = batch.map((_, idx) =>
      \`(gen_random_uuid(), $\${idx * 2 + 1}, $\${idx * 2 + 2}, NOW())\`
    ).join(', ');

    const params = batch.flatMap(u => [u.name, u.email]);

    const result = await client.query(\`
      INSERT INTO users (id, name, email, created_at)
      VALUES \${values}
      RETURNING id
    \`, params);

    results.push(...result.rows);
  }

  return results;
}`,
  },

  // Advanced Patterns
  {
    id: 'select-for-update',
    name: 'SELECT FOR UPDATE Guard',
    description: 'Prevent write-skew with explicit row locking',
    category: 'advanced',
    language: 'typescript',
    highlightLines: [11],
    code: `import { Client } from 'pg';

// Prevent write-skew by locking rows during read
// This turns potential silent corruption into a catchable 40001 error
async function safeTransfer(client: Client, fromId: string, toId: string, amount: number) {
  await client.query('BEGIN');

  try {
    // FOR UPDATE locks these rows until commit/rollback
    // Other transactions reading same rows will wait or conflict
    const result = await client.query(\`
      SELECT id, balance FROM accounts
      WHERE id IN ($1, $2)
      FOR UPDATE
    \`, [fromId, toId]);

    const accounts = new Map(result.rows.map(r => [r.id, r.balance]));
    const fromBalance = accounts.get(fromId);
    const toBalance = accounts.get(toId);

    if (fromBalance < amount) {
      throw new Error('Insufficient funds');
    }

    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [fromBalance - amount, fromId]);
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [toBalance + amount, toId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}`,
  },
  {
    id: 'distributed-uuid',
    name: 'Distributed UUID Keys',
    description: 'Using UUIDs to avoid write hotspots',
    category: 'advanced',
    language: 'sql',
    code: `-- ANTI-PATTERN: Sequential IDs cause hotspots
CREATE TABLE orders_bad (
  id SERIAL PRIMARY KEY,  -- Sequential = all writes to same shard
  customer_id UUID,
  total DECIMAL
);

-- CORRECT: Distributed UUIDs spread writes across shards
CREATE TABLE orders_good (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID,
  total DECIMAL
);

-- Even better: Use customer_id prefix for locality
CREATE TABLE orders_partitioned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  total DECIMAL,
  -- Orders for same customer are co-located
  -- Reduces cross-shard transactions
  UNIQUE (customer_id, id)
);`,
  },
];

export function getTemplateById(id: string): CodeTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: CodeTemplate['category']): CodeTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}

export function getAllCategories(): CodeTemplate['category'][] {
  return ['basic', 'conflict', 'retry', 'batch', 'advanced'];
}
