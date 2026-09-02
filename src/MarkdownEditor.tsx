import { basicSetup } from 'codemirror';
import { CodeOutlined, DeleteColumnOutlined, DeleteRowOutlined, InsertRowBelowOutlined, InsertRowRightOutlined, PictureOutlined, TableOutlined } from '@ant-design/icons';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { LanguageDescription, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import { useEffect, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import { editMarkdownTable, findMarkdownTables, type MarkdownTable, type TableAction } from './markdownTable';
import { uploadImageFile } from './ImageHosting';
import { useI18n } from './i18n';

type Props = { value: string; onChange: (value: string) => void; r2Configured?: boolean; defaultBucket?: string };

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
  BulletList: 'cm-live-list', OrderedList: 'cm-live-list',
};

const hiddenMarkers = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark']);

class BulletWidget extends WidgetType {
  toDOM() { const bullet = document.createElement('span'); bullet.className = 'cm-live-bullet'; bullet.textContent = '•'; return bullet; }
}

class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly checked: boolean) { super(); }
  eq(other: TaskWidget) { return this.from === other.from && this.to === other.to && this.checked === other.checked; }
  toDOM(view: EditorView) {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'cm-task-checkbox'; checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? '已完成任务' : '未完成任务');
    checkbox.addEventListener('change', () => { view.dispatch({ changes: { from: this.from, to: this.to, insert: checkbox.checked ? '[x]' : '[ ]' } }); view.focus(); });
    return checkbox;
  }
  ignoreEvent() { return false; }
}

class TableWidget extends WidgetType {
  constructor(readonly from: number, readonly source: string, readonly parsed: MarkdownTable) { super(); }
  eq(other: TableWidget) { return this.from === other.from && this.source === other.source; }
  get estimatedHeight() { return 52 + this.parsed.rows.length * 42; }
  toDOM(view: EditorView) {
    const shell = document.createElement('div'); const wrapper = document.createElement('div');
    shell.className = 'cm-table-preview-shell'; wrapper.className = 'cm-table-preview'; wrapper.title = '点击表格可编辑单元格'; shell.append(wrapper);
    const table = document.createElement('table'); const head = document.createElement('thead'); const headRow = document.createElement('tr');
    this.parsed.headers.forEach((value, index) => { const cell = document.createElement('th'); cell.textContent = value || '\u00a0'; cell.style.textAlign = this.parsed.alignments[index]; headRow.append(cell); });
    head.append(headRow); table.append(head);
    if (this.parsed.rows.length) { const body = document.createElement('tbody'); this.parsed.rows.forEach((row) => { const tableRow = document.createElement('tr'); row.forEach((value, index) => { const cell = document.createElement('td'); cell.textContent = value || '\u00a0'; cell.style.textAlign = this.parsed.alignments[index]; tableRow.append(cell); }); body.append(tableRow); }); table.append(body); }
    wrapper.append(table);
    wrapper.addEventListener('click', () => { view.dispatch({ selection: EditorSelection.cursor(this.from), scrollIntoView: true }); view.focus(); });
    return shell;
  }
  ignoreEvent() { return false; }
}

function livePreviewDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number;
    const toLine = view.state.doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) activeLines.add(line);
  }
  const tables = findMarkdownTables(view.state.doc.toString());
  const previewTables = tables.filter((table) => !view.state.selection.ranges.some((range) => range.empty
    ? range.from >= table.from && range.from < table.to
    : range.from < table.to && range.to > table.from));
  syntaxTree(view.state).iterate({
    from: 0,
    to: view.state.doc.length,
    enter(node) {
      if (previewTables.some((table) => node.from >= table.from && node.to <= table.to)) return false;
      const className = nodeClasses[node.name];
      if (className && node.from < node.to) decorations.push(Decoration.mark({ class: className }).range(node.from, node.to));
      const lineNumber = view.state.doc.lineAt(node.from).number;
      if (hiddenMarkers.has(node.name) && node.from < node.to && !activeLines.has(lineNumber)) decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (node.name === 'ListMark' && node.from < node.to && !activeLines.has(lineNumber)) {
        const marker = view.state.doc.sliceString(node.from, node.to);
        if (/^[-*+]$/.test(marker)) decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
      }
      if (node.name === 'TaskMarker' && node.from < node.to && !activeLines.has(lineNumber)) {
        const marker = view.state.doc.sliceString(node.from, node.to);
        decorations.push(Decoration.replace({ widget: new TaskWidget(node.from, node.to, /x/i.test(marker)) }).range(node.from, node.to));
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
  previewTables.forEach((table) => decorations.push(Decoration.replace({ widget: new TableWidget(table.from, table.source, table.table), block: true }).range(table.from, table.to)));
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

function insertBlock(view: EditorView, template: string, selectText?: string, placeAfter = false) {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const block = template.replace('$SELECTION', selected || selectText || '');
  const leading = range.from > 0 && view.state.doc.sliceString(range.from - 1, range.from) !== '\n' ? '\n\n' : '';
  const insert = `${leading}${block}`;
  const selectionText = selected || selectText;
  const offset = selectionText ? insert.indexOf(selectionText) : -1;
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: offset >= 0 ? EditorSelection.single(range.from + offset, range.from + offset + selectionText!.length) : placeAfter ? EditorSelection.cursor(range.from + insert.length) : undefined, scrollIntoView: true });
  view.focus(); return true;
}

function editTable(view: EditorView, action: TableAction) {
  const current = view.state.doc.toString(); const edited = editMarkdownTable(current, view.state.selection.main.head, action);
  if (!edited) return false;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited.content }, selection: EditorSelection.cursor(Math.min(edited.content.length, edited.to + 1)), scrollIntoView: true });
  view.focus(); return true;
}

const toolbar = [
  { label: 'H1', title: '一级标题', run: (view: EditorView) => prefixLines(view, '# ') },
  { label: 'H2', title: '二级标题', run: (view: EditorView) => prefixLines(view, '## ') },
  { label: 'B', title: '加粗（Ctrl/⌘+B）', className: 'strong', run: (view: EditorView) => wrap(view, '**') },
  { label: 'I', title: '斜体（Ctrl/⌘+I）', className: 'emphasis', run: (view: EditorView) => wrap(view, '*') },
  { label: 'S', title: '删除线', className: 'strike', run: (view: EditorView) => wrap(view, '~~') },
  { label: '</>', title: '行内代码（Ctrl/⌘+E）', run: (view: EditorView) => wrap(view, '`', '`', '代码') },
  { label: '❝', title: '引用', run: (view: EditorView) => prefixLines(view, '> ') },
  { label: '•', title: '无序列表', run: (view: EditorView) => prefixLines(view, '- ') },
  { label: '1.', title: '有序列表', run: (view: EditorView) => prefixLines(view, '1. ') },
  { label: '☑', title: '任务列表', run: (view: EditorView) => prefixLines(view, '- [ ] ') },
  { label: '🔗', title: '链接（Ctrl/⌘+K）', run: (view: EditorView) => wrap(view, '[', '](https://)', '链接文字') },
  { label: <PictureOutlined />, title: '插入图片', className: 'icon-tool', run: (view: EditorView) => wrap(view, '![', '](https://)', '图片说明') },
  { label: <TableOutlined />, title: '插入表格', className: 'icon-tool', run: (view: EditorView) => insertBlock(view, '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n\n', undefined, true) },
  { label: '—', title: '分隔线', run: (view: EditorView) => insertBlock(view, '---\n') },
];

export default function MarkdownEditor({ value, onChange, r2Configured = false, defaultBucket = '' }: Props) {
  const t = useI18n(); const { message } = AntApp.useApp();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef<(files: File[], editor: EditorView) => Promise<void>>(async () => undefined);
  const syncing = useRef(false);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  onChangeRef.current = onChange;
  uploadRef.current = async (files, editor) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    if (!r2Configured) { message.warning(t('md.notConfigured')); return; }
    const links: string[] = [];
    try {
      for (const file of images) {
        const result = await uploadImageFile(file, localStorage.getItem('flyblog:r2bucket') || defaultBucket);
        const alt = file.name.replace(/\.[^.]+$/, '') || 'image'; links.push(`![${alt}](${result.url})`);
      }
      const position = editor.state.selection.main.head; const prefix = position > 0 && editor.state.doc.sliceString(position - 1, position) !== '\n' ? '\n\n' : '';
      editor.dispatch({ changes: { from: position, insert: `${prefix}${links.join('\n\n')}\n` }, selection: EditorSelection.cursor(position + prefix.length + links.join('\n\n').length + 1), scrollIntoView: true });
      message.success(t('md.uploaded', { count: links.length })); editor.focus();
    } catch (reason) { message.error(t('md.uploadFailed', { error: reason instanceof Error ? reason.message : t('error.requestFailed') })); }
  };

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages, extensions: [Strikethrough, TaskList, Table] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Markdown 正文编辑器' }),
          placeholder('开始写正文…'), livePreview,
          EditorView.domEventHandlers({
            drop(event, current) { const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/')); if (!files.length) return false; event.preventDefault(); void uploadRef.current(files, current); return true; },
            paste(event, current) { const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/')); if (!files.length) return false; event.preventDefault(); void uploadRef.current(files, current); return true; },
          }),
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
      <span className="code-block-tool"><select aria-label="代码块语言" title="代码块语言" value={codeLanguage} onChange={(event) => setCodeLanguage(event.target.value)}><option value="javascript">JS</option><option value="typescript">TS</option><option value="python">Python</option><option value="html">HTML</option><option value="css">CSS</option><option value="json">JSON</option></select><button type="button" title={`插入 ${codeLanguage} 代码块`} aria-label="插入代码块" className="icon-tool" onClick={() => run((editor) => insertBlock(editor, `\`\`\`${codeLanguage}\n$SELECTION\n\`\`\``, '代码'))}><CodeOutlined /></button></span>
      <span className="table-tools" aria-label="表格行列操作"><button type="button" title="在当前行后添加一行" aria-label="添加表格行" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'add-row'))}><InsertRowBelowOutlined /></button><button type="button" title="删除当前行" aria-label="删除表格行" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'delete-row'))}><DeleteRowOutlined /></button><button type="button" title="在当前列后添加一列" aria-label="添加表格列" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'add-column'))}><InsertRowRightOutlined /></button><button type="button" title="删除当前列（至少保留两列）" aria-label="删除表格列" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'delete-column'))}><DeleteColumnOutlined /></button></span>
    </div>
    <div ref={host} className="markdown-editor obsidian-editor" />
  </div>;
}
