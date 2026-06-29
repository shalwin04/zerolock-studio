'use client';

import { useCallback, useMemo, memo, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PlayCircle,
  Trash2,
  Code2,
  Database,
  GitBranch,
  Copy,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { useBuilderStore, useGeneratedCode } from '@/hooks/useBuilder';
import { TRANSACTION_PATTERNS, OperationNode } from '@/types/builder';

// Custom node components - memoized to prevent re-renders
const StartNodeComponent = memo(function StartNodeComponent() {
  return (
    <div className="px-4 py-2 bg-white text-black rounded-full text-sm font-medium shadow-lg">
      <Handle type="source" position={Position.Bottom} className="!bg-white/50" />
      BEGIN
    </div>
  );
});

const EndNodeComponent = memo(function EndNodeComponent({ data }: { data: { action: 'commit' | 'rollback' } }) {
  const isCommit = data.action === 'commit';
  return (
    <div className={`px-4 py-2 ${isCommit ? 'bg-white text-black' : 'bg-white/20 text-white'} rounded-full text-sm font-medium shadow-lg`}>
      <Handle type="target" position={Position.Top} className={isCommit ? '!bg-white/50' : '!bg-white/30'} />
      {isCommit ? 'COMMIT' : 'ROLLBACK'}
    </div>
  );
});

const OperationNodeComponent = memo(function OperationNodeComponent({ data, selected }: { data: OperationNode['data']; selected?: boolean }) {
  const opStyles: Record<string, string> = {
    select: 'bg-white/10 border-white/20 text-white/80',
    select_for_update: 'bg-white/15 border-white/30 text-white/90',
    update: 'bg-white/10 border-white/20 text-white/80',
    insert: 'bg-white/10 border-white/20 text-white/80',
    delete: 'bg-white/15 border-white/25 text-white/85',
  };

  const opLabels: Record<string, string> = {
    select: 'SELECT',
    select_for_update: 'SELECT FOR UPDATE',
    update: 'UPDATE',
    insert: 'INSERT',
    delete: 'DELETE',
  };

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-lg min-w-[140px] backdrop-blur-sm ${opStyles[data.operation]} ${selected ? 'ring-2 ring-white/50' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/40" />
      <div className="text-xs font-bold mb-1 text-white/60">{opLabels[data.operation]}</div>
      <div className="text-sm font-mono text-white">{data.table}</div>
      {data.whereClause && (
        <div className="text-[10px] mt-1 opacity-60 truncate max-w-[150px]">
          WHERE {data.whereClause}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-white/40" />
    </div>
  );
});

const TableNodeComponent = memo(function TableNodeComponent({ data }: { data: { tableName: string; columns: string[] } }) {
  return (
    <div className="px-3 py-2 rounded-lg border-2 border-white/20 bg-black/80 shadow-lg min-w-[120px] backdrop-blur-sm">
      <div className="flex items-center gap-1 mb-1">
        <Database className="h-3 w-3 text-white/50" />
        <span className="text-sm font-bold text-white">{data.tableName}</span>
      </div>
      <div className="text-[10px] text-white/40">
        {data.columns.slice(0, 3).join(', ')}
        {data.columns.length > 3 && '...'}
      </div>
    </div>
  );
});

// Define nodeTypes outside component to prevent recreation
const nodeTypes: NodeTypes = {
  start: StartNodeComponent,
  end: EndNodeComponent,
  operation: OperationNodeComponent,
  table: TableNodeComponent,
};

interface TransactionBuilderProps {
  onSyncToEditor?: (code: string, language: 'typescript' | 'sql') => void;
  onRunTest?: (code: string, concurrentUsers?: number) => void;
}

export function TransactionBuilder({ onSyncToEditor, onRunTest }: TransactionBuilderProps) {
  const {
    nodes: builderNodes,
    edges: builderEdges,
    loadPattern,
    clearCanvas,
    generateCodeFromCanvas,
    activePattern,
  } = useBuilderStore();

  const generatedCode = useGeneratedCode();

  // Convert builder nodes to React Flow nodes
  const flowNodes: Node[] = useMemo(() =>
    builderNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    [builderNodes]
  );

  // Convert builder edges to React Flow edges
  const flowEdges: Edge[] = useMemo(() =>
    builderEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: 'rgba(255,255,255,0.3)' },
    })),
    [builderEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync React Flow state with builder store when patterns load
  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handlePatternChange = (patternId: string | null) => {
    if (patternId) {
      loadPattern(patternId);
    }
  };

  const handleGenerate = () => {
    const code = generateCodeFromCanvas();
    if (code) {
      toast.success('Code generated', {
        description: 'TypeScript and SQL code ready',
      });
    }
  };

  const handleSyncToEditor = (language: 'typescript' | 'sql') => {
    if (generatedCode && onSyncToEditor) {
      const code = language === 'typescript' ? generatedCode.typescript : generatedCode.sql;
      onSyncToEditor(code, language);
      toast.success(`Synced to editor`, {
        description: `${language === 'typescript' ? 'TypeScript' : 'SQL'} code copied to editor`,
      });
    } else if (!generatedCode) {
      toast.error('No code generated', {
        description: 'Click Generate first',
      });
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    toast.success('Copied to clipboard');
  };

  const handleRunTest = async () => {
    // Generate code first if not already generated
    let code = generatedCode;
    if (!code) {
      code = generateCodeFromCanvas();
    }

    if (code && onRunTest) {
      onRunTest(code.typescript);
      toast.success('Running test...', {
        description: 'Check the Telemetry panel for results',
      });
    } else if (!code) {
      toast.error('No flow to test', {
        description: 'Create a transaction flow first',
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
              <GitBranch className="h-3.5 w-3.5 text-white/70" />
            </div>
            <span className="text-sm font-medium text-white/90">Transaction Builder</span>
          </div>
          <div className="flex items-center gap-2">
            <Select value={activePattern || ''} onValueChange={handlePatternChange}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-white/[0.02] border-white/[0.06] text-white/70">
                <SelectValue placeholder="Load pattern..." />
              </SelectTrigger>
              <SelectContent className="bg-black border-white/[0.06]">
                {TRANSACTION_PATTERNS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs text-white/70 focus:bg-white/5 focus:text-white">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={clearCanvas} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {activePattern && (
          <p className="text-xs text-white/30 mt-1">
            {TRANSACTION_PATTERNS.find(p => p.id === activePattern)?.description}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Canvas */}
        <div className="flex-1 min-h-0 border-b border-white/[0.06]">
          {nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40 text-sm p-4">
              <div className="w-14 h-14 rounded-xl bg-white/[0.03] flex items-center justify-center border border-white/[0.06] mb-3">
                <GitBranch className="h-7 w-7 text-white/40" />
              </div>
              <p className="text-center mb-4 text-white/50">
                Select a pattern to visualize a transaction flow, or build your own.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {TRANSACTION_PATTERNS.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    size="sm"
                    className="text-xs border-white/[0.06] text-white/50 hover:bg-white/5 hover:text-white/70"
                    onClick={() => handlePatternChange(p.id)}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              className="bg-black"
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(255,255,255,0.03)" />
              <Controls className="!bg-black !border-white/[0.06] !shadow-lg [&_button]:!bg-white/5 [&_button]:!border-white/[0.06] [&_button]:!text-white/60 [&_button:hover]:!bg-white/10" />
            </ReactFlow>
          )}
        </div>

        {/* Code Preview */}
        {nodes.length > 0 && (
          <div className="h-48 shrink-0 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-center gap-2 text-white">
                <Code2 className="h-4 w-4 text-white/50" />
                <span className="text-sm font-medium text-white/70">Generated Code</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs border-white/[0.06] text-white/50 hover:bg-white/5 hover:text-white/70" onClick={handleGenerate}>
                  <PlayCircle className="h-3 w-3 mr-1" />
                  Generate
                </Button>
                {generatedCode && (
                  <>
                    {onSyncToEditor && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-white text-black hover:bg-white/90"
                          onClick={() => handleSyncToEditor('typescript')}
                        >
                          Sync TS
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-white/[0.06] text-white/50 hover:bg-white/5 hover:text-white/70"
                          onClick={() => handleSyncToEditor('sql')}
                        >
                          Sync SQL
                        </Button>
                      </>
                    )}
                    {onRunTest && (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-white/10 text-white/90 hover:bg-white/15"
                        onClick={handleRunTest}
                      >
                        <Zap className="h-3 w-3 mr-1" />
                        Test Flow
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {generatedCode ? (
              <Tabs defaultValue="typescript" className="flex-1 min-h-0">
                <TabsList className="mx-2 mt-1 h-7 bg-white/[0.02]">
                  <TabsTrigger value="typescript" className="text-xs h-6 text-white/50 data-[state=active]:bg-white/10 data-[state=active]:text-white/90">TypeScript</TabsTrigger>
                  <TabsTrigger value="sql" className="text-xs h-6 text-white/50 data-[state=active]:bg-white/10 data-[state=active]:text-white/90">SQL</TabsTrigger>
                </TabsList>
                <TabsContent value="typescript" className="flex-1 min-h-0 mt-0 px-2">
                  <ScrollArea className="h-24">
                    <pre className="text-[10px] font-mono bg-white/[0.02] p-2 rounded-lg border border-white/[0.06] relative group text-white/70">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-white/40 hover:text-white hover:bg-white/10"
                        onClick={() => handleCopyCode(generatedCode.typescript)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      {generatedCode.typescript}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="sql" className="flex-1 min-h-0 mt-0 px-2">
                  <ScrollArea className="h-24">
                    <pre className="text-[10px] font-mono bg-white/[0.02] p-2 rounded-lg border border-white/[0.06] relative group text-white/70">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-white/40 hover:text-white hover:bg-white/10"
                        onClick={() => handleCopyCode(generatedCode.sql)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      {generatedCode.sql}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
                Click Generate to create code from the flow
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
