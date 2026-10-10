import type { ELK as ElkType, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { FlowGraph, FlowNode, FlowNodeKind } from './flowModel';

/**
 * 図の自動配置。ELK（layered）で上から下へ並べ、作った順（答え1→答え2…）を崩さない。
 * 「前に戻る」線は ELK に渡さず、箱やラベルを横切らない経路を自分で選んで外側のレーンに引く。
 */

export interface LayoutBox {
  id: string;
  kind: FlowNodeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: FlowNode;
}

export interface Point { x: number; y: number }

export interface LayoutLabel { x: number; y: number; w: number; h: number; text: string }

export interface LayoutEdge {
  from: string;
  to: string;
  points: Point[];
  label?: LayoutLabel;
  loop: boolean;
}

export interface FlowLayout {
  minX: number;
  width: number;
  height: number;
  boxes: LayoutBox[];
  edges: LayoutEdge[];
}

const SIZE: Record<FlowNodeKind, [number, number]> = {
  start: [44, 44],
  end: [44, 44],
  step: [160, 46],
  question: [190, 56],
  placeholder: [124, 38],
};

const LABEL_FONT = 13;

const elkOptions: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.nodePlacement.favorStraightEdges': 'false',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '52',
  'elk.spacing.edgeNode': '20',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.spacing.edgeEdge': '14',
  'elk.edgeLabels.inline': 'true',
  'elk.spacing.edgeLabel': '4',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
};

let elkInstance: ElkType | null = null;
async function getElk(): Promise<ElkType> {
  if (elkInstance) return elkInstance;
  const mod = await import('elkjs/lib/elk.bundled.js');
  elkInstance = new mod.default();
  return elkInstance;
}

type Box = { x: number; y: number; w: number; h: number; kind: FlowNodeKind };
type Rect = { x: number; y: number; w: number; h: number };
type Seg = [Point, Point];

export async function layoutFlow(graph: FlowGraph): Promise<FlowLayout> {
  const elk = await getElk();
  const children: ElkNode[] = graph.nodes.map((n) => ({ id: n.id, width: SIZE[n.kind][0], height: SIZE[n.kind][1] }));
  const forward = graph.edges.filter((e) => !e.loop);
  const loops = graph.edges.filter((e) => e.loop);
  const elkEdges: ElkExtendedEdge[] = forward.map((e, i) => ({
    id: `e${i}`,
    sources: [e.from],
    targets: [e.to],
    labels: e.label ? [{ text: e.label, width: e.label.length * LABEL_FONT + 8, height: 18 }] : undefined,
  }));
  const result = await elk.layout({ id: 'root', layoutOptions: elkOptions, children, edges: elkEdges });

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const boxes: LayoutBox[] = [];
  const boxMap: Record<string, Box> = {};
  for (const c of result.children ?? []) {
    const node = nodeById.get(c.id);
    if (!node) continue;
    const box = { id: c.id, kind: node.kind, label: node.label, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0, node };
    boxes.push(box);
    boxMap[c.id] = box;
  }

  const edges: LayoutEdge[] = [];
  const fwdSegs: Seg[] = [];
  const labelRects: Rect[] = [];
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    for (let i = 0; i < points.length - 1; i++) fwdSegs.push([points[i], points[i + 1]]);
    let label: LayoutLabel | undefined;
    const l = e.labels?.[0];
    if (l && l.x !== undefined && l.y !== undefined) {
      label = { x: l.x, y: l.y, w: l.width ?? 0, h: l.height ?? 0, text: l.text ?? '' };
      labelRects.push(label);
    }
    edges.push({ from: e.sources?.[0] ?? '', to: e.targets?.[0] ?? '', points, label, loop: false });
  }

  let width = Math.max(Math.ceil(result.width ?? 0), 320);
  let height = Math.max(Math.ceil(result.height ?? 0), 160);
  const routed = routeLoops(loops.map((l) => ({ from: l.from, to: l.to, label: l.label })), boxMap, fwdSegs, labelRects, width, height);
  width = routed.width;
  height = routed.height;
  edges.push(...routed.edges);
  return { minX: routed.minX, width, height, boxes, edges };
}

/**
 * 戻る線の経路選び。左右どちらのレーンか、箱の横から出るか下から出るか、横から入るか上から入るかを
 * すべて試し、いちばん安い経路を採用する。箱を横切る＝禁止、ラベルや他の戻る線を横切る＝高い、
 * 通常の線を横切る＝安い。短い戻る線ほど内側のレーンに置く。
 */
function routeLoops(
  loops: { from: string; to: string; label: string }[],
  boxes: Record<string, Box>,
  fwdSegs: Seg[],
  labelRects: Rect[],
  width: number,
  height: number,
): { edges: LayoutEdge[]; minX: number; width: number; height: number } {
  if (!loops.length) return { edges: [], minX: 0, width, height };
  type Row = { cy: number; top: number; bottom: number };
  const rows: Row[] = [];
  const all = Object.values(boxes);
  for (const b of all) {
    let row = rows.find((r) => Math.abs(r.cy - (b.y + b.h / 2)) < 30);
    if (!row) { row = { cy: b.y + b.h / 2, top: b.y, bottom: b.y + b.h }; rows.push(row); }
    row.top = Math.min(row.top, b.y);
    row.bottom = Math.max(row.bottom, b.y + b.h);
  }
  rows.sort((a, b) => a.cy - b.cy);
  const rowOf = (b: Box) => rows.find((r) => Math.abs(r.cy - (b.y + b.h / 2)) < 30)!;
  const gapBelow = (row: Row) => { const i = rows.indexOf(row); const lim = i < rows.length - 1 ? rows[i + 1].top : row.bottom + 40; return [(row.bottom + lim) / 2, row.bottom + 14]; };
  const gapAbove = (row: Row) => { const i = rows.indexOf(row); const lim = i > 0 ? rows[i - 1].bottom : Math.max(row.top - 40, 0); return [(lim + row.top) / 2, row.top - 14]; };
  const maxRight = Math.max(...all.map((b) => b.x + b.w));
  const minLeft = Math.min(...all.map((b) => b.x));

  const segRect = (a: Point, b: Point, r: Rect) => {
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    return !(x2 <= r.x || x1 >= r.x + r.w || y2 <= r.y || y1 >= r.y + r.h);
  };
  const segSeg = (a: Point, b: Point, c: Point, d: Point) => {
    const h1 = a.y === b.y, h2 = c.y === d.y;
    if (h1 === h2) return false;
    const [h, v] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
    const hx1 = Math.min(h[0].x, h[1].x), hx2 = Math.max(h[0].x, h[1].x), vy1 = Math.min(v[0].y, v[1].y), vy2 = Math.max(v[0].y, v[1].y);
    return v[0].x > hx1 && v[0].x < hx2 && h[0].y > vy1 && h[0].y < vy2;
  };
  const inner = (b: Box): Rect => (b.kind === 'question' ? { x: b.x + b.w / 4, y: b.y + b.h / 4, w: b.w / 2, h: b.h / 2 } : { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 });
  const placed: { segs: Seg[]; label: Rect }[] = [];
  const cost = (pts: Point[], label: Rect, s: Box, t: Box) => {
    let c = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      c += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const bx of all) {
        if (bx === s && i === 0) continue;
        if (bx === t && i === pts.length - 2) continue;
        if (segRect(a, b, inner(bx))) c += 100000;
      }
      for (const r of labelRects) if (segRect(a, b, r)) c += 6000;
      for (const f of fwdSegs) if (segSeg(a, b, f[0], f[1])) c += 150;
      for (const p of placed) {
        for (const q of p.segs) if (segSeg(a, b, q[0], q[1])) c += 2000;
        if (segRect(a, b, p.label)) c += 6000;
      }
    }
    for (const p of placed) for (const q of p.segs) if (segRect(q[0], q[1], label)) c += 6000;
    for (const bx of all) if (segRect({ x: label.x, y: label.y }, { x: label.x + label.w, y: label.y + label.h }, bx)) c += 100000;
    return c;
  };

  const items = loops
    .map((lp) => {
      const s = boxes[lp.from], t = boxes[lp.to];
      if (!s || !t) return null;
      const text = (lp.label ? lp.label + ' ' : '') + '↩ 戻る';
      return { s, t, from: lp.from, to: lp.to, text, lw: text.length * 12 + 10, span: Math.abs(s.y + s.h - t.y) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.span - b.span);

  const lane = { right: maxRight + 36, left: minLeft - 36 };
  const edges: LayoutEdge[] = [];
  let maxBottom = height, minX = 0, maxX = width;
  for (const it of items) {
    const { s, t, from, to, text, lw } = it;
    const scy = s.y + s.h / 2, tcy = t.y + t.h / 2;
    let best: { c: number; pts: Point[]; label: Rect; side: 'left' | 'right' } | null = null;
    for (const side of ['right', 'left'] as const) {
      const laneX = lane[side];
      const exits: Point[][] = [[{ x: side === 'right' ? s.x + s.w : s.x, y: scy }]];
      for (const gy of gapBelow(rowOf(s))) {
        const sx = s.x + s.w * (side === 'right' ? 0.72 : 0.28);
        const sy = s.kind === 'question' ? s.y + s.h - (Math.abs(sx - (s.x + s.w / 2)) / (s.w / 2)) * (s.h / 2) : s.y + s.h;
        exits.push([{ x: sx, y: sy }, { x: sx, y: gy }]);
      }
      const entries: Point[][] = [[{ x: side === 'right' ? t.x + t.w : t.x, y: tcy }]];
      for (const gy of gapAbove(rowOf(t))) {
        const tx = t.x + t.w * (side === 'right' ? 0.72 : 0.28);
        const ty = t.kind === 'question' ? t.y + (Math.abs(tx - (t.x + t.w / 2)) / (t.w / 2)) * (t.h / 2) : t.y;
        entries.push([{ x: tx, y: gy }, { x: tx, y: ty }]);
      }
      for (const ex of exits) for (const en of entries) {
        const y1 = ex[ex.length - 1].y, y2 = en[0].y;
        const pts = [...ex, { x: laneX, y: y1 }, { x: laneX, y: y2 }, ...en];
        const mid = (y1 + y2) / 2;
        for (const ly of [mid, mid - 44, mid + 44]) {
          const label = { x: side === 'right' ? laneX + 8 : laneX - 8 - lw, y: ly - 9, w: lw, h: 18 };
          const c = cost(pts, label, s, t) + (side === 'left' ? 30 : 0);
          if (!best || c < best.c) best = { c, pts, label, side };
        }
      }
    }
    if (!best) continue;
    const { pts, label, side } = best;
    edges.push({ from, to, points: pts, label: { ...label, text }, loop: true });
    placed.push({ segs: pts.slice(1).map((p, i) => [pts[i], p] as Seg), label });
    if (side === 'right') { maxX = Math.max(maxX, label.x + lw + 16); lane.right += lw + 26; }
    else { minX = Math.min(minX, label.x - 16); lane.left -= lw + 26; }
    maxBottom = Math.max(maxBottom, Math.max(...pts.map((p) => p.y)) + 16);
  }
  return { edges, minX, width: maxX - minX, height: Math.max(height, maxBottom) };
}
