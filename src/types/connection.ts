// Connection management types

export interface ConnectionConfig {
  clusterEndpoint: string;
  region: string;
  database: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ConnectionStatus {
  connected: boolean;
  clusterEndpoint: string | null;
  region: string | null;
  database: string | null;
  lastConnectedAt: number | null;
  error: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  version?: string;
  tables?: string[];
}

export interface SetupTablesResult {
  success: boolean;
  message: string;
  tablesCreated: string[];
  errors: string[];
}

// Test tables SQL
export const TEST_TABLES_SQL = `
-- Accounts table for balance transfer tests
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  balance DECIMAL(15,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test accounts if they don't exist
INSERT INTO accounts (id, name, balance)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 10000.00),
  ('22222222-2222-2222-2222-222222222222', 'Bob', 10000.00),
  ('33333333-3333-3333-3333-333333333333', 'Charlie', 10000.00)
ON CONFLICT (id) DO NOTHING;

-- Counters table for atomic counter tests
CREATE TABLE IF NOT EXISTS counters (
  id VARCHAR(50) PRIMARY KEY,
  value INTEGER DEFAULT 0,
  update_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test counter if it doesn't exist
INSERT INTO counters (id, value, update_count)
VALUES ('hot_counter', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Inventory table for checkout/reservation tests
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name VARCHAR(100) NOT NULL,
  quantity INTEGER DEFAULT 0,
  reserved INTEGER DEFAULT 0,
  price DECIMAL(10,2) DEFAULT 0.00
);

-- Insert test inventory if empty
INSERT INTO inventory (id, product_name, quantity, reserved, price)
SELECT * FROM (VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Widget A', 100, 0, 29.99),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Widget B', 50, 0, 49.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'Widget C', 25, 0, 99.99)
) AS t(id, product_name, quantity, reserved, price)
WHERE NOT EXISTS (SELECT 1 FROM inventory LIMIT 1);

-- Orders table for checkout tests
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name VARCHAR(100),
  product_id UUID REFERENCES inventory(id),
  quantity INTEGER NOT NULL,
  total_amount DECIMAL(15,2),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
