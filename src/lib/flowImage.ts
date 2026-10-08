/**
 * 画面上の SVG（フロー図）を PNG のバイト列にする。Word への貼り付け用。
 * 文字のフォントは描画環境のものになる。
 *
 * ブラウザは SVG に外部参照（外部フォントの @import、外部画像、foreignObject など）があると
 * canvas を「汚染」扱いにして取り出しを拒否するため、画像化の前に取り除く。
 */

export interface FlowImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 外部参照を取り除いた SVG を返す（元の要素は変更しない） */
export function sanitizeSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('script').forEach((el) => el.remove());
  // foreignObject（HTML のラベル）は canvas を汚染するので、同じ位置の SVG テキストに置き換える
  clone.querySelectorAll('foreignObject').forEach((fo) => foreignObjectToText(fo as SVGForeignObjectElement));
  clone.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeCss(style.textContent ?? '');
  });
  clone.querySelectorAll('*').forEach((el) => {
    for (const name of ['href', 'xlink:href']) {
      const value = el.getAttribute(name);
      if (value && /^(https?:)?\/\//i.test(value.trim())) {
        if (el.tagName.toLowerCase() === 'image') el.remove();
        else el.removeAttribute(name);
      }
    }
    const style = el.getAttribute('style');
    if (style && /url\(/i.test(style)) el.setAttribute('style', sanitizeCss(style));
  });
  clone.style.fontFamily = '"MS Gothic", "Yu Gothic", "Noto Sans JP", "IPAGothic", sans-serif';
  return clone;
}

function foreignObjectToText(fo: SVGForeignObjectElement) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const x = Number(fo.getAttribute('x') ?? 0);
  const y = Number(fo.getAttribute('y') ?? 0);
  const w = Number(fo.getAttribute('width') ?? 0);
  const h = Number(fo.getAttribute('height') ?? 0);
  const html = fo.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const lines = (tmp.textContent ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const fontSize = 14;
  const lineHeight = fontSize * 1.25;
  const group = document.createElementNS(SVG_NS, 'g');
  lines.forEach((line, i) => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x + w / 2));
    text.setAttribute('y', String(y + h / 2 + (i - (lines.length - 1) / 2) * lineHeight + fontSize * 0.35));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('fill', '#111827');
    text.textContent = line;
    group.appendChild(text);
  });
  fo.replaceWith(group);
}

/** CSS から @import と外部 url() を取り除く */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi, 'none');
}

export async function svgElementToPng(svg: SVGSVGElement, scale = 2): Promise<FlowImage | null> {
  const vb = svg.viewBox.baseVal;
  const width = Math.max(1, Math.round(vb && vb.width ? vb.width : svg.clientWidth || Number(svg.getAttribute('width')) || 800));
  const height = Math.max(1, Math.round(vb && vb.height ? vb.height : svg.clientHeight || Number(svg.getAttribute('height')) || 600));
  const clone = sanitizeSvg(svg);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('フロー図の画像化に失敗しました'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      return null; // 汚染された canvas は取り出せない。呼び出し側で「図なし」にする
    }
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { data: bytes, width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVG 文字列（Mermaid の出力など）を PNG にする */
export async function svgStringToPng(svgText: string, scale = 2): Promise<FlowImage | null> {
  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.innerHTML = svgText;
  document.body.appendChild(holder);
  try {
    const svg = holder.querySelector('svg');
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (!svg.getAttribute('viewBox') && box.width && box.height) svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    return await svgElementToPng(svg, scale);
  } finally {
    holder.remove();
  }
}
