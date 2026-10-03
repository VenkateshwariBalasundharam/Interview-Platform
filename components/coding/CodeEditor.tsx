'use client';
import dynamic from 'next/dynamic';
import { useProctor } from '@/components/proctoring/ProctorGate';

// Monaco is large and browser-only, so it loads on demand. It fetches its files from a CDN by default.
const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading editor…</div>,
});

export function CodeEditor({ language, value, onChange, onRun }: { language: string; value: string; onChange: (code: string) => void; onRun: () => void }) {
  const proctor = useProctor();
  const blockPaste = proctor.blockPaste;
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
        if (blockPaste) {
          // The page already stops paste events. This catches the editor's own routes (for example the command palette):
          // anything that still lands is undone and recorded.
          editor.onDidPaste(() => {
            editor.trigger('proctor', 'undo', null);
            proctor.reportBlockedPaste('editor');
          });
        }
      }}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        wordWrap: 'off',
        padding: { top: 8 },
        // When pasting is blocked, also turn off the editor's own right-click menu (it has a Paste item) and drag and drop.
        ...(blockPaste ? { contextmenu: false, dragAndDrop: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false } } : {}),
      }}
    />
  );
}
