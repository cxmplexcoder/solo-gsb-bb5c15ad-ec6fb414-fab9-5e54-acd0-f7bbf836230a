import { config } from './config';
import { DiffResult, Fragment } from './diff';
import { diceSimilarity, normalizeParagraph } from './textutil';

export interface MigrationTarget {
  fragment: Fragment;
  score: number;
}

export interface StoredAnnotationAnchor {
  anchorText: string;
  contextBefore: string;
  contextAfter: string;
}

function contextScore(a: StoredAnnotationAnchor, c: Fragment): number {
  // 空上下文视为中性（不奖励也不惩罚）
  const hasBefore = normalizeParagraph(a.contextBefore).length > 0
    || normalizeParagraph(c.contextBefore).length > 0;
  const hasAfter = normalizeParagraph(a.contextAfter).length > 0
    || normalizeParagraph(c.contextAfter).length > 0;
  let sum = 0;
  let w = 0;
  if (hasBefore) {
    sum += diceSimilarity(a.contextBefore, c.contextBefore);
    w += 1;
  }
  if (hasAfter) {
    sum += diceSimilarity(a.contextAfter, c.contextAfter);
    w += 1;
  }
  return w === 0 ? 0.5 : sum / w;
}

/**
 * 在新版本 diff 的全部片段中寻找与旧批注锚点最相近的片段。
 * score = 0.75 * 锚点相似度 + 0.25 * 上下文相似度
 * 内联片段边界可能因重新分词漂移，因此锚点同时与片段文本和整段文本比较。
 */
export function findBestFragment(
  diff: DiffResult,
  anchor: StoredAnnotationAnchor,
): MigrationTarget | null {
  let best: MigrationTarget | null = null;
  const normAnchor = normalizeParagraph(anchor.anchorText);

  for (const row of diff.rows) {
    for (const fragment of row.fragments) {
      // equal 行整段不是可批注/可点击的差异片段，不能作为迁移目标
      if (fragment.side === 'both') continue;
      let base = diceSimilarity(anchor.anchorText, fragment.text);
      if (fragment.fullText && fragment.fullText !== fragment.text) {
        base = Math.max(base, diceSimilarity(anchor.anchorText, fragment.fullText));
      }
      if (normAnchor && normAnchor === normalizeParagraph(fragment.text)) base = 1;

      const ctx = contextScore(anchor, fragment);
      const score = 0.75 * base + 0.25 * ctx;

      if (!best || score > best.score) best = { fragment, score };
    }
  }
  return best;
}

/** 是否达到可靠迁移阈值（低于则标“待复核”）。 */
export function isReliable(score: number): boolean {
  return score >= config.anchorThreshold;
}
