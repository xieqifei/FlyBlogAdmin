import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';

type Props = { value: string; onChange: (value: string) => void };

const nodeClasses: Record<string, string> = {
  ATXHeading1: 'cm-live-h1',
  ATXHeading2: 'cm-live-h2',
  ATXHeading3: 'cm-live-h3',
  ATXHeading4: 'cm-live-h4',
  ATXHeading5: 'cm-live-h5',
  ATXHeading6: 'cm-live-h6',
  StrongEmphasis: 'cm-live-strong',
  Emphasis: 'cm-live-emphasis',
  InlineCode: 'cm-live-code',
  FencedCode: 'cm-live-codeblock',
  Blockquote: 'cm-live-quote',
  Link: 'cm-live-link',
  URL: 'cm-live-link',
};

const hiddenMarkers = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark']);

function livePreviewDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number;
    const toLine = view.state.doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) activeLines.add(line);
  }

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const className = nodeClasses[node.name];
        if (className && node.from < node.to) {
          decorations.push(Decoration.mark({ class: className }).range(node.from, node.to));
        }
        if (hiddenMarkers.has(node.name) && node.from < node.to && !activeLines.has(view.state.doc.lineAt(node.from).number)) {
          decorations.push(Decoration.replace({}).range(node.from, node.to));
        }
      },
    });
  }
  return Decoration.set(decorations, true);
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = livePreviewDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = livePreviewDecorations(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

export default function MarkdownEditor({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const syncing = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          placeholder('开始写正文…'),
          livePreview,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    syncing.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    syncing.current = false;
  }, [value]);

  return <div ref={host} className="markdown-editor obsidian-editor" />;
}
