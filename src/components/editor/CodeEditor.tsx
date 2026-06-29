'use client';

import { useCallback, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Copy, RotateCcw } from 'lucide-react';
import { TEMPLATES, CodeTemplate, getAllCategories } from '@/lib/sandbox/templates';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  onRun: () => void;
  isRunning: boolean;
  language: 'typescript' | 'sql';
  onLanguageChange: (lang: 'typescript' | 'sql') => void;
}

export function CodeEditor({
  code,
  onChange,
  onRun,
  isRunning,
  language,
  onLanguageChange,
}: CodeEditorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('basic');

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onChange(value || '');
    },
    [onChange]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const template = TEMPLATES.find((t) => t.id === templateId);
      if (template) {
        onChange(template.code);
        onLanguageChange(template.language);
      }
    },
    [onChange, onLanguageChange]
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
  }, [code]);

  const handleReset = useCallback(() => {
    onChange('');
  }, [onChange]);

  const filteredTemplates = TEMPLATES.filter(
    (t) => t.category === selectedCategory
  );

  return (
    <div className="flex flex-col h-full bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-white/90">Editor</span>
          <div className="flex items-center gap-2">
            <Select value={language} onValueChange={(v) => onLanguageChange(v as 'typescript' | 'sql')}>
              <SelectTrigger className="w-28 h-8 text-xs bg-white/[0.02] border-white/[0.06] text-white/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-black border-white/[0.06]">
                <SelectItem value="typescript" className="text-white/70 focus:bg-white/5 focus:text-white">TypeScript</SelectItem>
                <SelectItem value="sql" className="text-white/70 focus:bg-white/5 focus:text-white">SQL</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={handleCopy} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleReset} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 mb-2">
          {getAllCategories().map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                selectedCategory === category
                  ? 'bg-white/10 text-white/90'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Templates */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {filteredTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleTemplateSelect(template.id)}
              className="shrink-0 px-2.5 py-1 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 rounded-md transition-colors"
            >
              {template.name}
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language === 'typescript' ? 'typescript' : 'sql'}
          theme="vs-dark"
          value={code}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 12 },
            lineNumbersMinChars: 3,
            folding: false,
            renderLineHighlight: 'none',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
          }}
        />
      </div>

      {/* Run button */}
      <div className="p-3 border-t border-white/[0.06]">
        <Button
          className="w-full bg-white text-black hover:bg-white/90 font-medium"
          onClick={onRun}
          disabled={isRunning || !code.trim()}
        >
          {isRunning ? (
            <>
              <span className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
