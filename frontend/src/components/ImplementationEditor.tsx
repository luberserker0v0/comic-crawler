import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import type { AdapterImplementationSymbol } from '@comiccrawler/shared';
import type { OnMount } from '@monaco-editor/react';

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));
const MonacoDiffEditor = React.lazy(async () => {
  const module = await import('@monaco-editor/react');
  return { default: module.DiffEditor };
});

export type EditorLanguage = 'typescript' | 'json' | 'markdown';

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
  const navigation = useSymbolNavigation(outline, selectedSymbolId);
  if (!content) return <PlainTextFallback content="" />;
  return <EditorShell fallback={content}>
    <MonacoEditor height="560px" language={languageForMonaco(language)} value={content} theme="vs-dark"
      onMount={navigation.handleMount} onChange={(value) => onChange?.(value ?? '')}
      options={{ ...editorOptions, readOnly }} loading={<PlainTextFallback content={content} />} />
  </EditorShell>;
};

const editorOptions = { minimap: { enabled: false }, fontSize: 12, lineNumbers: 'on' as const,
  scrollBeyondLastLine: false, wordWrap: 'on' as const, automaticLayout: true,
  renderWhitespace: 'selection' as const, tabSize: 2 };

function useSymbolNavigation(outline: AdapterImplementationSymbol[], selectedSymbolId?: string) {
  const editorRef = useRef<MonacoEditorRef | null>(null);
  const monacoRef = useRef<MonacoApiRef | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const selectedSymbol = useMemo(() => outline.find((item) => item.id === selectedSymbolId), [outline, selectedSymbolId]);
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor as MonacoEditorRef;
    monacoRef.current = monaco as MonacoApiRef;
  };
  useSelectedSymbolEffect(editorRef, monacoRef, decorationsRef, selectedSymbol);
  return { handleMount };
}

function useSelectedSymbolEffect(editorRef: React.MutableRefObject<MonacoEditorRef | null>,
  monacoRef: React.MutableRefObject<MonacoApiRef | null>, decorationsRef: React.MutableRefObject<string[]>,
  selectedSymbol: AdapterImplementationSymbol | undefined) {
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !selectedSymbol?.startLine) return;

    const startLine = selectedSymbol.startLine;
    const endLine = selectedSymbol.endLine ?? selectedSymbol.startLine;
    editor.revealLineInCenter?.(startLine);
    editor.setPosition?.({ lineNumber: startLine, column: 1 });
    if (monaco?.Range && editor.deltaDecorations) decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current, [selectedLineDecoration(monaco.Range, startLine, endLine)]);
  }, [decorationsRef, editorRef, monacoRef, selectedSymbol]);
}

function selectedLineDecoration(Range: NonNullable<MonacoApiRef['Range']>, startLine: number, endLine: number) {
  return { range: new Range(startLine, 1, endLine, 1), options: { isWholeLine: true,
    className: 'adapter-lab-selected-line', marginClassName: 'adapter-lab-selected-line-margin' } };
}

function EditorShell({ fallback, children }: { fallback: string; children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-950">
    <Suspense fallback={<PlainTextFallback content={fallback} />}>{children}</Suspense>
  </div>;
}

export const ImplementationDiffEditor: React.FC<ImplementationDiffEditorProps> = ({
  originalContent,
  modifiedContent,
  language,
  readOnly = true,
}) => {
  const fallback = modifiedContent || originalContent;
  if (!fallback) return <PlainTextFallback content="" />;
  return <EditorShell fallback={fallback}><MonacoDiffEditor height="560px"
    language={languageForMonaco(language)} original={originalContent} modified={modifiedContent}
    theme="vs-dark" options={{ ...editorOptions, readOnly, renderSideBySide: true }}
    loading={<PlainTextFallback content={fallback} />} /></EditorShell>;
};
