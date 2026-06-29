-- Zero-Lock Studio Demo Setup Script
-- Run this in your DSQL cluster before the demo

-- Drop existing tables (clean slate)
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS counters CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- ============================================
-- ACCOUNTS TABLE (Balance Transfer Demo)
-- ============================================
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    balance DECIMAL(15,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test accounts with $10,000 each
INSERT INTO accounts (id, name, balance) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Alice', 10000.00),
    ('22222222-2222-2222-2222-222222222222', 'Bob', 10000.00),
    ('33333333-3333-3333-3333-333333333333', 'Charlie', 10000.00),
    ('44444444-4444-4444-4444-444444444444', 'Diana', 10000.00),
    ('55555555-5555-5555-5555-555555555555', 'Eve', 10000.00);

-- ============================================
-- COUNTERS TABLE (Hot Key Demo)
-- ============================================
CREATE TABLE counters (
    id VARCHAR(50) PRIMARY KEY,
    value INTEGER DEFAULT 0,
    update_count INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert hot counter (single row = maximum contention)
INSERT INTO counters (id, value, update_count) VALUES
    ('hot_counter', 0, 0),
    ('page_views', 0, 0),
    ('order_sequence', 1000, 0);

-- ============================================
-- INVENTORY TABLE (E-commerce Demo)
-- ============================================
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name VARCHAR(100) NOT NULL,
    sku VARCHAR(50) UNIQUE,
    quantity INTEGER DEFAULT 0,
    reserved INTEGER DEFAULT 0,
    price DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert products with limited inventory (creates contention)
INSERT INTO inventory (id, product_name, sku, quantity, reserved, price) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Limited Edition Widget', 'WDG-001', 10, 0, 299.99),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Premium Gadget', 'GDG-001', 25, 0, 149.99),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Standard Item', 'STD-001', 100, 0, 49.99),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Flash Sale Special', 'FLS-001', 5, 0, 999.99);

-- ============================================
-- ORDERS TABLE (Checkout Demo)
-- ============================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(20) UNIQUE,
    customer_name VARCHAR(100),
    product_id UUID REFERENCES inventory(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2),
    total_amount DECIMAL(15,2),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipped', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- VERIFY SETUP
-- ============================================
SELECT 'Setup Complete!' as status;
SELECT 'Accounts:' as table_name, COUNT(*) as row_count FROM accounts
UNION ALL
SELECT 'Counters:', COUNT(*) FROM counters
UNION ALL
SELECT 'Inventory:', COUNT(*) FROM inventory
UNION ALL
SELECT 'Orders:', COUNT(*) FROM orders;
