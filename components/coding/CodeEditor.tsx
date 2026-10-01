'use client';
import dynamic from 'next/dynamic';

// Monaco is large and browser-only, so it loads on demand. It fetches its files from a CDN by default.
const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading editor…</div>,
});

export function CodeEditor({ language, value, onChange, onRun }: { language: string; value: string; onChange: (code: string) => void; onRun: () => void }) {
  return (
    <Monaco
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onChange={(v: string | undefined) => onChange(v ?? '')}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onMount={(editor: any, monaco: any) => {
        // Ctrl/Cmd + Enter runs the samples, like other coding platforms.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);
      }}
      options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, wordWrap: 'off', padding: { top: 8 } }}
    />
  );
}
