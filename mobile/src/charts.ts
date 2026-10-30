// SVG 꺾은선 그래프(외부 라이브러리 없음). 점수 변화(등급 기준선 점선)와 PUMBILITY 추이에 쓴다.

export interface Point {
  label: string; // x축 아래 글자(날짜)
  value: number;
}

export interface Guide {
  value: number;
  label: string;
  color: string;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  guides?: Guide[];
  min?: number;
  max?: number;
  ariaLabel: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 점들을 왼쪽부터 같은 간격으로 놓고 이은 꺾은선. 마지막 점은 강조한다. */
export function lineChart(points: Point[], o: ChartOptions): string {
  const w = o.width ?? 326;
  const h = o.height ?? 140;
  const top = 12;
  const bottom = h - 22; // x축 글자 자리
  const left = 20;
  const right = w - 21;
  if (!points.length) return "";

  const values = points.map((p) => p.value);
  let min = o.min ?? Math.min(...values);
  let max = o.max ?? Math.max(...values);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const x = (i: number) => (points.length === 1 ? (left + right) / 2 : left + (i * (right - left)) / (points.length - 1));

  const guides = (o.guides ?? [])
    .filter((g) => g.value >= min && g.value <= max)
    .map((g) => {
      const gy = y(g.value).toFixed(1);
      return `<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="${g.color}" stroke-opacity="0.35" stroke-dasharray="3 4"/>` +
        `<text x="${w - 2}" y="${(Number(gy) - 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${g.color}">${esc(g.label)}</text>`;
    })
    .join("");

  const coords = points.map((p, i) => [x(i), y(p.value)] as const);
  const line = coords.length > 1
    ? `<polyline points="${coords.map(([cx, cy]) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ")}" fill="none" stroke="#7FD3FF" stroke-width="2.5" stroke-linejoin="round"/>`
    : "";
  const dots = coords.map(([cx, cy], i) => i === coords.length - 1
    ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#E8EAEE" stroke="#7FD3FF" stroke-width="2"/>`
    : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="#7FD3FF"/>`).join("");

  // 날짜 글자는 최대 5개(처음·끝 포함)만 찍는다.
  const step = Math.max(1, Math.ceil((points.length - 1) / 4));
  const labels = points
    .map((p, i) => (i % step === 0 || i === points.length - 1
      ? `<text x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="#8A909C">${esc(p.label)}</text>` : ""))
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(o.ariaLabel)}" preserveAspectRatio="xMidYMid meet">` +
    `${guides}${line}${dots}${labels}</svg>`;
}

/** 점수 그래프의 세로 범위: 등급 기준선(S~SSS)이 보이도록 넉넉히 잡는다. */
export function scoreRange(values: number[]): { min: number; max: number } {
  const lo = Math.min(...values, 965_000);
  const hi = Math.max(...values, 992_000);
  return { min: Math.floor((lo - 3_000) / 1000) * 1000, max: Math.min(1_000_000, Math.ceil((hi + 3_000) / 1000) * 1000) };
}

export const GRADE_GUIDES: Guide[] = [
  { value: 990_000, label: "SSS", color: "#F5C542" },
  { value: 980_000, label: "SS", color: "#E6D29A" },
  { value: 970_000, label: "S", color: "#9FD5FF" },
];
