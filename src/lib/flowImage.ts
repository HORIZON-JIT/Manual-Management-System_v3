/**
 * 画面上の SVG（フロー図）を PNG のバイト列にする。Word への貼り付け用。
 * 文字のフォントは描画環境のものになる。
 */
export async function svgElementToPng(svg: SVGSVGElement, scale = 2): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const vb = svg.viewBox.baseVal;
  const width = Math.max(1, Math.round(vb && vb.width ? vb.width : svg.clientWidth || Number(svg.getAttribute('width')) || 800));
  const height = Math.max(1, Math.round(vb && vb.height ? vb.height : svg.clientHeight || Number(svg.getAttribute('height')) || 600));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // 外部フォントに頼らないよう、標準的なフォント名を明示する
  clone.style.fontFamily = '"MS Gothic", "Yu Gothic", "Noto Sans JP", "IPAGothic", sans-serif';
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
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { data: bytes, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVG 文字列（Mermaid の出力など）を PNG にする */
export async function svgStringToPng(svgText: string, scale = 2): Promise<{ data: Uint8Array; width: number; height: number } | null> {
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
