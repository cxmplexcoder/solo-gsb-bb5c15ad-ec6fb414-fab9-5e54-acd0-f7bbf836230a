import express from 'express';
import { db } from './db';
import { computeDiff, findFragment } from './diff';
import { findBestFragment, isReliable } from './migration';
import { buildExport, toMarkdown } from './export';

export const api = express.Router();

const STATUSES = ['open', 'resolved', 'rejected'];

// ---------- 文档 ----------

api.get('/documents', (_req, res) => {
  const docs = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM versions v WHERE v.document_id = d.id) AS version_count,
              (SELECT MAX(version_no) FROM versions v WHERE v.document_id = d.id) AS latest_version_no
       FROM documents d ORDER BY d.id DESC`,
    )
    .all();
  res.json(docs);
});

api.post('/documents', (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title 不能为空' });
  const info = db.prepare('INSERT INTO documents (title) VALUES (?)').run(title);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

api.get('/documents/:id', (req, res) => {
  const id = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  const versions = db
    .prepare(
      `SELECT id, version_no, label, old_version_id, created_at,
              length(old_text) AS old_length, length(new_text) AS new_length
       FROM versions WHERE document_id = ? ORDER BY version_no`,
    )
    .all(id);
  res.json({ ...doc, versions });
});

api.delete('/documents/:id', (req, res) => {
  const info = db.prepare('DELETE FROM documents WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: '文档不存在' });
  res.status(204).end();
});

// ---------- 版本 ----------

api.post('/documents/:id/versions', (req, res) => {
  const documentId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc) return res.status(404).json({ error: '文档不存在' });

  const oldText = String(req.body?.oldText ?? '');
  const newText = String(req.body?.newText ?? '');
  const label = req.body?.label ? String(req.body.label).trim() : null;
  if (!newText.trim()) return res.status(400).json({ error: 'newText 不能为空' });

  const prev = db
    .prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY version_no DESC LIMIT 1')
    .get(documentId) as any;

  const result = db.transaction(() => {
    const versionNo = prev ? prev.version_no + 1 : 1;
    const effectiveOld = prev ? prev.new_text : oldText;

    const diff = computeDiff(effectiveOld, newText);

    const info = db
    .prepare(
      `INSERT INTO versions (document_id, version_no, label, old_version_id, old_text, new_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(documentId, versionNo, label, prev ? prev.id : null, effectiveOld, newText);
    const versionId = Number(info.lastInsertRowid);

    let migrated = 0;
    let needsReview = 0;

    if (prev) {
      const openAnns = db
        .prepare(
          `SELECT * FROM annotations
           WHERE version_id = ? AND status = 'open'`,
        )
        .all(prev.id) as any[];

      for (const ann of openAnns) {
        const best = findBestFragment(diff, {
          anchorText: ann.anchor_text,
          contextBefore: ann.context_before,
          contextAfter: ann.context_after,
        });
        const score = best?.score ?? 0;
        const matched = best ? isReliable(score) : false;

        let newFragmentKey = ann.fragment_key;
        let anchorText = ann.anchor_text;
        let ctxBefore = ann.context_before;
        let ctxAfter = ann.context_after;

        if (matched && best) {
          newFragmentKey = best.fragment.key;
          anchorText = best.fragment.text;
          ctxBefore = best.fragment.contextBefore;
          ctxAfter = best.fragment.contextAfter;
          migrated++;
        } else {
          needsReview++;
        }

        const ins = db
          .prepare(
            `INSERT INTO annotations
               (document_id, version_id, fragment_key, anchor_text, context_before, context_after,
                author, content, status, needs_review)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
          )
          .run(
            documentId,
            versionId,
            newFragmentKey,
            anchorText,
            ctxBefore,
            ctxAfter,
            ann.author,
            ann.content,
            matched ? 0 : 1,
          );
        const newId = Number(ins.lastInsertRowid);

        db.prepare(
          `INSERT INTO migrations
             (annotation_id, from_version_id, to_version_id, score, matched, suggested_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          newId,
          prev.id,
          versionId,
          score,
          matched ? 1 : 0,
          matched || !best ? '' : best.fragment.key,
        );
      }
    }

    return { versionId, versionNo, migrated, needsReview };
  })();

  res.status(201).json(result);
});

api.get('/versions/:id', (req, res) => {
  const id = Number(req.params.id);
  const version = db
    .prepare(
      `SELECT v.*, d.title AS doc_title FROM versions v
       JOIN documents d ON d.id = v.document_id WHERE v.id = ?`,
    )
    .get(id) as any;
  if (!version) return res.status(404).json({ error: '版本不存在' });

  const diff = computeDiff(version.old_text, version.new_text);
  const validKeys = new Set<string>();
  diff.rows.forEach((r) => r.fragments.forEach((f) => validKeys.add(f.key)));

  const where: string[] = ['version_id = ?'];
  const params: unknown[] = [id];
  const status = String(req.query.status || '');
  if (STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (String(req.query.review || '') === '1') where.push('needs_review = 1');
  if (String(req.query.review || '') === '0') where.push('needs_review = 0');
  const author = String(req.query.author || '').trim();
  if (author) {
    where.push('author = ?');
    params.push(author);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push('(content LIKE ? OR anchor_text LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const annotations = db
    .prepare(
      `SELECT * FROM annotations WHERE ${where.join(' AND ')} ORDER BY id`,
    )
    .all(...params) as any[];

  const migs = db
    .prepare('SELECT * FROM migrations WHERE to_version_id = ?')
    .all(id) as any[];
  const migByAnn = new Map(migs.map((m) => [m.annotation_id, m]));

  const migrations = db
    .prepare(
      `SELECT m.*, a.content, a.author FROM migrations m
       JOIN annotations a ON a.id = m.annotation_id
       WHERE m.to_version_id = ? ORDER BY m.id`,
    )
    .all(id);

  res.json({
    id: version.id,
    documentId: version.document_id,
    docTitle: version.doc_title,
    versionNo: version.version_no,
    label: version.label,
    oldVersionId: version.old_version_id,
    createdAt: version.created_at,
    diff: {
      rows: diff.rows.map((r) => ({
        type: r.type,
        rowKey: r.rowKey,
        oldText: r.oldText,
        newText: r.newText,
        inlineOps: r.inlineOps,
        fragments: r.fragments,
      })),
    },
    migrations,
    annotations: annotations.map((a) => ({
      id: a.id,
      author: a.author,
      content: a.content,
      status: a.status,
      needsReview: !!a.needs_review,
      fragmentKey: a.fragment_key,
      anchorText: a.anchor_text,
      fragmentValid: validKeys.has(a.fragment_key),
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      migration: migByAnn.has(a.id)
        ? {
            matched: !!migByAnn.get(a.id)!.matched,
            score: Number(migByAnn.get(a.id)!.score.toFixed(3)),
            suggestedKey: migByAnn.get(a.id)!.suggested_key || null,
          }
        : null,
    })),
  });
});

// ---------- 批注 ----------

api.post('/versions/:id/annotations', (req, res) => {
  const versionId = Number(req.params.id);
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId) as any;
  if (!version) return res.status(404).json({ error: '版本不存在' });

  const fragmentKey = String(req.body?.fragmentKey || '');
  const author = String(req.body?.author || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!fragmentKey) return res.status(400).json({ error: 'fragmentKey 不能为空' });
  if (!author) return res.status(400).json({ error: 'author 不能为空' });
  if (!content) return res.status(400).json({ error: '批注内容不能为空' });

  const diff = computeDiff(version.old_text, version.new_text);
  const fragment = findFragment(diff, fragmentKey);
  if (!fragment || fragment.side === 'both') {
    return res.status(400).json({ error: '片段不存在或已失效' });
  }

  const info = db
    .prepare(
      `INSERT INTO annotations
         (document_id, version_id, fragment_key, anchor_text, context_before, context_after,
          author, content, status, needs_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)`,
    )
    .run(
      version.document_id,
      versionId,
      fragment.key,
      fragment.text,
      fragment.contextBefore,
      fragment.contextAfter,
      author,
      content,
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

api.patch('/annotations/:id', (req, res) => {
  const id = Number(req.params.id);
  const ann = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as any;
  if (!ann) return res.status(404).json({ error: '批注不存在' });

  const sets: string[] = [];
  const params: unknown[] = [];
  if (req.body?.status !== undefined) {
    const status = String(req.body.status);
    if (!STATUSES.includes(status)) return res.status(400).json({ error: '非法 status' });
    sets.push('status = ?');
    params.push(status);
    // 人工更新状态后，“待复核”标记保留——由单独 attach 动作清除
  }
  if (req.body?.needsReview !== undefined) {
    sets.push('needs_review = ?');
    params.push(req.body.needsReview ? 1 : 0);
  }
  if (sets.length === 0) return res.status(400).json({ error: '没有可更新字段' });

  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

/** 人工确认“待复核”批注的归属片段。 */
api.post('/annotations/:id/attach', (req, res) => {
  const id = Number(req.params.id);
  const ann = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as any;
  if (!ann) return res.status(404).json({ error: '批注不存在' });
  const fragmentKey = String(req.body?.fragmentKey || '');
  if (!fragmentKey) return res.status(400).json({ error: 'fragmentKey 不能为空' });

  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(ann.version_id) as any;
  const diff = computeDiff(version.old_text, version.new_text);
  const fragment = findFragment(diff, fragmentKey);
  if (!fragment || fragment.side === 'both') {
    return res.status(400).json({ error: '片段不存在或已失效' });
  }

  db.prepare(
    `UPDATE annotations SET fragment_key = ?, anchor_text = ?, context_before = ?,
       context_after = ?, needs_review = 0, updated_at = datetime('now') WHERE id = ?`,
  ).run(fragment.key, fragment.text, fragment.contextBefore, fragment.contextAfter, id);
  res.json({ ok: true });
});

api.delete('/annotations/:id', (req, res) => {
  const info = db.prepare('DELETE FROM annotations WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: '批注不存在' });
  res.status(204).end();
});

// ---------- 导出 ----------

api.get('/versions/:id/export', (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM versions WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: '版本不存在' });
  const { data } = buildExport(id);
  const format = String(req.query.format || 'md');
  const base = `review-v${data.version.versionNo}`;
  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(data, null, 2));
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.md"`);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(toMarkdown(data));
  }
});
