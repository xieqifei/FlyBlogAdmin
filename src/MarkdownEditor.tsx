import { basicSetup } from 'codemirror';
import { CodeOutlined, DeleteColumnOutlined, DeleteRowOutlined, InsertRowBelowOutlined, InsertRowRightOutlined, PictureOutlined, TableOutlined } from '@ant-design/icons';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, HighlightStyle, LanguageDescription, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import { useEffect, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import { editMarkdownTable, findMarkdownTables, markdownTableCellPosition, updateMarkdownTableCell, type MarkdownTable, type TableAction } from './markdownTable';
import { uploadImageFile } from './ImageHosting';
import { markdownImageUrl, privateImagePreviewUrl } from './imagePreview';
import { httpsImageUrl } from './imageUrl';
import { useI18n } from './i18n';

type Props = { value: string; onChange: (value: string) => void; r2Configured?: boolean; defaultBucket?: string; r2PublicUrl?: string };
type EditorContextMenu = { x: number; y: number; table: boolean };

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
  SetextHeading1: 'cm-live-h1', SetextHeading2: 'cm-live-h2',
  StrongEmphasis: 'cm-live-strong', Emphasis: 'cm-live-emphasis', Strikethrough: 'cm-live-strike',
  InlineCode: 'cm-live-code', Blockquote: 'cm-live-quote', Link: 'cm-live-link', Autolink: 'cm-live-link',
  BulletList: 'cm-live-list', OrderedList: 'cm-live-list',
};

const hiddenMarkers = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark']);

const editorHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map((style) => style.textDecoration === 'underline' && style.fontWeight === 'bold'
  ? { ...style, textDecoration: 'none' }
  : style));

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

class HorizontalRuleWidget extends WidgetType {
  constructor(readonly from: number) { super(); }
  eq(other: HorizontalRuleWidget) { return this.from === other.from; }
  toDOM(view: EditorView) {
    const rule = document.createElement('hr'); rule.className = 'cm-live-horizontal-rule';
    rule.addEventListener('click', () => { view.dispatch({ selection: EditorSelection.cursor(this.from), scrollIntoView: true }); view.focus(); });
    return rule;
  }
  ignoreEvent() { return false; }
}

class FootnoteWidget extends WidgetType {
  constructor(readonly from: number, readonly label: string, readonly definition = false) { super(); }
  eq(other: FootnoteWidget) { return this.from === other.from && this.label === other.label && this.definition === other.definition; }
  toDOM(view: EditorView) {
    const note = document.createElement(this.definition ? 'span' : 'sup'); note.className = this.definition ? 'cm-live-footnote-definition' : 'cm-live-footnote';
    note.textContent = this.definition ? `${this.label}.` : `[${this.label}]`;
    note.addEventListener('click', () => { view.dispatch({ selection: EditorSelection.cursor(this.from), scrollIntoView: true }); view.focus(); });
    return note;
  }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly from: number, readonly source: string, readonly alt: string, readonly url: string) { super(); }
  eq(other: ImageWidget) { return this.from === other.from && this.source === other.source; }
  toDOM(view: EditorView) {
    const image = document.createElement('img'); image.className = 'cm-live-image-preview'; image.src = this.url; image.alt = this.alt; image.title = this.alt;
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('error', () => view.requestMeasure());
    image.addEventListener('click', () => { view.dispatch({ selection: EditorSelection.cursor(this.from), scrollIntoView: true }); view.focus(); });
    return image;
  }
  ignoreEvent() { return false; }
}

class TableWidget extends WidgetType {
  constructor(readonly from: number, readonly source: string, readonly parsed: MarkdownTable) { super(); }
  eq(other: TableWidget) { return this.from === other.from && this.source === other.source; }
  toDOM(view: EditorView) {
    const shell = document.createElement('div'); const wrapper = document.createElement('div');
    shell.className = 'cm-table-preview-shell'; wrapper.className = 'cm-table-preview'; wrapper.title = '点击单元格直接编辑'; shell.append(wrapper);
    const editableCell = (tag: 'th' | 'td', value: string, rowIndex: number, columnIndex: number) => {
      const cell = document.createElement(tag);
      cell.contentEditable = 'plaintext-only'; cell.spellcheck = true; cell.textContent = value;
      cell.dataset.tableFrom = String(this.from); cell.dataset.tableRow = String(rowIndex); cell.dataset.tableColumn = String(columnIndex);
      cell.style.textAlign = this.parsed.alignments[columnIndex];
      cell.addEventListener('focus', () => {
        const position = markdownTableCellPosition(view.state.doc.toString(), this.from, rowIndex, columnIndex);
        if (position !== undefined) view.dispatch({ selection: EditorSelection.cursor(position) });
      });
      const save = () => {
        const next = (cell.textContent || '').replace(/[\r\n]+/g, ' ').trim();
        if (next === value) return;
        const updated = updateMarkdownTableCell(view.state.doc.toString(), this.from, rowIndex, columnIndex, next);
        if (updated) view.dispatch({ changes: { from: this.from, to: this.from + this.source.length, insert: updated.content.slice(updated.from, updated.to) } });
      };
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); cell.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); cell.textContent = value; cell.blur(); }
      });
      cell.addEventListener('blur', save);
      return cell;
    };
    const table = document.createElement('table'); const head = document.createElement('thead'); const headRow = document.createElement('tr');
    this.parsed.headers.forEach((value, index) => headRow.append(editableCell('th', value, -1, index)));
    head.append(headRow); table.append(head);
    if (this.parsed.rows.length) { const body = document.createElement('tbody'); this.parsed.rows.forEach((row, rowIndex) => { const tableRow = document.createElement('tr'); row.forEach((value, columnIndex) => tableRow.append(editableCell('td', value, rowIndex, columnIndex))); body.append(tableRow); }); table.append(body); }
    wrapper.append(table);
    return shell;
  }
  ignoreEvent() { return true; }
}

function livePreviewDecorations(state: EditorState, resolveImageUrl: (source: string) => string = markdownImageUrl) {
  const decorations: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) activeLines.add(line);
  }
  const customReplacements: Array<{ from: number; to: number }> = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    if (activeLines.has(number)) continue;
    const line = state.doc.line(number); const text = line.text;
    const definition = text.match(/^\s*\[\^([^\]\s]+)\]:\s*/);
    if (definition) {
      const start = line.from + text.indexOf('[^'); const to = line.from + definition[0].length;
      customReplacements.push({ from: start, to });
      decorations.push(Decoration.replace({ widget: new FootnoteWidget(start, definition[1], true) }).range(start, to));
    }
    const references = text.matchAll(/\[\^([^\]\s]+)\]/g);
    for (const reference of references) {
      const from = line.from + reference.index!; const to = from + reference[0].length;
      if (definition && from === line.from + text.indexOf('[^')) continue;
      customReplacements.push({ from, to });
      decorations.push(Decoration.replace({ widget: new FootnoteWidget(from, reference[1]) }).range(from, to));
    }
  }
  const previewTables = findMarkdownTables(state.doc.toString());
  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      if (previewTables.some((table) => node.from >= table.from && node.to <= table.to)) return false;
      if (customReplacements.some((range) => node.from >= range.from && node.to <= range.to)) return false;
      const className = nodeClasses[node.name];
      if (className && node.from < node.to) decorations.push(Decoration.mark({ class: className }).range(node.from, node.to));
      const lineNumber = state.doc.lineAt(node.from).number;
      const active = activeLines.has(lineNumber); const parentName = node.node.parent?.name;
      const source = node.from < node.to ? state.doc.sliceString(node.from, node.to) : '';
      if (node.name === 'HeaderMark' && /^\s*[=-]{2,}\s*$/.test(source)) decorations.push(Decoration.replace({}).range(node.from, node.to));
      else if (hiddenMarkers.has(node.name) && node.from < node.to && !active) decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (!active && node.name === 'URL' && (parentName === 'Link' || parentName === 'Image')) decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (!active && node.name === 'LinkLabel' && parentName === 'Link') decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (!active && node.name === 'LinkTitle' && (parentName === 'Link' || parentName === 'Image')) decorations.push(Decoration.replace({}).range(node.from, node.to));
      if (!active && node.name === 'Image') {
        const alt = source.match(/^!\[([^\]]*)\]/)?.[1] || '';
        const urlNode = node.node.getChild('URL');
        if (urlNode) {
          const url = state.doc.sliceString(urlNode.from, urlNode.to);
          decorations.push(Decoration.replace({ widget: new ImageWidget(node.from, source, alt, resolveImageUrl(url)) }).range(node.from, node.to));
          return false;
        }
      }
      if (!active && /^ATXHeading|^SetextHeading/.test(node.name)) {
        const anchor = source.match(/\s*\{#[A-Za-z][\w:.-]*\}\s*$/);
        if (anchor) decorations.push(Decoration.replace({}).range(node.to - anchor[0].length, node.to));
      }
      if (!active && node.name === 'HorizontalRule') {
        decorations.push(Decoration.replace({ widget: new HorizontalRuleWidget(node.from), block: true }).range(node.from, node.to)); return false;
      }
      if (node.name === 'ListMark' && node.from < node.to && !activeLines.has(lineNumber)) {
        const marker = source;
        if (/^[-*+]$/.test(marker)) decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
      }
      if (node.name === 'TaskMarker' && node.from < node.to && !activeLines.has(lineNumber)) {
        const marker = source;
        decorations.push(Decoration.replace({ widget: new TaskWidget(node.from, node.to, /x/i.test(marker)) }).range(node.from, node.to));
      }
      if (node.name === 'FencedCode') {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let number = first; number <= last; number += 1) {
          const line = state.doc.line(number);
          const extra = number === first ? ' cm-live-code-first' : number === last ? ' cm-live-code-last' : '';
          decorations.push(Decoration.line({ class: `cm-live-code-line${extra}` }).range(line.from));
        }
      }
    },
  });
  previewTables.forEach((table) => decorations.push(Decoration.replace({ widget: new TableWidget(table.from, table.source, table.table), block: true }).range(table.from, table.to)));
  return Decoration.set(decorations, true);
}

function livePreview(resolveImageUrl: (source: string) => string) {
  return StateField.define<DecorationSet>({
    create: (state) => livePreviewDecorations(state, resolveImageUrl),
    update: (_decorations, transaction) => livePreviewDecorations(transaction.state, resolveImageUrl),
    provide: (field) => EditorView.decorations.from(field),
  });
}

function positionFromPointer(view: EditorView, event: MouseEvent) {
  const owner = view.dom.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
  };
  const caret = owner.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = caret ? null : owner.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode || range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !view.contentDOM.contains(node)) return null;
  try { return view.posAtDOM(node, offset); } catch { return null; }
}

const precisePointerSelection = EditorView.mouseSelectionStyle.of((current, event) => {
  if (event.button !== 0 || event.detail !== 1) return null;
  const initialAnchor = positionFromPointer(current, event);
  if (initialAnchor === null) return null;
  let anchor: number = initialAnchor;
  let initialSelection = current.state.selection;
  return {
    update(update) {
      if (!update.docChanged) return;
      anchor = update.changes.mapPos(anchor);
      initialSelection = initialSelection.map(update.changes);
    },
    get(pointer, extend, multiple) {
      const head = positionFromPointer(current, pointer) ?? current.posAtCoords({ x: pointer.clientX, y: pointer.clientY }, false) ?? anchor;
      const range = EditorSelection.range(anchor, head);
      if (extend) return initialSelection.replaceRange(initialSelection.main.extend(range.from, range.to, range.assoc));
      if (multiple) return initialSelection.addRange(range);
      return EditorSelection.create([range]);
    },
  };
});

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
  { label: '—', title: '分隔线', run: (view: EditorView) => insertBlock(view, '---\n\n', undefined, true) },
];

export default function MarkdownEditor({ value, onChange, r2Configured = false, defaultBucket = '', r2PublicUrl = '' }: Props) {
  const t = useI18n(); const { message } = AntApp.useApp();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef<(files: File[], editor: EditorView) => Promise<void>>(async () => undefined);
  const syncing = useRef(false);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(null);
  onChangeRef.current = onChange;
  uploadRef.current = async (files, editor) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    if (!r2Configured) { message.warning(t('md.notConfigured')); return; }
    const links: string[] = [];
    try {
      for (const file of images) {
        const result = await uploadImageFile(file, localStorage.getItem('flyblog:r2bucket') || defaultBucket);
        const alt = file.name.replace(/\.[^.]+$/, '') || 'image'; links.push(`![${alt}](${httpsImageUrl(result.url)})`);
      }
      const position = editor.state.selection.main.head; const prefix = position > 0 && editor.state.doc.sliceString(position - 1, position) !== '\n' ? '\n\n' : '';
      editor.dispatch({ changes: { from: position, insert: `${prefix}${links.join('\n\n')}\n` }, selection: EditorSelection.cursor(position + prefix.length + links.join('\n\n').length + 1), scrollIntoView: true });
      message.success(t('md.uploaded', { count: links.length })); editor.focus();
    } catch (reason) { message.error(t('md.uploadFailed', { error: reason instanceof Error ? reason.message : t('error.requestFailed') })); }
  };

  useEffect(() => {
    if (!host.current) return undefined;
    const previewBucket = r2Configured && !r2PublicUrl ? localStorage.getItem('flyblog:r2bucket') || defaultBucket : '';
    const resolveImageUrl = (source: string) => privateImagePreviewUrl(markdownImageUrl(source), previewBucket, window.location.origin);
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          syntaxHighlighting(editorHighlightStyle),
          markdown({ codeLanguages: languages, extensions: [Strikethrough, TaskList, Table] }),
          EditorView.lineWrapping,
          precisePointerSelection,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Markdown 正文编辑器' }),
          placeholder('开始写正文…'), livePreview(resolveImageUrl),
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
    const resizeObserver = new ResizeObserver(() => editor.requestMeasure());
    resizeObserver.observe(editor.contentDOM);
    const openContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const cell = target?.closest<HTMLElement>('.cm-table-preview [data-table-row][data-table-column]');
      if (cell) {
        const tableFrom = Number(cell.dataset.tableFrom); const row = Number(cell.dataset.tableRow); const column = Number(cell.dataset.tableColumn);
        const position = markdownTableCellPosition(editor.state.doc.toString(), tableFrom, row, column);
        if (position !== undefined) editor.dispatch({ selection: EditorSelection.cursor(position) });
      } else {
        const position = positionFromPointer(editor, event) ?? editor.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        if (position !== null) editor.dispatch({ selection: EditorSelection.cursor(position) });
      }
      event.preventDefault();
      const menuHeight = Math.min(520, window.innerHeight - 16);
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 252)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        table: Boolean(cell),
      });
    };
    host.current.addEventListener('contextmenu', openContextMenu);
    void document.fonts?.ready.then(() => editor.requestMeasure());
    view.current = editor;
    return () => { host.current?.removeEventListener('contextmenu', openContextMenu); resizeObserver.disconnect(); editor.destroy(); view.current = undefined; };
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.markdown-context-menu')) return;
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', close); window.addEventListener('scroll', close, true); window.addEventListener('resize', close); window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', closeOnEscape); };
  }, [contextMenu]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    syncing.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    syncing.current = false;
  }, [value]);

  const run = (command: (editor: EditorView) => boolean) => { if (view.current) command(view.current); };
  const contextAction = (command: (editor: EditorView) => boolean) => { run(command); setContextMenu(null); };
  return <div className="markdown-workspace-editor">
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      <button type="button" title="撤销（Ctrl/⌘+Z）" aria-label="撤销" onClick={() => run(undo)}>↶</button>
      <button type="button" title="重做（Ctrl/⌘+Shift+Z）" aria-label="重做" onClick={() => run(redo)}>↷</button>
      {toolbar.map((tool) => <button key={tool.title} type="button" title={tool.title} aria-label={tool.title} className={tool.className} onClick={() => run(tool.run)}>{tool.label}</button>)}
      <span className="code-block-tool"><select aria-label="代码块语言" title="代码块语言" value={codeLanguage} onChange={(event) => setCodeLanguage(event.target.value)}><option value="javascript">JS</option><option value="typescript">TS</option><option value="python">Python</option><option value="html">HTML</option><option value="css">CSS</option><option value="json">JSON</option></select><button type="button" title={`插入 ${codeLanguage} 代码块`} aria-label="插入代码块" className="icon-tool" onClick={() => run((editor) => insertBlock(editor, `\`\`\`${codeLanguage}\n$SELECTION\n\`\`\``, '代码'))}><CodeOutlined /></button></span>
      <span className="table-tools" aria-label="表格行列操作"><button type="button" title="在当前行后添加一行" aria-label="添加表格行" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'add-row'))}><InsertRowBelowOutlined /></button><button type="button" title="删除当前行" aria-label="删除表格行" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'delete-row'))}><DeleteRowOutlined /></button><button type="button" title="在当前列后添加一列" aria-label="添加表格列" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'add-column'))}><InsertRowRightOutlined /></button><button type="button" title="删除当前列（至少保留两列）" aria-label="删除表格列" className="icon-tool" onClick={() => run((editor) => editTable(editor, 'delete-column'))}><DeleteColumnOutlined /></button></span>
    </div>
    <div ref={host} className="markdown-editor obsidian-editor" />
    {contextMenu && <div className="markdown-context-menu" role="menu" aria-label="Markdown 右键菜单" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.table && <>
        <div className="markdown-context-label">表格</div>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'add-row-before'))}>在上方插入行</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'add-row-after'))}>在下方插入行</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'delete-row'))}>删除当前行</button>
        <div className="markdown-context-separator" />
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'add-column-before'))}>在左侧插入列</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'add-column-after'))}>在右侧插入列</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'delete-column'))}>删除当前列</button>
        <div className="markdown-context-separator" />
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'align-left'))}>本列左对齐</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'align-center'))}>本列居中</button>
        <button type="button" role="menuitem" onClick={() => contextAction((editor) => editTable(editor, 'align-right'))}>本列右对齐</button>
        <div className="markdown-context-separator" />
      </>}
      <div className="markdown-context-label">插入与格式</div>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '# '))}>一级标题</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '## '))}>二级标题</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '### '))}>三级标题</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => wrap(editor, '**'))}>加粗</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => wrap(editor, '*'))}>斜体</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => wrap(editor, '~~'))}>删除线</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '> '))}>引用</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '- '))}>无序列表</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '1. '))}>有序列表</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => prefixLines(editor, '- [ ] '))}>任务列表</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => wrap(editor, '[', '](https://)', '链接文字'))}>链接</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => wrap(editor, '![', '](https://)', '图片说明'))}>图片</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => insertBlock(editor, `\`\`\`${codeLanguage}\n$SELECTION\n\`\`\``, '代码'))}>{codeLanguage} 代码块</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => insertBlock(editor, '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n\n', undefined, true))}>表格</button>
      <button type="button" role="menuitem" onClick={() => contextAction((editor) => insertBlock(editor, '---\n\n', undefined, true))}>分隔线</button>
    </div>}
  </div>;
}
