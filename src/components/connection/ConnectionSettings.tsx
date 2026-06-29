'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Database,
  Loader2,
  CheckCircle,
  XCircle,
  Settings,
  Plug,
  Table2,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useConnectionStore } from '@/hooks/useConnection';
import { toast } from 'sonner';

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'eu-north-1', label: 'Europe (Stockholm)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
];

export function ConnectionSettings() {
  const {
    config,
    status,
    isConnecting,
    isSettingUp,
    setConfig,
    setSecrets,
    testConnection,
    setupTestTables,
    disconnect,
  } = useConnectionStore();

  const [open, setOpen] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [localSecrets, setLocalSecrets] = useState({
    accessKeyId: '',
    secretAccessKey: '',
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    tables?: string[];
  } | null>(null);

  // Reset test result when dialog opens
  useEffect(() => {
    if (open) {
      setTestResult(null);
    }
  }, [open]);

  const handleTestConnection = async () => {
    // Set secrets before testing
    setSecrets(localSecrets.accessKeyId, localSecrets.secretAccessKey);

    const result = await testConnection();
    setTestResult(result);

    if (result.success) {
      toast.success('Connected to DSQL cluster', {
        description: `Found ${result.tables?.length || 0} tables`,
      });
    } else {
      toast.error('Connection failed', {
        description: result.message,
      });
    }
  };

  const handleSetupTables = async () => {
    const result = await setupTestTables();

    if (result.success) {
      toast.success('Test tables created', {
        description: result.message,
      });
      // Refresh connection to update table list
      await testConnection();
    } else {
      toast.error('Setup failed', {
        description: result.message,
      });
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setLocalSecrets({ accessKeyId: '', secretAccessKey: '' });
    setTestResult(null);
    toast.info('Disconnected from DSQL cluster');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 border-white/[0.06] bg-white/[0.02] text-white/60 hover:bg-white/5 hover:text-white/90">
            {status.connected ? (
              <>
                <CheckCircle className="h-4 w-4 text-white/60" />
                <span className="hidden sm:inline">Connected</span>
              </>
            ) : (
              <>
                <Database className="h-4 w-4" />
                <span className="hidden sm:inline">Connect DSQL</span>
              </>
            )}
          </Button>
        }
      />

      <DialogContent className="sm:max-w-[500px] bg-black border-white/[0.06] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white/90">
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
              <Settings className="h-3.5 w-3.5 text-white/70" />
            </div>
            DSQL Connection Settings
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Connect to your Aurora DSQL cluster to run transactions and tests.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Connection Status */}
          {status.connected && (
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-white/60 mt-0.5" />
                <div>
                  <p className="text-sm text-white/80">
                    Connected to <strong>{status.clusterEndpoint}</strong>
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Region: {status.region} | Database: {status.database}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status.error && (
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.08]">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-white/60 mt-0.5" />
                <p className="text-sm text-white/70">{status.error}</p>
              </div>
            </div>
          )}

          <div className="h-px bg-white/[0.06]" />

          {/* Cluster Endpoint */}
          <div className="space-y-2">
            <Label htmlFor="endpoint" className="text-white/70">Cluster Endpoint</Label>
            <Input
              id="endpoint"
              placeholder="xxx.dsql.us-east-1.on.aws"
              value={config.clusterEndpoint || ''}
              onChange={(e) => setConfig({ clusterEndpoint: e.target.value })}
              disabled={isConnecting}
              className="bg-white/[0.02] border-white/[0.06] text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
            />
            <p className="text-xs text-white/30">
              Find this in the AWS DSQL console under cluster details
            </p>
          </div>

          {/* Region */}
          <div className="space-y-2">
            <Label htmlFor="region" className="text-white/70">AWS Region</Label>
            <Select
              value={config.region || 'us-east-1'}
              onValueChange={(value) => setConfig({ region: value || undefined })}
              disabled={isConnecting}
            >
              <SelectTrigger className="bg-white/[0.02] border-white/[0.06] text-white/80">
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent className="bg-black border-white/[0.06]">
                {AWS_REGIONS.map((region) => (
                  <SelectItem key={region.value} value={region.value} className="text-white/70 focus:bg-white/5 focus:text-white">
                    {region.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Database */}
          <div className="space-y-2">
            <Label htmlFor="database" className="text-white/70">Database</Label>
            <Input
              id="database"
              placeholder="postgres"
              value={config.database || 'postgres'}
              onChange={(e) => setConfig({ database: e.target.value })}
              disabled={isConnecting}
              className="bg-white/[0.02] border-white/[0.06] text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
            />
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* AWS Credentials */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-white/70">AWS Credentials</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSecrets(!showSecrets)}
                className="h-6 px-2 text-white/40 hover:text-white hover:bg-white/5"
              >
                {showSecrets ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-white/50 mt-0.5" />
                <p className="text-xs text-white/50">
                  Credentials are stored in memory only and never persisted.
                  You'll need to re-enter them after refreshing.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessKeyId" className="text-white/70">Access Key ID</Label>
            <Input
              id="accessKeyId"
              type={showSecrets ? 'text' : 'password'}
              placeholder="AKIA..."
              value={localSecrets.accessKeyId}
              onChange={(e) =>
                setLocalSecrets((s) => ({ ...s, accessKeyId: e.target.value }))
              }
              disabled={isConnecting}
              className="bg-white/[0.02] border-white/[0.06] text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secretAccessKey" className="text-white/70">Secret Access Key</Label>
            <Input
              id="secretAccessKey"
              type={showSecrets ? 'text' : 'password'}
              placeholder="••••••••"
              value={localSecrets.secretAccessKey}
              onChange={(e) =>
                setLocalSecrets((s) => ({ ...s, secretAccessKey: e.target.value }))
              }
              disabled={isConnecting}
              className="bg-white/[0.02] border-white/[0.06] text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div className="space-y-2">
              <div className="h-px bg-white/[0.06]" />
              <div className="text-sm">
                <span className="font-medium text-white/70">Tables Found:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {testResult.tables && testResult.tables.length > 0 ? (
                    testResult.tables.map((table) => (
                      <span key={table} className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70">
                        {table}
                      </span>
                    ))
                  ) : (
                    <span className="text-white/40 text-xs">
                      No tables found. Click "Setup Test Tables" to create them.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {status.connected && (
            <Button
              variant="outline"
              onClick={handleDisconnect}
              className="w-full sm:w-auto border-white/[0.06] text-white/50 hover:bg-white/5 hover:text-white/70"
            >
              Disconnect
            </Button>
          )}

          {status.connected && (
            <Button
              variant="outline"
              onClick={handleSetupTables}
              disabled={isSettingUp}
              className="w-full sm:w-auto gap-2 border-white/[0.06] text-white/60 hover:bg-white/5 hover:text-white/80"
            >
              {isSettingUp ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Table2 className="h-4 w-4" />
              )}
              Setup Test Tables
            </Button>
          )}

          <Button
            onClick={handleTestConnection}
            disabled={
              isConnecting ||
              !config.clusterEndpoint ||
              !localSecrets.accessKeyId ||
              !localSecrets.secretAccessKey
            }
            className="w-full sm:w-auto gap-2 bg-white text-black hover:bg-white/90"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            {status.connected ? 'Reconnect' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
