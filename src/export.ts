import { db } from './db';
import { DiffResult } from './diff';

export interface ExportData {
  document: { id: number; title: string };
  version: { id: number; versionNo: number; label: string | null; createdAt: string };
  generatedAt: string;
  statistics: Record<string, number>;
  annotations: Array<Record<string, unknown>>;
}

function buildStats(annotations: { status: string; needs_review: number }[]) {
  return {
    total: annotations.length,
    open: annotations.filter((a) => a.status === 'open' && !a.needs_review).length,
    needsReview: annotations.filter((a) => !!a.needs_review).length,
    resolved: annotations.filter((a) => a.status === 'resolved').length,
    rejected: annotations.filter((a) => a.status === 'rejected').length,
  };
}

export function buildExport(versionId: number): { data: ExportData; diff: DiffResult | null } {
  const version = db
    .prepare(
      `SELECT v.*, d.title AS doc_title
       FROM versions v JOIN documents d ON d.id = v.document_id
       WHERE v.id = ?`,
    )
    .get(versionId) as any;
  if (!version) throw new Error('version not found');

  const annotations = db
    .prepare(
      `SELECT * FROM annotations WHERE version_id = ? ORDER BY created_at, id`,
    )
    .all(versionId) as any[];

  const migrations = db
    .prepare(
      `SELECT m.*, a.author FROM migrations m
       JOIN annotations a ON a.id = m.annotation_id
       WHERE m.to_version_id = ? ORDER BY m.id`,
    )
    .all(versionId) as any[];
  const migByAnn = new Map(migrations.map((m) => [m.annotation_id, m]));

  const decorated = annotations.map((a) => ({
    id: a.id,
    author: a.author,
    status: a.status,
    needsReview: !!a.needs_review,
    fragmentKey: a.fragment_key || null,
    anchorText: a.anchor_text,
    content: a.content,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    migration: migByAnn.has(a.id)
      ? {
          matched: !!migByAnn.get(a.id)!.matched,
          score: Number(migByAnn.get(a.id)!.score.toFixed(3)),
          suggestedFragmentKey: migByAnn.get(a.id)!.suggested_key || null,
        }
      : null,
  }));

  return {
    data: {
      document: { id: version.document_id, title: version.doc_title },
      version: {
        id: version.id,
        versionNo: version.version_no,
        label: version.label,
        createdAt: version.created_at,
      },
      generatedAt: new Date().toISOString(),
      statistics: buildStats(annotations),
      annotations: decorated,
    },
    diff: null,
  };
}

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  resolved: '已解决',
  rejected: '已驳回',
};

export function toMarkdown(data: ExportData): string {
  const lines: string[] = [];
  lines.push(`# 条文变更审阅报告`);
  lines.push('');
  lines.push(`- 规范：**${data.document.title}**`);
  lines.push(`- 版本：v${data.version.versionNo}${data.version.label ? `（${data.version.label}）` : ''}`);
  lines.push(`- 版本入库时间：${data.version.createdAt}`);
  lines.push(`- 报告生成时间：${data.generatedAt}`);
  lines.push('');
  lines.push('## 统计');
  lines.push('');
  lines.push(`| 指标 | 数量 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 批注总数 | ${data.statistics.total} |`);
  lines.push(`| 待处理 | ${data.statistics.open} |`);
  lines.push(`| 待复核（锚点迁移失败） | ${data.statistics.needsReview} |`);
  lines.push(`| 已解决 | ${data.statistics.resolved} |`);
  lines.push(`| 已驳回 | ${data.statistics.rejected} |`);
  lines.push('');
  lines.push('## 批注明细');
  lines.push('');

  data.annotations.forEach((a, i) => {
    const review = a.needsReview ? ' ⚠️待复核' : '';
    lines.push(`### ${i + 1}. [${STATUS_LABEL[a.status as string] ?? a.status}]${review} ${a.author}`);
    lines.push('');
    lines.push(`**锚点片段：**`);
    lines.push('');
    lines.push('> ' + String(a.anchorText || '（无）').replace(/\n/g, '\n> '));
    lines.push('');
    lines.push(`**批注内容：** ${a.content}`);
    lines.push('');
    const mig = a.migration as { matched: boolean; score: number } | null;
    if (mig) {
      lines.push(
        `**迁移记录：** ${mig.matched ? '已自动迁移' : '未找到可靠匹配'}，相似度 ${mig.score}`,
      );
      lines.push('');
    }
    lines.push(`*创建：${a.createdAt} ｜ 更新：${a.updatedAt}*`);
    lines.push('');
  });

  return lines.join('\n');
}
