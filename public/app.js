/* 条文变更审阅台 — 前端单页应用（原生 JS） */
'use strict';

const app = document.getElementById('app');
const topActions = document.getElementById('topActions');
const toastEl = document.getElementById('toast');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function hashGo(h) {
  location.hash = h;
}

document.getElementById('brand').addEventListener('click', () => hashGo('#/'));

/* ---------------- 首页：文档列表 ---------------- */

async function renderHome() {
  topActions.innerHTML = '';
  const docs = await api('/api/documents');
  app.innerHTML = `
    <div class="card">
      <h2>新建规范文档</h2>
      <div class="row-flex">
        <input type="text" id="docTitle" placeholder="规范名称，例如：建筑防火通用规范（送审稿）" />
        <button class="primary" id="createDoc">创建</button>
      </div>
    </div>
    <div class="card">
      <h2>文档列表（${docs.length}）</h2>
      ${
        docs.length === 0
          ? '<p class="muted">还没有文档，先在上方创建一个。</p>'
          : `<div class="doc-grid">${docs
              .map(
                (d) => `
            <div class="doc-item" data-id="${d.id}">
              <div class="title">${esc(d.title)}</div>
              <div class="meta">版本数：${d.version_count}${
                  d.latest_version_no ? ` ｜ 最新：v${d.latest_version_no}` : ''
                }</div>
              <div class="muted">创建于 ${esc(d.created_at)}</div>
            </div>`,
              )
              .join('')}</div>`
      }
    </div>`;

  document.getElementById('createDoc').addEventListener('click', async () => {
    const title = document.getElementById('docTitle').value.trim();
    if (!title) return toast('请输入规范名称');
    const d = await api('/api/documents', { method: 'POST', body: { title } });
    hashGo(`#/doc/${d.id}`);
  });
  document.getElementById('docTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('createDoc').click();
  });
  app.querySelectorAll('.doc-item').forEach((el) =>
    el.addEventListener('click', () => hashGo(`#/doc/${el.dataset.id}`)),
  );
}

/* ---------------- 文档页：导入版本 ---------------- */

async function renderDoc(id) {
  topActions.innerHTML = '<button onclick="location.hash=\'#/\'">← 返回列表</button>';
  const doc = await api(`/api/documents/${id}`);
  app.innerHTML = `
    <div class="card">
      <div class="row-flex between">
        <h2 style="margin:0">${esc(doc.title)}</h2>
        <button class="danger small" id="delDoc">删除文档</button>
      </div>
    </div>

    <div class="card">
      <h2>${doc.versions.length === 0 ? '导入初始版本' : '导入新版本'}</h2>
      <div id="importMsg"></div>
      <label>版本标签（可选，如“送审稿”“报批稿”）</label>
      <input type="text" id="vLabel" placeholder="例如：送审稿" />
      ${
        doc.versions.length === 0
          ? `
        <label>修订前文本（每行一个条文/段落，空行忽略）</label>
        <textarea id="oldText" placeholder="粘贴旧版条文…"></textarea>`
          : `<div class="note-box">检测到已有 <b>${
              doc.versions.length
            }</b> 个版本；前版文本自动取最新版本（v${
              doc.versions[doc.versions.length - 1].version_no
            }）的“修订后文本”。导入后未解决批注将通过文本锚点迁移。</div>`
      }
      <label>修订后文本（每行一个条文/段落，空行忽略）</label>
      <textarea id="newText" placeholder="粘贴新版条文…"></textarea>
      <div class="row-flex" style="margin-top:10px">
        <button class="primary" id="importBtn">计算差异并导入</button>
      </div>
      <div id="importResult"></div>
    </div>

    <div class="card">
      <h2>版本</h2>
      ${
        doc.versions.length === 0
          ? '<p class="muted">尚未导入任何版本。</p>'
          : `<div class="version-pills">${doc.versions
              .map(
                (v) => `<span class="pill" data-vid="${v.id}">v${v.version_no}${
                  v.label ? ' ' + esc(v.label) : ''
                }</span>`,
              )
              .join('')}</div>`
      }
    </div>`;

  app.querySelectorAll('.pill').forEach((p) =>
    p.addEventListener('click', () => hashGo(`#/review/${p.dataset.vid}`)),
  );

  document.getElementById('delDoc').addEventListener('click', async () => {
    if (!confirm(`确认删除文档「${doc.title}」及其全部版本与批注？`)) return;
    await api(`/api/documents/${id}`, { method: 'DELETE' });
    hashGo('#/');
  });

  document.getElementById('importBtn').addEventListener('click', async () => {
    const label = document.getElementById('vLabel').value.trim();
    const newText = document.getElementById('newText').value;
    const oldTextEl = document.getElementById('oldText');
    const oldText = oldTextEl ? oldTextEl.value : '';
    const resultEl = document.getElementById('importResult');
    if (!newText.trim()) return toast('请粘贴修订后文本');
    try {
      const r = await api(`/api/documents/${id}/versions`, {
        method: 'POST',
        body: { oldText, newText, label: label || null },
      });
      resultEl.innerHTML = `<div class="success">
        已创建 v${r.versionNo}：自动迁移批注 <b>${r.migrated}</b> 条，
        <b>${r.needsReview}</b> 条无法可靠匹配，已标记为待复核。</div>`;
      toast('版本导入完成');
      setTimeout(() => hashGo(`#/review/${r.versionId}`), 600);
    } catch (e) {
      resultEl.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  });
}

/* ---------------- 审阅页 ---------------- */

const reviewState = {
  data: null,
  selectedKey: null, // 新建批注时选中的片段
  attachMode: null, // 待重新定位的批注 id
  filters: { status: '', review: '', author: '', q: '' },
};

function annCountsByKey(data) {
  const m = new Map();
  for (const a of data.annotations) {
    if (!a.fragmentKey) continue;
    const arr = m.get(a.fragmentKey) || [];
    arr.push(a);
    m.set(a.fragmentKey, arr);
  }
  return m;
}

function renderChunks(data) {
  const counts = annCountsByKey(data);
  return data.diff.rows
    .map((row, idx) => {
      const badgeFor = (key) => {
        const arr = counts.get(key);
        if (!arr || arr.length === 0) return '';
        const review = arr.some((a) => a.needsReview);
        return `<span class="frag-mark ${review ? 'review' : ''}" title="${arr.length} 条批注">${arr.length}</span>`;
      };

      if (row.type === 'equal') {
        return `<div class="diff-row equal">
          <div class="diff-cell">${esc(row.oldText)}</div>
          <div class="diff-cell">${esc(row.newText)}</div>
        </div>`;
      }

      if (row.type === 'insert') {
        const f = row.fragments[0];
        return `<div class="diff-row row-ins">
          <div class="diff-cell empty"><span class="cell-badge">—</span></div>
          <div class="diff-cell"><span class="chunk-ins" data-key="${esc(f.key)}">${esc(
          row.newText,
        )}</span>${badgeFor(f.key)}</div>
        </div>`;
      }

      if (row.type === 'delete') {
        const f = row.fragments[0];
        return `<div class="diff-row row-del">
          <div class="diff-cell"><span class="chunk-del" data-key="${esc(f.key)}">${esc(
          row.oldText,
        )}</span>${badgeFor(f.key)}</div>
          <div class="diff-cell empty"><span class="cell-badge">—</span></div>
        </div>`;
      }

      // change：双栏内联渲染
      const fragByOp = new Map(row.fragments.map((f) => [f.opIndex, f]));
      const renderCell = (side) =>
        row.inlineOps
          .map((op, i) => {
            if (op.type === 'equal') return esc(op.text);
            if (side === 'old' && op.type === 'delete') {
              const f = fragByOp.get(i);
              return `<span class="chunk-del" data-key="${esc(f.key)}">${esc(
                op.text,
              )}</span>${badgeFor(f.key)}`;
            }
            if (side === 'new' && op.type === 'insert') {
              const f = fragByOp.get(i);
              return `<span class="chunk-ins" data-key="${esc(f.key)}">${esc(
                op.text,
              )}</span>${badgeFor(f.key)}`;
            }
            return '';
          })
          .join('');

      return `<div class="diff-row row-chg">
        <div class="diff-cell">${renderCell('old')}</div>
        <div class="diff-cell">${renderCell('new')}</div>
      </div>`;
    })
    .join('');
}

function statusLabel(s) {
  return { open: '待处理', resolved: '已解决', rejected: '已驳回' }[s] || s;
}

function filteredAnnotations(data) {
  const f = reviewState.filters;
  return data.annotations.filter((a) => {
    if (f.status && a.status !== f.status) return false;
    if (f.review === '1' && !a.needsReview) return false;
    if (f.review === '0' && a.needsReview) return false;
    if (f.author && a.author !== f.author) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (
        !a.content.toLowerCase().includes(q) &&
        !a.anchorText.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });
}

function renderAnnPane() {
  const data = reviewState.data;
  const f = reviewState.filters;
  const authors = [...new Set(data.annotations.map((a) => a.author))];
  const list = filteredAnnotations(data);
  const stats = {
    total: data.annotations.length,
    open: data.annotations.filter((a) => a.status === 'open' && !a.needsReview).length,
    review: data.annotations.filter((a) => a.needsReview).length,
    resolved: data.annotations.filter((a) => a.status === 'resolved').length,
    rejected: data.annotations.filter((a) => a.status === 'rejected').length,
  };

  const composer = (() => {
    if (!reviewState.selectedKey) return '';
    const frag = findFrag(data, reviewState.selectedKey);
    if (!frag) return '';
    const author = localStorage.getItem('review.author') || '';
    return `<div class="composer">
      <div class="sel">选中片段：${esc(frag.text)}</div>
      <input type="text" id="annAuthor" placeholder="作者 / 审阅人姓名" value="${esc(author)}" />
      <textarea id="annContent" class="ta-sm" placeholder="批注内容…" style="margin-top:6px"></textarea>
      <div class="row-flex" style="margin-top:6px">
        <button class="primary small" id="saveAnn">保存批注</button>
        <button class="small" id="cancelAnn">取消</button>
      </div>
    </div>`;
  })();

  const attachBanner = reviewState.attachMode
    ? `<div class="warn-box">正在为批注 #${reviewState.attachMode} 重新定位：请在左侧点击正确的差异片段。
        <button class="small" id="cancelAttach" style="margin-left:8px">取消</button></div>`
    : '';

  return `
    <div class="pane-head">
      <div class="stats-line">
        <span>共 <b>${stats.total}</b></span>
        <span>待处理 <b>${stats.open}</b></span>
        <span>待复核 <b>${stats.review}</b></span>
        <span>已解决 <b>${stats.resolved}</b></span>
        <span>已驳回 <b>${stats.rejected}</b></span>
      </div>
      <div class="filters">
        <select id="fStatus">
          <option value="">全部状态</option>
          <option value="open" ${f.status === 'open' ? 'selected' : ''}>待处理</option>
          <option value="resolved" ${f.status === 'resolved' ? 'selected' : ''}>已解决</option>
          <option value="rejected" ${f.status === 'rejected' ? 'selected' : ''}>已驳回</option>
        </select>
        <select id="fReview">
          <option value="">全部</option>
          <option value="1" ${f.review === '1' ? 'selected' : ''}>仅待复核</option>
          <option value="0" ${f.review === '0' ? 'selected' : ''}>仅已锚定</option>
        </select>
        <select id="fAuthor">
          <option value="">全部作者</option>
          ${authors.map((a) => `<option ${f.author === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
        <input type="text" id="fQ" placeholder="搜索批注/锚点…" value="${esc(f.q)}" />
      </div>
      ${attachBanner}
      ${composer}
    </div>
    ${
      list.length === 0
        ? '<p class="muted">没有符合条件的批注。点击左侧红/绿差异片段可创建批注。</p>'
        : list
            .map((a) => {
              const mig = a.migration
                ? `<div class="muted">迁移：${
                    a.migration.matched ? `自动匹配（相似度 ${a.migration.score}）` : `未可靠匹配（最高相似度 ${a.migration.score}）`
                  }</div>`
                : '';
              const invalid = !a.fragmentValid && !a.needsReview;
              return `<div class="ann-item ${a.needsReview ? 'needs-review' : ''} status-${
                a.status
              }" data-id="${a.id}">
                <div class="ann-head">
                  <span class="ann-author">${esc(a.author)}</span>
                  <span>
                    <span class="badge ${a.status}">${statusLabel(a.status)}</span>
                    ${a.needsReview ? '<span class="badge review">⚠ 待复核</span>' : ''}
                  </span>
                </div>
                <div class="ann-anchor">${esc(a.anchorText || '（锚点缺失）')}</div>
                ${invalid ? '<div class="muted">⚠ 当前版本找不到原锚点片段</div>' : ''}
                ${mig}
                <div class="ann-content">${esc(a.content)}</div>
                <div class="ann-foot">
                  ${
                    a.status !== 'resolved'
                      ? `<button class="small" data-act="resolve" data-id="${a.id}">标记已解决</button>`
                      : `<button class="small" data-act="reopen" data-id="${a.id}">重新打开</button>`
                  }
                  ${
                    a.status !== 'rejected'
                      ? `<button class="small" data-act="reject" data-id="${a.id}">驳回</button>`
                      : ''
                  }
                  ${
                    a.needsReview
                      ? `<button class="small" data-act="attach" data-id="${a.id}">重新定位</button>
                         ${
                           a.migration && a.migration.suggestedKey
                             ? `<button class="small" data-act="suggest" data-id="${a.id}">采纳建议锚点</button>`
                             : ''
                         }`
                      : ''
                  }
                  <button class="small danger" data-act="del" data-id="${a.id}">删除</button>
                </div>
              </div>`;
            })
            .join('')
    }`;
}

function findFrag(data, key) {
  for (const row of data.diff.rows) {
    const f = row.fragments.find((x) => x.key === key);
    if (f) return f;
  }
  return null;
}

async function renderReview(versionId) {
  topActions.innerHTML = `
    <span id="backDoc" style="cursor:pointer;font-size:13px">← 文档</span>`;
  const data = await api(`/api/versions/${versionId}`);
  reviewState.data = data;
  reviewState.selectedKey = null;
  reviewState.attachMode = null;

  document.getElementById('backDoc').onclick = () => hashGo(`#/doc/${data.documentId}`);

  app.innerHTML = `
    <div class="card" style="padding:12px 20px">
      <div class="row-flex between">
        <div>
          <b>${esc(data.docTitle)}</b>
          <span class="badge open" style="margin-left:8px">v${data.versionNo}${
            data.label ? ' ' + esc(data.label) : ''
          }</span>
        </div>
        <div class="row-flex">
          <a href="/api/versions/${versionId}/export?format=md"><button class="small">导出 Markdown</button></a>
          <a href="/api/versions/${versionId}/export?format=json"><button class="small">导出 JSON</button></a>
        </div>
      </div>
      <div id="versionPills" class="version-pills" style="margin-top:10px"></div>
    </div>
    <div class="diff-layout">
      <div class="card diff-pane" style="padding:0">
        <div class="diff-head"><div>修订前</div><div>修订后</div></div>
        <div id="diffBody">${renderChunks(data)}</div>
      </div>
      <div class="card ann-pane" id="annPane">${renderAnnPane()}</div>
    </div>`;

  // 版本切换
  const doc = await api(`/api/documents/${data.documentId}`);
  const pills = document.getElementById('versionPills');
  pills.innerHTML = doc.versions
    .map(
      (v) =>
        `<span class="pill ${v.id === Number(versionId) ? 'active' : ''}" data-vid="${v.id}">v${
          v.version_no
        }${v.label ? ' ' + esc(v.label) : ''}</span>`,
    )
    .join('');
  pills.querySelectorAll('.pill').forEach((p) =>
    p.addEventListener('click', () => hashGo(`#/review/${p.dataset.vid}`)),
  );

  ensureDiffDelegated();
  bindPaneEvents(versionId);
}
let diffDelegated = false;
function ensureDiffDelegated() {
  if (diffDelegated) return;
  diffDelegated = true;
  app.addEventListener('click', async (e) => {
    const body = document.getElementById('diffBody');
    const span = e.target.closest('.chunk-del, .chunk-ins');
    if (!body || !span || !body.contains(span)) return;
    const key = span.dataset.key;
    const vid = (location.hash.match(/^#\/review\/(\d+)/) || [])[1];
    if (!vid) return;

    if (reviewState.attachMode) {
      const annId = reviewState.attachMode;
      try {
        await api(`/api/annotations/${annId}/attach`, {
          method: 'POST',
          body: { fragmentKey: key },
        });
        toast('批注已重新定位');
        await refreshReview(vid);
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    reviewState.selectedKey = key;
    document.querySelectorAll('.chunk-selected').forEach((el) =>
      el.classList.remove('chunk-selected'),
    );
    span.classList.add('chunk-selected');
    refreshPane();
    document.getElementById('annAuthor')?.focus();
  });
}

async function refreshReview(versionId) {
  reviewState.data = await api(`/api/versions/${versionId}`);
  reviewState.attachMode = null;
  const body = document.getElementById('diffBody');
  body.innerHTML = renderChunks(reviewState.data);
  refreshPane();
}

function refreshPane() {
  document.getElementById('annPane').innerHTML = renderAnnPane();
  bindPaneEventsFromScratch();
}

function bindPaneEvents(versionId) {
  bindPaneEventsFromScratch(versionId);
}

function bindPaneEventsFromScratch(versionId) {
  const pane = document.getElementById('annPane');
  if (!pane) return;

  const fStatus = document.getElementById('fStatus');
  const fReview = document.getElementById('fReview');
  const fAuthor = document.getElementById('fAuthor');
  const fQ = document.getElementById('fQ');
  fStatus?.addEventListener('change', () => {
    reviewState.filters.status = fStatus.value;
    refreshPane();
  });
  fReview?.addEventListener('change', () => {
    reviewState.filters.review = fReview.value;
    refreshPane();
  });
  fAuthor?.addEventListener('change', () => {
    reviewState.filters.author = fAuthor.value;
    refreshPane();
  });
  let qTimer = null;
  fQ?.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      reviewState.filters.q = fQ.value.trim();
      refreshPane();
    }, 250);
  });

  document.getElementById('cancelAnn')?.addEventListener('click', () => {
    reviewState.selectedKey = null;
    refreshPane();
  });

  document.getElementById('saveAnn')?.addEventListener('click', async () => {
    const author = document.getElementById('annAuthor').value.trim();
    const content = document.getElementById('annContent').value.trim();
    if (!author || !content) return toast('请填写作者和批注内容');
    localStorage.setItem('review.author', author);
    try {
      await api(`/api/versions/${versionId}/annotations`, {
        method: 'POST',
        body: { fragmentKey: reviewState.selectedKey, author, content },
      });
      reviewState.selectedKey = null;
      toast('批注已保存');
      await refreshReview(versionId);
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('cancelAttach')?.addEventListener('click', () => {
    reviewState.attachMode = null;
    refreshPane();
  });

  pane.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      try {
        if (act === 'resolve')
          await api(`/api/annotations/${id}`, { method: 'PATCH', body: { status: 'resolved' } });
        else if (act === 'reopen')
          await api(`/api/annotations/${id}`, { method: 'PATCH', body: { status: 'open' } });
        else if (act === 'reject')
          await api(`/api/annotations/${id}`, { method: 'PATCH', body: { status: 'rejected' } });
        else if (act === 'del') {
          if (!confirm('删除这条批注？')) return;
          await api(`/api/annotations/${id}`, { method: 'DELETE' });
        } else if (act === 'attach') {
          reviewState.attachMode = Number(id);
          refreshPane();
          toast('请在左侧点击正确的差异片段');
          return;
        } else if (act === 'suggest') {
          const a = reviewState.data.annotations.find((x) => x.id === Number(id));
          const key = a?.migration?.suggestedKey;
          if (!key) return toast('没有建议锚点');
          await api(`/api/annotations/${id}/attach`, { method: 'POST', body: { fragmentKey: key } });
          toast('已采纳建议锚点');
        }
        await refreshReview(versionId);
      } catch (err) {
        toast(err.message);
      }
    }),
  );

  // 点击批注卡片 → 高亮并滚动到锚点
  pane.querySelectorAll('.ann-item').forEach((item) =>
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const ann = reviewState.data.annotations.find((x) => x.id === Number(item.dataset.id));
      if (!ann || !ann.fragmentKey) return;
      const el = document.querySelector(`[data-key="${CSS.escape(ann.fragmentKey)}"]`);
      if (!el) return toast('当前版本找不到锚点片段，请重新定位');
      document.querySelectorAll('.chunk-selected').forEach((n) => n.classList.remove('chunk-selected'));
      el.classList.add('chunk-selected');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }),
  );
}

/* ---------------- 路由 ---------------- */

async function route() {
  const h = location.hash || '#/';
  try {
    if (h === '#/' || h === '#') await renderHome();
    else if (h.startsWith('#/doc/')) await renderDoc(h.split('/')[2]);
    else if (h.startsWith('#/review/')) await renderReview(h.split('/')[2]);
    else await renderHome();
  } catch (e) {
    app.innerHTML = `<div class="card error">加载失败：${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
route();
