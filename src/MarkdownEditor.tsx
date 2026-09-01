import { basicSetup } from 'codemirror';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { LanguageDescription, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { Strikethrough, TaskList } from '@lezer/markdown';
import { useEffect, useRef } from 'react';

type Props = { value: string; onChange: (value: string) => void };

const languages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'jsx'], load: async () => javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'tsx'], load: async () => javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'Python', alias: ['py'], load: async () => python() }),
  LanguageDescription.of({ name: 'HTML', alias: ['xml'], load: async () => html() }),
  LanguageDescription.of({ name: 'CSS', alias: ['scss', 'less'], load: async () => css() }),
  LanguageDescription.of({ name: 'JSON', alias: ['jsonc'], load: async () => javascript() }),
];

const nodeClasses: Record<string, string> = {
  ATXHeading1: 'cm-live-h1', ATXHeading2: 'cm-live-h2', ATXHeading3: 'cm-live-h3',
  ATXHeading4: 'cm-live-h4', ATXHeading5: 'cm-live-h5', ATXHeading6: 'cm-live-h6',
  StrongEmphasis: 'cm-live-strong', Emphasis: 'cm-live-emphasis', Strikethrough: 'cm-live-strike',
  InlineCode: 'cm-live-code', Blockquote: 'cm-live-quote', Link: 'cm-live-link', URL: 'cm-live-link',
  BulletList: 'cm-live-list', OrderedList: 'cm-live-list', Table: 'cm-live-table',
};

const hiddenMarkers = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark']);

class BulletWidget extends WidgetType {
  toDOM() { const bullet = document.createElement('span'); bullet.className = 'cm-live-bullet'; bullet.textContent = '•'; return bullet; }
}

function livePreviewDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number;
    const toLine = view.state.doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) activeLines.add(line);
  }
  const firstVisible = view.visibleRanges[0]?.from ?? 0;
  const lastVisible = view.visibleRanges.at(-1)?.to ?? view.state.doc.length;
  syntaxTree(view.state).iterate({
    from: firstVisible,
    to: lastVisible,
    enter(node) {
      const className = nodeClasses[node.name];
      if (className && node.from < node.to) decorations.push(Decoration.mark({ class: className }).range(node.from, node.to));
      const lineNumber = view.state.doc.lineAt(node.from).number;
      if (hiddenMarkers.has(node.name) && node.from < node.to && !activeLines.has(lineNumber)) decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (node.name === 'ListMark' && node.from < node.to && !activeLines.has(lineNumber)) {
        const marker = view.state.doc.sliceString(node.from, node.to);
        if (/^[-*+]$/.test(marker)) decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
      }
      if (node.name === 'FencedCode') {
        const first = view.state.doc.lineAt(node.from).number;
        const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let number = first; number <= last; number += 1) {
          const line = view.state.doc.line(number);
          const extra = number === first ? ' cm-live-code-first' : number === last ? ' cm-live-code-last' : '';
          decorations.push(Decoration.line({ class: `cm-live-code-line${extra}` }).range(line.from));
        }
      }
    },
  });
  return Decoration.set(decorations, true);
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = livePreviewDecorations(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = livePreviewDecorations(update.view); }
}, { decorations: (plugin) => plugin.decorations });

function wrap(view: EditorView, before: string, after = before, fallback = '文字') {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const content = selected || fallback;
  const insert = `${before}${content}${after}`;
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: EditorSelection.single(range.from + before.length, range.from + before.length + content.length), scrollIntoView: true });
  view.focus(); return true;
}

function prefixLines(view: EditorView, prefix: string) {
  const range = view.state.selection.main;
  const first = view.state.doc.lineAt(range.from);
  const last = view.state.doc.lineAt(range.to);
  const changes = [];
  for (let number = first.number; number <= last.number; number += 1) changes.push({ from: view.state.doc.line(number).from, insert: prefix });
  view.dispatch({ changes, scrollIntoView: true }); view.focus(); return true;
}

function insertBlock(view: EditorView, template: string, selectText?: string) {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const block = template.replace('$SELECTION', selected || selectText || '');
  const leading = range.from > 0 && view.state.doc.sliceString(range.from - 1, range.from) !== '\n' ? '\n\n' : '';
  const insert = `${leading}${block}`;
  const selectionText = selected || selectText;
  const offset = selectionText ? insert.indexOf(selectionText) : -1;
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: offset >= 0 ? EditorSelection.single(range.from + offset, range.from + offset + selectionText!.length) : undefined, scrollIntoView: true });
  view.focus(); return true;
}

const toolbar = [
  { label: 'H1', title: '一级标题', run: (view: EditorView) => prefixLines(view, '# ') },
  { label: 'H2', title: '二级标题', run: (view: EditorView) => prefixLines(view, '## ') },
  { label: 'B', title: '加粗（Ctrl/⌘+B）', className: 'strong', run: (view: EditorView) => wrap(view, '**') },
  { label: 'I', title: '斜体（Ctrl/⌘+I）', className: 'emphasis', run: (view: EditorView) => wrap(view, '*') },
  { label: 'S', title: '删除线', className: 'strike', run: (view: EditorView) => wrap(view, '~~') },
  { label: '</>', title: '行内代码（Ctrl/⌘+E）', run: (view: EditorView) => wrap(view, '`', '`', '代码') },
  { label: '```', title: '代码块', run: (view: EditorView) => insertBlock(view, '```javascript\n$SELECTION\n```', '代码') },
  { label: '❝', title: '引用', run: (view: EditorView) => prefixLines(view, '> ') },
  { label: '•', title: '无序列表', run: (view: EditorView) => prefixLines(view, '- ') },
  { label: '1.', title: '有序列表', run: (view: EditorView) => prefixLines(view, '1. ') },
  { label: '☑', title: '任务列表', run: (view: EditorView) => prefixLines(view, '- [ ] ') },
  { label: '🔗', title: '链接（Ctrl/⌘+K）', run: (view: EditorView) => wrap(view, '[', '](https://)', '链接文字') },
  { label: '▧', title: '图片', run: (view: EditorView) => wrap(view, '![', '](https://)', '图片说明') },
  { label: '▦', title: '表格', run: (view: EditorView) => insertBlock(view, '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n') },
  { label: '—', title: '分隔线', run: (view: EditorView) => insertBlock(view, '---\n') },
];

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
          markdown({ codeLanguages: languages, extensions: [Strikethrough, TaskList] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Markdown 正文编辑器' }),
          placeholder('开始写正文…'), livePreview,
          keymap.of([
            { key: 'Mod-b', run: (current) => wrap(current, '**') },
            { key: 'Mod-i', run: (current) => wrap(current, '*') },
            { key: 'Mod-e', run: (current) => wrap(current, '`', '`', '代码') },
            { key: 'Mod-k', run: (current) => wrap(current, '[', '](https://)', '链接文字') },
          ]),
          EditorView.updateListener.of((update) => { if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString()); }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = undefined; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    syncing.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    syncing.current = false;
  }, [value]);

  const run = (command: (editor: EditorView) => boolean) => { if (view.current) command(view.current); };
  return <div className="markdown-workspace-editor">
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      <button type="button" title="撤销（Ctrl/⌘+Z）" aria-label="撤销" onClick={() => run(undo)}>↶</button>
      <button type="button" title="重做（Ctrl/⌘+Shift+Z）" aria-label="重做" onClick={() => run(redo)}>↷</button>
      {toolbar.map((tool) => <button key={tool.title} type="button" title={tool.title} aria-label={tool.title} className={tool.className} onClick={() => run(tool.run)}>{tool.label}</button>)}
    </div>
    <div ref={host} className="markdown-editor obsidian-editor" />
  </div>;
}
