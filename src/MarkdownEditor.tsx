import { useEffect, useId, useRef } from 'react';

type EditorInstance = { getMarkdown: () => string; setMarkdown: (value: string) => void };
declare global { interface Window { editormd?: (id: string, options: Record<string, unknown>) => EditorInstance } }

const assets = [
  { type: 'style', src: '/vendor/editor-md/css/editormd.min.css' },
  { type: 'script', src: '/vendor/editor-md/lib/jquery.min.js' },
  { type: 'script', src: '/vendor/editor-md/editormd.min.js' },
] as const;

function loadAsset(asset: typeof assets[number]) {
  return new Promise<void>((resolve, reject) => {
    const selector = `[data-flyblog-asset="${asset.src}"]`; const existing = document.querySelector(selector) as HTMLScriptElement | HTMLLinkElement | null;
    if (existing?.dataset.loaded === 'true') return resolve();
    const element = existing || (asset.type === 'style' ? document.createElement('link') : document.createElement('script'));
    element.dataset.flyblogAsset = asset.src;
    if (asset.type === 'style') { (element as HTMLLinkElement).rel = 'stylesheet'; (element as HTMLLinkElement).href = asset.src; } else { (element as HTMLScriptElement).src = asset.src; }
    element.addEventListener('load', () => { element.dataset.loaded = 'true'; resolve(); }, { once: true }); element.addEventListener('error', () => reject(new Error(`Failed to load ${asset.src}`)), { once: true });
    if (!existing) document.head.appendChild(element);
  });
}

export default function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = `editor-${useId().replace(/:/g, '')}`; const instance = useRef<EditorInstance | undefined>(undefined); const latest = useRef(onChange); latest.current = onChange;
  useEffect(() => { let active = true; (async () => {
    for (const asset of assets) await loadAsset(asset); if (!active || !window.editormd) return;
    instance.current = window.editormd(id, { width: '100%', height: 560, path: '/vendor/editor-md/lib/', markdown: value, watch: true, saveHTMLToTextarea: false, emoji: false, taskList: true, flowChart: false, sequenceDiagram: false, onchange() { if (instance.current) latest.current(instance.current.getMarkdown()); } });
  })(); return () => { active = false; instance.current = undefined; }; }, [id]);
  useEffect(() => { if (instance.current && instance.current.getMarkdown() !== value) instance.current.setMarkdown(value); }, [value]);
  return <div id={id} className="markdown-editor"><textarea defaultValue={value} /></div>;
}
