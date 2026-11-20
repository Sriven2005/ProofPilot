import * as monaco from '../../node_modules/monaco-editor/esm/vs/editor/editor.api.js';
import { loader } from '@monaco-editor/react';
import EditorWorker from '../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker';

loader.config({ monaco });

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(workerId: string, label: string): Worker;
    };
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
}

monaco.editor.defineTheme('proofpilot-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#101015',
    'editor.foreground': '#d6d2e1',
    'editorLineNumber.foreground': '#696777',
    'editorLineNumber.activeForeground': '#b9b0ca',
    'editor.selectionBackground': '#51416f88',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorCursor.foreground': '#c8b3f2',
  },
});
