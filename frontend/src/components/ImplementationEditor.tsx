import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import type { AdapterImplementationSymbol } from '@comiccrawler/shared';
import type { OnMount } from '@monaco-editor/react';

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));
const MonacoDiffEditor = React.lazy(async () => {
  const module = await import('@monaco-editor/react');
  return { default: module.DiffEditor };
});

type EditorLanguage = 'typescript' | 'json' | 'markdown';

interface ImplementationEditorProps {
  content: string;
  language: EditorLanguage;
  outline: AdapterImplementationSymbol[];
  selectedSymbolId?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

interface ImplementationDiffEditorProps {
  originalContent: string;
  modifiedContent: string;
  language: EditorLanguage;
  readOnly?: boolean;
}

interface MonacoEditorRef {
  revealLineInCenter?: (lineNumber: number) => void;
  setPosition?: (position: { lineNumber: number; column: number }) => void;
  deltaDecorations?: (
    oldDecorations: string[],
    newDecorations: Array<{
      range: unknown;
      options: Record<string, unknown>;
    }>
  ) => string[];
}

interface MonacoApiRef {
  Range?: new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => unknown;
}

function PlainTextFallback(props: { content: string }) {
  return (
    <pre className="max-h-[560px] min-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-950 p-4 text-xs text-gray-100">
      {props.content || 'Select an adapter to view its full implementation.'}
    </pre>
  );
}

function languageForMonaco(language: EditorLanguage): string {
  if (language === 'json') return 'json';
  if (language === 'markdown') return 'markdown';
  return 'typescript';
}

export const ImplementationEditor: React.FC<ImplementationEditorProps> = ({
  content,
  language,
  outline,
  selectedSymbolId,
  readOnly = true,
  onChange,
}) => {
  const editorRef = useRef<MonacoEditorRef | null>(null);
  const monacoRef = useRef<MonacoApiRef | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const selectedSymbol = useMemo(() => outline.find((item) => item.id === selectedSymbolId), [outline, selectedSymbolId]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor as MonacoEditorRef;
    monacoRef.current = monaco as MonacoApiRef;
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !selectedSymbol?.startLine) return;

    const startLine = selectedSymbol.startLine;
    const endLine = selectedSymbol.endLine ?? selectedSymbol.startLine;
    editor.revealLineInCenter?.(startLine);
    editor.setPosition?.({ lineNumber: startLine, column: 1 });
    if (monaco?.Range && editor.deltaDecorations) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(startLine, 1, endLine, 1),
          options: {
            isWholeLine: true,
            className: 'adapter-lab-selected-line',
            marginClassName: 'adapter-lab-selected-line-margin',
          },
        },
      ]);
    }
  }, [selectedSymbol, content]);

  if (!content) {
    return <PlainTextFallback content="" />;
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-950">
      <Suspense fallback={<PlainTextFallback content={content} />}>
        <MonacoEditor
          height="560px"
          language={languageForMonaco(language)}
          value={content}
          theme="vs-dark"
          onMount={handleMount}
          onChange={(value) => onChange?.(value ?? '')}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            renderWhitespace: 'selection',
            tabSize: 2,
          }}
          loading={<PlainTextFallback content={content} />}
        />
      </Suspense>
    </div>
  );
};

export const ImplementationDiffEditor: React.FC<ImplementationDiffEditorProps> = ({
  originalContent,
  modifiedContent,
  language,
  readOnly = true,
}) => {
  if (!originalContent && !modifiedContent) {
    return <PlainTextFallback content="" />;
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-950">
      <Suspense fallback={<PlainTextFallback content={modifiedContent || originalContent} />}>
        <MonacoDiffEditor
          height="560px"
          language={languageForMonaco(language)}
          original={originalContent}
          modified={modifiedContent}
          theme="vs-dark"
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            renderWhitespace: 'selection',
            renderSideBySide: true,
          }}
          loading={<PlainTextFallback content={modifiedContent || originalContent} />}
        />
      </Suspense>
    </div>
  );
};
