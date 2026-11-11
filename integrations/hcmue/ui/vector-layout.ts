import { PCA } from "ml-pca";
import type { KnowledgeMapPoint } from "../knowledge/documents";
export type VectorPoint = KnowledgeMapPoint & { position: [number, number, number] };
export function projectVectors(points: KnowledgeMapPoint[]): VectorPoint[] {
  if (!points.length) return [];
  if (!points.every(point => point.embedding.length === points[0].embedding.length && point.embedding.every(Number.isFinite)))
    throw new Error("Các vector không cùng số chiều.");
  if (points.length === 1) return [{ ...points[0], position: [0, 0, 0] }];
  const vectors = points.map(point => point.embedding);
  const dimensions = Math.min(3, points.length, points[0].embedding.length);
  const rows = new PCA(vectors).predict(vectors, { nComponents: dimensions }).to2DArray();
  const scale = Math.max(...rows.flatMap(row => row.map(Math.abs)), 1e-8);
  return points.map((point, index) => ({
    ...point, position: [0, 1, 2].map(axis => 3 * (rows[index][axis] ?? 0) / scale) as [number, number, number],
  }));
}
export function vectorEdges(points: VectorPoint[]) {
  const edges = new Set<string>();
  const pairs: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i].embedding, normA = Math.hypot(...a);
    const nearest = points.flatMap((point, j) => {
      if (i === j) return [];
      const b = point.embedding;
      const similarity = a.reduce((sum, value, k) => sum + value * b[k], 0) / (normA * Math.hypot(...b) || 1);
      return similarity >= .55 ? [{ j, similarity }] : [];
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 2);
    for (const { j } of nearest) {
      const key = [Math.min(i, j), Math.max(i, j)].join("-");
      if (!edges.has(key)) { edges.add(key); pairs.push([i, j]); }
    }
  }
  return pairs;
}
