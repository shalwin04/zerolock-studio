// Visual Transaction Builder types

export type OperationType = 'select' | 'select_for_update' | 'update' | 'insert' | 'delete';

export interface TableNode {
  id: string;
  type: 'table';
  position: { x: number; y: number };
  data: {
    tableName: string;
    columns: string[];
    primaryKey?: string;
  };
}

export interface OperationNode {
  id: string;
  type: 'operation';
  position: { x: number; y: number };
  data: {
    operation: OperationType;
    table: string;
    columns: string[];
    whereClause?: string;
    setValues?: Record<string, string>;
  };
}

export interface StartNode {
  id: string;
  type: 'start';
  position: { x: number; y: number };
  data: Record<string, never>;
}

export interface EndNode {
  id: string;
  type: 'end';
  position: { x: number; y: number };
  data: {
    action: 'commit' | 'rollback';
  };
}

export type BuilderNode = TableNode | OperationNode | StartNode | EndNode;

export interface BuilderEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface TransactionPattern {
  id: string;
  name: string;
  description: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

export interface GeneratedCode {
  typescript: string;
  sql: string;
}

export interface BuilderState {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNode: string | null;
  pattern: string | null;
}

// Pre-built patterns
export const TRANSACTION_PATTERNS: TransactionPattern[] = [
  {
    id: 'transfer',
    name: 'Balance Transfer',
    description: 'Transfer funds between two accounts with proper locking',
    nodes: [
      { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: {} },
      {
        id: 'select-from',
        type: 'operation',
        position: { x: 100, y: 100 },
        data: {
          operation: 'select_for_update',
          table: 'accounts',
          columns: ['balance'],
          whereClause: 'id = $fromId',
        },
      },
      {
        id: 'select-to',
        type: 'operation',
        position: { x: 400, y: 100 },
        data: {
          operation: 'select_for_update',
          table: 'accounts',
          columns: ['balance'],
          whereClause: 'id = $toId',
        },
      },
      {
        id: 'update-from',
        type: 'operation',
        position: { x: 100, y: 220 },
        data: {
          operation: 'update',
          table: 'accounts',
          columns: ['balance'],
          whereClause: 'id = $fromId',
          setValues: { balance: 'balance - $amount' },
        },
      },
      {
        id: 'update-to',
        type: 'operation',
        position: { x: 400, y: 220 },
        data: {
          operation: 'update',
          table: 'accounts',
          columns: ['balance'],
          whereClause: 'id = $toId',
          setValues: { balance: 'balance + $amount' },
        },
      },
      { id: 'end', type: 'end', position: { x: 250, y: 340 }, data: { action: 'commit' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'select-from' },
      { id: 'e2', source: 'start', target: 'select-to' },
      { id: 'e3', source: 'select-from', target: 'update-from' },
      { id: 'e4', source: 'select-to', target: 'update-to' },
      { id: 'e5', source: 'update-from', target: 'end' },
      { id: 'e6', source: 'update-to', target: 'end' },
    ],
  },
  {
    id: 'counter',
    name: 'Atomic Counter',
    description: 'Atomically increment a counter value',
    nodes: [
      { id: 'start', type: 'start', position: { x: 200, y: 0 }, data: {} },
      {
        id: 'update-counter',
        type: 'operation',
        position: { x: 150, y: 100 },
        data: {
          operation: 'update',
          table: 'counters',
          columns: ['value'],
          whereClause: 'id = $counterId',
          setValues: { value: 'value + 1' },
        },
      },
      { id: 'end', type: 'end', position: { x: 200, y: 220 }, data: { action: 'commit' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'update-counter' },
      { id: 'e2', source: 'update-counter', target: 'end' },
    ],
  },
  {
    id: 'read-modify-write',
    name: 'Read-Modify-Write',
    description: 'Read a value, modify it, and write back with locking',
    nodes: [
      { id: 'start', type: 'start', position: { x: 200, y: 0 }, data: {} },
      {
        id: 'select',
        type: 'operation',
        position: { x: 150, y: 100 },
        data: {
          operation: 'select_for_update',
          table: 'data',
          columns: ['value'],
          whereClause: 'id = $id',
        },
      },
      {
        id: 'update',
        type: 'operation',
        position: { x: 150, y: 220 },
        data: {
          operation: 'update',
          table: 'data',
          columns: ['value'],
          whereClause: 'id = $id',
          setValues: { value: '$newValue' },
        },
      },
      { id: 'end', type: 'end', position: { x: 200, y: 340 }, data: { action: 'commit' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'select' },
      { id: 'e2', source: 'select', target: 'update' },
      { id: 'e3', source: 'update', target: 'end' },
    ],
  },
];
