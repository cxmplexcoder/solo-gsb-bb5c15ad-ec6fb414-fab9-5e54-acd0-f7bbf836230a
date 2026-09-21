# 条文变更审阅台（Clause Review Console）

面向规范/标准条文修订场景的 Web 审阅工具：粘贴同一规范的前后两个版本，系统
**按段落（每行一条）计算差异**，审阅人可在具体差异片段上创建带**作者**与
**状态**的批注；后续导入新版本时，系统通过**文本锚点 + 上下文相似度**把未解决
批注自动迁移到最相近的新片段，找不到可靠匹配的批注标记为 **⚠ 待复核**，由人工
重新定位。

## 功能

- **段落级 + 片段级差异**：段落使用 LCS 对齐（新增/删除/修改/不变），修改段落再做
  token 级内联差异，中文按字、拉丁词/数字（如条款号 `3.2.1`）按词切分。
- **片段批注**：点击任意红色（删除）/绿色（新增）片段即可批注；记录作者、内容、
  状态（待处理 / 已解决 / 已驳回）。
- **锚点迁移**：重新导入版本时，仅迁移「待处理」批注。
  - 锚点 = 片段文本，辅助信号 = 相邻未变更段落（上下文）；
  - 相似度 = 0.75 × Sørensen–Dice 字符二元组相似度 + 0.25 × 上下文相似度；
  - 相似度 ≥ 阈值（默认 `0.45`）自动迁移，否则标记**待复核**并给出“建议锚点”，
    可一键采纳或手动点击片段重新定位；迁移分数与结果可追溯。
- **筛选与状态管理**：按状态、是否待复核、作者、关键词筛选；状态更新、重新定位、删除。
- **导出审阅结果**：每个版本可导出 Markdown 报告或 JSON（含统计与迁移记录）。
- **持久化**：SQLite 单文件数据库，Docker 命名卷持久化。

## 技术栈

- Node.js 20 + TypeScript（严格模式）
- Express 4（REST API + 静态资源）
- better-sqlite3（同步 SQLite 驱动）
- 原生 HTML/CSS/JS 单页前端（无构建步骤）
- Docker 多阶段构建 + Docker Compose

## 一键启动（Docker Compose）

```bash
docker compose up -d --build
```

启动后访问： **http://localhost:3000**

数据保存在 Docker 命名卷 `review-data`（容器内 `/app/data/reviews.db`），
容器重建后批注与版本不丢失。

停止：

```bash
docker compose down          # 保留数据
docker compose down -v       # 同时删除数据卷
```

## 本地开发（无 Docker）

需要 Node.js ≥ 20。better-sqlite3 使用预编译二进制；若环境需要源码编译，
请准备 Python 3、make、g++。

```bash
npm install
npm run dev          # tsx watch 热重载
# 或
npm run build && npm start
```

## 端口与配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 容器内服务监听端口 |
| `HOST_PORT` | `3000` | Compose 映射到宿主机的端口（仅 compose 用） |
| `DB_PATH` | `./data/reviews.db`（本地）/ `/app/data/reviews.db`（容器） | SQLite 数据库文件路径 |
| `ANCHOR_SIMILARITY_THRESHOLD` | `0.45` | 锚点迁移判定阈值（0~1），越低越“宽松”；低于该值标为待复核 |

自定义宿主机端口示例：

```bash
HOST_PORT=8080 docker compose up -d --build
# 访问 http://localhost:8080
```

调整迁移阈值（更严格，减少误迁移）：

```bash
ANCHOR_SIMILARITY_THRESHOLD=0.6 docker compose up -d --build
```

## 使用流程

1. 首页「新建规范文档」，输入规范名称。
2. 在文档页粘贴**修订前 / 修订后**文本（每行一个条文，空行忽略；空修订前文本即
   纯新增的初始版本），点击「计算差异并导入」。
3. 在审阅页左右对照视图中：
   - 点击红/绿差异片段 → 填写作者和批注内容 → 保存；
   - 右侧面板筛选批注、更新状态、点击批注可滚动定位到锚点。
4. 规范更新时回到文档页，直接粘贴**新的修订后文本**（前版自动取最新版本的文本）。
   导入完成后查看「自动迁移 / 待复核」数量；待复核批注可在审阅页**重新定位**或
   **采纳建议锚点**。
5. 右上角导出 **Markdown / JSON** 审阅结果。

`samples/` 目录提供 `v1.txt`、`v2.txt`、`v3.txt` 三个递进版本，可依次粘贴体验
迁移与待复核流程。

## REST API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/documents` | 新建文档 `{title}` |
| GET | `/api/documents` | 文档列表 |
| GET/DELETE | `/api/documents/:id` | 文档详情（含版本）/ 删除 |
| POST | `/api/documents/:id/versions` | 导入版本 `{oldText?,newText,label?}`，执行批注迁移 |
| GET | `/api/versions/:id` | 版本详情：diff 行/片段、批注、迁移记录（支持 `status`、`review=0/1`、`author`、`q` 筛选） |
| POST | `/api/versions/:id/annotations` | 创建批注 `{fragmentKey,author,content}` |
| PATCH | `/api/annotations/:id` | 更新 `{status}` 或 `{needsReview}` |
| POST | `/api/annotations/:id/attach` | 待复核批注重新定位 `{fragmentKey}` |
| DELETE | `/api/annotations/:id` | 删除批注 |
| GET | `/api/versions/:id/export?format=md\|json` | 导出审阅结果 |

## 目录结构

```
src/
  config.ts      # 环境变量配置
  db.ts          # SQLite 初始化与建表
  textutil.ts    # 段落切分、分词、LCS 内联差异、Dice 相似度
  diff.ts        # 段落级 LCS 对齐、片段键
  migration.ts   # 锚点最佳匹配与阈值判定
  export.ts      # Markdown / JSON 导出
  routes.ts      # REST API（含版本导入迁移事务）
  server.ts      # Express 入口
public/          # 前端单页应用
samples/         # 三个递进的示例版本
Dockerfile       # 多阶段构建
docker-compose.yml
```

## 说明与限制

- 段落以**行**为单位（每行一条条文，空行忽略）；适合一条一行粘贴的规范送审稿。
  若原文以空行分段，可先将每个条文整理为一行。
- 片段键只在“同一版本文本”内稳定（槽位 + 内容哈希）；**跨版本迁移不依赖键**，
  只依赖锚点文本与上下文相似度，因此插入/重排条文不会导致批注错位。
- 迁移仅作用于 `open` 批注；已解决/已驳回批注保留在历史版本中以便追溯。
