// Builder state management with Zustand

import { create } from 'zustand';
import {
  BuilderNode,
  BuilderEdge,
  OperationType,
  TRANSACTION_PATTERNS,
  GeneratedCode,
} from '@/types/builder';
import { BuilderOperation } from '@/types/chat';
import { generateCode } from '@/lib/builder/code-generator';
import { v4 as uuidv4 } from 'uuid';

interface BuilderState {
  // Canvas state
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;

  // Pattern
  activePattern: string | null;

  // Generated code
  generatedCode: GeneratedCode | null;

  // Actions
  loadPattern: (patternId: string) => void;
  clearCanvas: () => void;
  addNode: (node: Omit<BuilderNode, 'id'> & { id?: string }) => string;
  updateNode: (nodeId: string, data: Partial<BuilderNode['data']>) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  addEdge: (source: string, target: string) => void;
  removeEdge: (edgeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  generateCodeFromCanvas: () => GeneratedCode;

  // Node factory helpers
  addOperationNode: (
    table: string,
    operation: OperationType,
    position?: { x: number; y: number }
  ) => string;
  addTableNode: (
    tableName: string,
    columns: string[],
    position?: { x: number; y: number }
  ) => string;

  // Load from chat agent
  loadFromOperations: (
    patternName: string,
    description: string | undefined,
    operations: BuilderOperation[]
  ) => void;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activePattern: null,
  generatedCode: null,

  loadPattern: (patternId: string) => {
    const pattern = TRANSACTION_PATTERNS.find(p => p.id === patternId);
    if (pattern) {
      set({
        nodes: pattern.nodes.map(n => ({ ...n })),
        edges: pattern.edges.map(e => ({ ...e })),
        activePattern: patternId,
        selectedNodeId: null,
      });
      // Auto-generate code
      const code = generateCode(pattern.nodes, pattern.edges);
      set({ generatedCode: code });
    }
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activePattern: null,
      generatedCode: null,
    });
  },

  addNode: (nodeData) => {
    const id = nodeData.id || uuidv4();
    const node = { ...nodeData, id } as BuilderNode;
    set(state => ({
      nodes: [...state.nodes, node],
    }));
    return id;
  },

  updateNode: (nodeId, data) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } as BuilderNode : n
      ),
    }));
  },

  removeNode: (nodeId) => {
    set(state => ({
      nodes: state.nodes.filter(n => n.id !== nodeId),
      edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },

  moveNode: (nodeId, position) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, position } : n
      ),
    }));
  },

  addEdge: (source, target) => {
    const id = `e-${source}-${target}`;
    set(state => ({
      edges: [...state.edges, { id, source, target }],
    }));
  },

  removeEdge: (edgeId) => {
    set(state => ({
      edges: state.edges.filter(e => e.id !== edgeId),
    }));
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  generateCodeFromCanvas: () => {
    const { nodes, edges } = get();
    const code = generateCode(nodes, edges);
    set({ generatedCode: code });
    return code;
  },

  addOperationNode: (table, operation, position = { x: 200, y: 150 }) => {
    const id = uuidv4();
    const node: BuilderNode = {
      id,
      type: 'operation',
      position,
      data: {
        operation,
        table,
        columns: ['*'],
        whereClause: '',
      },
    };
    set(state => ({
      nodes: [...state.nodes, node],
    }));
    return id;
  },

  addTableNode: (tableName, columns, position = { x: 50, y: 50 }) => {
    const id = uuidv4();
    const node: BuilderNode = {
      id,
      type: 'table',
      position,
      data: {
        tableName,
        columns,
      },
    };
    set(state => ({
      nodes: [...state.nodes, node],
    }));
    return id;
  },

  loadFromOperations: (patternName, description, operations) => {
    // Create nodes from operations
    const nodes: BuilderNode[] = [];
    const edges: BuilderEdge[] = [];

    // Add start node
    nodes.push({
      id: 'start',
      type: 'start',
      position: { x: 250, y: 0 },
      data: {},
    });

    // Calculate positions for operation nodes
    const operationYStart = 100;
    const operationYGap = 120;
    const operationXCenter = 200;

    // Track operations for edge creation
    const opIdToNodeId = new Map<string, string>();

    operations.forEach((op, index) => {
      const nodeId = op.id || uuidv4();
      opIdToNodeId.set(op.id, nodeId);

      // Calculate position (simple vertical layout for now)
      const y = operationYStart + index * operationYGap;

      nodes.push({
        id: nodeId,
        type: 'operation',
        position: { x: operationXCenter, y },
        data: {
          operation: op.type as OperationType,
          table: op.table,
          columns: op.columns || ['*'],
          whereClause: op.whereClause,
          setValues: op.setValues,
        },
      });
    });

    // Add end node
    const endY = operationYStart + operations.length * operationYGap;
    nodes.push({
      id: 'end',
      type: 'end',
      position: { x: 250, y: endY },
      data: { action: 'commit' },
    });

    // Create edges based on dependencies
    operations.forEach((op, index) => {
      const nodeId = opIdToNodeId.get(op.id)!;

      if (op.dependsOn && op.dependsOn.length > 0) {
        // Connect to dependencies
        op.dependsOn.forEach(depId => {
          const depNodeId = opIdToNodeId.get(depId);
          if (depNodeId) {
            edges.push({
              id: `e-${depNodeId}-${nodeId}`,
              source: depNodeId,
              target: nodeId,
            });
          }
        });
      } else if (index === 0) {
        // First operation connects to start
        edges.push({
          id: `e-start-${nodeId}`,
          source: 'start',
          target: nodeId,
        });
      } else {
        // Connect to previous operation
        const prevOp = operations[index - 1];
        const prevNodeId = opIdToNodeId.get(prevOp.id)!;
        edges.push({
          id: `e-${prevNodeId}-${nodeId}`,
          source: prevNodeId,
          target: nodeId,
        });
      }
    });

    // Connect last operation(s) to end
    // Find operations that no other operation depends on
    const targetedOps = new Set<string>();
    operations.forEach(op => {
      op.dependsOn?.forEach(depId => targetedOps.add(depId));
    });

    operations.forEach(op => {
      const isLeaf = !operations.some(other => other.dependsOn?.includes(op.id));
      if (isLeaf) {
        const nodeId = opIdToNodeId.get(op.id)!;
        edges.push({
          id: `e-${nodeId}-end`,
          source: nodeId,
          target: 'end',
        });
      }
    });

    // Update state
    set({
      nodes,
      edges,
      activePattern: patternName,
      selectedNodeId: null,
    });

    // Auto-generate code
    const code = generateCode(nodes, edges);
    set({ generatedCode: code });
  },
}));

// Selector hooks
export const useBuilderNodes = () => useBuilderStore(state => state.nodes);
export const useBuilderEdges = () => useBuilderStore(state => state.edges);
export const useSelectedNode = () => {
  const selectedId = useBuilderStore(state => state.selectedNodeId);
  const nodes = useBuilderStore(state => state.nodes);
  return nodes.find(n => n.id === selectedId);
};
export const useGeneratedCode = () => useBuilderStore(state => state.generatedCode);
