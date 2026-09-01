import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Empty, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { CompressOutlined, ReloadOutlined } from '@ant-design/icons';
import { useI18n } from './i18n';

type NodeType = 'article' | 'category' | 'tag';
type ApiNode = { id: string; label: string; type: NodeType; path?: string; degree: number };
type ApiEdge = { source: string; target: string; type: 'link' | 'category' | 'tag'; directed?: boolean };
type SimNode = ApiNode & { x: number; y: number; vx: number; vy: number; fixed?: boolean };
type SimEdge = Omit<ApiEdge, 'source' | 'target'> & { source: SimNode; target: SimNode };
type Graph = { nodes: ApiNode[]; edges: ApiEdge[] };

const colors: Record<NodeType, string> = { article: '#315efb', category: '#d97706', tag: '#059669' };

export default function GraphView({ onEdit }: { onEdit: (path: string) => void }) {
  const t = useI18n(); const labels: Record<NodeType, string> = { article: t('graph.article'), category: t('graph.category'), tag: t('graph.tag') };
  const canvas = useRef<HTMLCanvasElement>(null); const frame = useRef(0); const simulation = useRef<{ nodes: SimNode[]; edges: SimEdge[] }>({ nodes: [], edges: [] });
  const camera = useRef({ x: 0, y: 0, scale: 1 }); const interaction = useRef<{ mode: 'node' | 'canvas'; node?: SimNode; x: number; y: number } | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState('');
  const [types, setTypes] = useState<NodeType[]>(['article', 'category', 'tag']); const [selected, setSelected] = useState<SimNode>(); const [focusId, setFocusId] = useState(''); const [depth, setDepth] = useState(1); const [revision, setRevision] = useState(0);

  const scopedIds = useCallback(() => {
    if (!focusId) return undefined; const visible = new Set([focusId]); let frontier = new Set([focusId]);
    for (let level = 0; level < depth; level += 1) { const next = new Set<string>(); for (const edge of simulation.current.edges) { if (frontier.has(edge.source.id) && !visible.has(edge.target.id)) next.add(edge.target.id); if (frontier.has(edge.target.id) && !visible.has(edge.source.id)) next.add(edge.source.id); } next.forEach((id) => visible.add(id)); frontier = next; }
    return visible;
  }, [depth, focusId]);

  const draw = useCallback(() => {
    const element = canvas.current; if (!element) return; const box = element.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
    element.width = Math.max(1, box.width * ratio); element.height = Math.max(1, box.height * ratio);
    const context = element.getContext('2d'); if (!context) return; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, box.width, box.height);
    const active = new Set(types); const scope = scopedIds(); const search = query.trim().toLocaleLowerCase(); const { nodes, edges } = simulation.current; const visible = new Set(nodes.filter((node) => active.has(node.type) && (!scope || scope.has(node.id))).map((node) => node.id));
    const neighbors = new Set(selected ? [selected.id] : []); if (selected) edges.forEach((edge) => { if (edge.source.id === selected.id) neighbors.add(edge.target.id); if (edge.target.id === selected.id) neighbors.add(edge.source.id); });
    context.save(); context.translate(camera.current.x, camera.current.y); context.scale(camera.current.scale, camera.current.scale);
    for (const edge of edges) {
      if (!visible.has(edge.source.id) || !visible.has(edge.target.id)) continue; const highlighted = !selected || (neighbors.has(edge.source.id) && neighbors.has(edge.target.id));
      context.globalAlpha = highlighted ? (edge.type === 'link' ? .78 : .3) : .06; context.strokeStyle = edge.type === 'link' ? '#315efb' : '#9aa4b2'; context.lineWidth = edge.type === 'link' ? 1.6 : 1;
      context.beginPath(); context.moveTo(edge.source.x, edge.source.y); context.lineTo(edge.target.x, edge.target.y); context.stroke();
      if (edge.directed) { const angle = Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x); const x = edge.target.x - Math.cos(angle) * 10; const y = edge.target.y - Math.sin(angle) * 10; context.fillStyle = '#315efb'; context.beginPath(); context.moveTo(x, y); context.lineTo(x - Math.cos(angle - .5) * 7, y - Math.sin(angle - .5) * 7); context.lineTo(x - Math.cos(angle + .5) * 7, y - Math.sin(angle + .5) * 7); context.fill(); }
    }
    for (const node of nodes) {
      if (!visible.has(node.id)) continue; const matches = !search || node.label.toLocaleLowerCase().includes(search); const highlighted = !selected || neighbors.has(node.id);
      context.globalAlpha = matches && highlighted ? 1 : .15; const radius = 6 + Math.min(7, Math.sqrt(Math.max(1, node.degree)) * 1.5); context.fillStyle = colors[node.type]; context.beginPath(); context.arc(node.x, node.y, radius, 0, Math.PI * 2); context.fill();
      if (node === selected) { context.strokeStyle = '#172033'; context.lineWidth = 2; context.stroke(); }
      if (camera.current.scale > .65 || node === selected || (search && matches)) { context.fillStyle = '#172033'; context.font = `${12 / camera.current.scale}px system-ui`; context.fillText(node.label, node.x + radius + 4, node.y + 4 / camera.current.scale); }
    }
    context.restore(); context.globalAlpha = 1;
  }, [query, scopedIds, selected, types]);

  const fit = useCallback(() => {
    const element = canvas.current; const scope = scopedIds(); const active = new Set(types); const nodes = simulation.current.nodes.filter((node) => active.has(node.type) && (!scope || scope.has(node.id))); if (!element || !nodes.length) return;
    const box = element.getBoundingClientRect(); const xs = nodes.map((node) => node.x); const ys = nodes.map((node) => node.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    camera.current.scale = Math.min(1.3, Math.max(.2, Math.min((box.width - 80) / Math.max(100, maxX - minX), (box.height - 80) / Math.max(100, maxY - minY))));
    camera.current.x = box.width / 2 - ((minX + maxX) / 2) * camera.current.scale; camera.current.y = box.height / 2 - ((minY + maxY) / 2) * camera.current.scale; draw();
  }, [draw, scopedIds, types]);

  const startSimulation = useCallback((data: Graph) => {
    setSelected(undefined); setFocusId('');
    const nodes: SimNode[] = data.nodes.map((node, index) => ({ ...node, x: Math.cos(index * 2.4) * (70 + index * 2), y: Math.sin(index * 2.4) * (70 + index * 2), vx: 0, vy: 0 })); const map = new Map(nodes.map((node) => [node.id, node]));
    const edges = data.edges.flatMap((edge) => { const source = map.get(edge.source); const target = map.get(edge.target); return source && target ? [{ ...edge, source, target }] : []; }); simulation.current = { nodes, edges }; let alpha = 1; let ticks = 0; cancelAnimationFrame(frame.current);
    const box = canvas.current?.getBoundingClientRect(); camera.current = { x: (box?.width || 0) / 2, y: (box?.height || 0) / 2, scale: 1 };
    const tick = (timestamp = performance.now()) => {
      for (const [index, node] of nodes.entries()) { if (node.fixed) continue; node.vx += -node.x * .0007 * alpha + Math.sin(timestamp / 1600 + index * 1.7) * .0025; node.vy += -node.y * .0007 * alpha + Math.cos(timestamp / 1800 + index * 1.3) * .0025; }
      for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) { const a = nodes[i], b = nodes[j]; const dx = b.x - a.x || .1, dy = b.y - a.y || .1, d2 = dx * dx + dy * dy, force = Math.min(1.5, 650 / d2) * alpha; if (!a.fixed) { a.vx -= dx * force / Math.sqrt(d2); a.vy -= dy * force / Math.sqrt(d2); } if (!b.fixed) { b.vx += dx * force / Math.sqrt(d2); b.vy += dy * force / Math.sqrt(d2); } }
      for (const edge of edges) { const dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y, distance = Math.hypot(dx, dy) || 1, force = (distance - (edge.type === 'link' ? 105 : 80)) * .006 * alpha; if (!edge.source.fixed) { edge.source.vx += dx / distance * force; edge.source.vy += dy / distance * force; } if (!edge.target.fixed) { edge.target.vx -= dx / distance * force; edge.target.vy -= dy / distance * force; } }
      for (const node of nodes) if (!node.fixed) { node.vx *= .84; node.vy *= .84; node.x += node.vx; node.y += node.vy; } draw(); ticks += 1; alpha = Math.max(.04, alpha * .975); if (ticks === 36) fit(); frame.current = requestAnimationFrame(tick);
    }; tick();
  }, [draw, fit]);

  const load = useCallback(async () => {
    setLoading(true); setError(''); try { const response = await fetch('/api/graph'); const data = await response.json(); if (!response.ok) throw new Error(data.error || '图谱加载失败'); startSimulation(data); setRevision((value) => value + 1); } catch (reason) { setError(reason instanceof Error ? reason.message : '图谱加载失败'); } finally { setLoading(false); }
  }, [startSimulation]);
  useEffect(() => { load(); return () => cancelAnimationFrame(frame.current); }, []);
  useEffect(() => { draw(); }, [draw, revision]);
  useEffect(() => { if (!simulation.current.nodes.length) return; const request = requestAnimationFrame(fit); return () => cancelAnimationFrame(request); }, [focusId, depth]);
  useEffect(() => { const element = canvas.current; if (!element || typeof ResizeObserver === 'undefined') return undefined; const observer = new ResizeObserver(() => fit()); observer.observe(element); return () => observer.disconnect(); }, [fit, revision]);

  const point = (event: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
  const findNode = (screen: { x: number; y: number }) => { const active = new Set(types); const scope = scopedIds(); const world = { x: (screen.x - camera.current.x) / camera.current.scale, y: (screen.y - camera.current.y) / camera.current.scale }; return [...simulation.current.nodes].reverse().find((node) => active.has(node.type) && (!scope || scope.has(node.id)) && Math.hypot(node.x - world.x, node.y - world.y) < 15 / camera.current.scale); };
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const screen = point(event); const node = findNode(screen); interaction.current = { mode: node ? 'node' : 'canvas', node, ...screen }; if (node) { node.fixed = true; setSelected(node); } };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!interaction.current) return; const screen = point(event); const dx = screen.x - interaction.current.x, dy = screen.y - interaction.current.y; if (interaction.current.mode === 'node' && interaction.current.node) { interaction.current.node.x += dx / camera.current.scale; interaction.current.node.y += dy / camera.current.scale; } else { camera.current.x += dx; camera.current.y += dy; } interaction.current.x = screen.x; interaction.current.y = screen.y; draw(); };
  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => { event.preventDefault(); const screen = point(event); const old = camera.current.scale; const next = Math.max(.2, Math.min(3, old * Math.exp(-event.deltaY * .001))); camera.current.x = screen.x - (screen.x - camera.current.x) * next / old; camera.current.y = screen.y - (screen.y - camera.current.y) * next / old; camera.current.scale = next; draw(); };

  return <div className="graph-page">
    <Card className="graph-toolbar"><Space wrap><Input.Search allowClear placeholder={t('graph.search')} value={query} onChange={(event) => setQuery(event.target.value)} /><Checkbox.Group value={types} onChange={(value) => setTypes(value as NodeType[])}>{(['article', 'category', 'tag'] as NodeType[]).map((type) => <Checkbox key={type} value={type}>{labels[type]}</Checkbox>)}</Checkbox.Group><Select aria-label={t('graph.depth')} value={depth} onChange={setDepth} options={[1, 2, 3].map((value) => ({ value, label: t('graph.layers', { n: value }) }))} />{focusId && <Button onClick={() => setFocusId('')}>{t('graph.global')}</Button>}<Button icon={<ReloadOutlined />} onClick={load}>{t('graph.refresh')}</Button><Button icon={<CompressOutlined />} onClick={fit}>{t('graph.fit')}</Button></Space></Card>
    {error && <Alert type="error" showIcon message={error} />}
    <Card className="graph-card" styles={{ body: { padding: 0, height: '100%' } }}>{loading ? <div className="graph-loading"><Spin /></div> : simulation.current.nodes.length ? <canvas ref={canvas} className="graph-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { interaction.current = undefined; }} onPointerCancel={() => { interaction.current = undefined; }} onWheel={wheel} onDoubleClick={(event) => { const node = findNode(point(event)); if (node?.path) onEdit(node.path); }} /> : <Empty description={t('graph.empty')} />}</Card>
    {selected && <Card size="small"><Space wrap><Tag color={colors[selected.type]}>{labels[selected.type]}</Tag><Typography.Text strong>{selected.label}</Typography.Text>{selected.path && <Button type="primary" onClick={() => onEdit(selected.path!)}>{t('graph.edit')}</Button>}{selected.type === 'article' && focusId !== selected.id && <Button onClick={() => setFocusId(selected.id)}>{t('graph.local')}</Button>}<Button onClick={() => { selected.fixed = false; setSelected(undefined); }}>{t('graph.unpin')}</Button></Space></Card>}
    <Space wrap className="graph-legend"><Tag color={colors.article}>{labels.article}</Tag><Tag color={colors.category}>{labels.category}</Tag><Tag color={colors.tag}>{labels.tag}</Tag><Typography.Text type="secondary">{t('graph.hint')}</Typography.Text></Space>
  </div>;
}
