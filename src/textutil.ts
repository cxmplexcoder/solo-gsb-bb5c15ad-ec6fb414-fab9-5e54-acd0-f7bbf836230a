/**
 * 文本处理工具：段落切分、规范化、内联差异分词、相似度（字符二元组 Dice 系数）。
 */

/** 按行切分段落：空行忽略，每行视为一个条文/段落。 */
export function splitParagraphs(text: string): string[] {
  return (text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 段落级比较用的规范化：折叠空白、拉丁字母小写、全角转半角兼容。 */
export function normalizeParagraph(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const TOKEN_RE = /([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*)|(\s+)|([\s\S])/g;

/**
 * 内联差异分词：
 * - 连续拉丁字母/数字作为一个 token（兼容条款号 3.2.1 之类）
 * - 空白作为 token
 * - 其余（中文等）单字成 token
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

export interface TokenOp {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/** 两个 token 序列的 LCS 差异。 */
export function diffTokens(a: string[], b: string[]): TokenOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rev: TokenOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: TokenOp['type'], text: string) => {
    const last = rev[rev.length - 1];
    if (last && last.type === type) last.text += text;
    else rev.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('delete', a[i]);
      i++;
    } else {
      push('insert', b[j]);
      j++;
    }
  }
  while (i < n) {
    push('delete', a[i]);
    i++;
  }
  while (j < m) {
    push('insert', b[j]);
    j++;
  }
  return rev;
}

/** 相似度用的规范化字符串。 */
export function normalizeForSimilarity(s: string): string {
  return normalizeParagraph(s);
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  if (s.length === 1) set.add(s);
  return set;
}

/** Sørensen–Dice 字符二元组相似度，[0,1]。对中文和拉丁词均适用。 */
export function diceSimilarity(a: string, b: string): number {
  const x = normalizeForSimilarity(a);
  const y = normalizeForSimilarity(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
