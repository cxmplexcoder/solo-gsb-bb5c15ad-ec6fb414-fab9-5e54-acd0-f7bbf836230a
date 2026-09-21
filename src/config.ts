export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || './data/reviews.db',
  // 锚点迁移：相似度达到该阈值才视为可靠匹配，否则标记“待复核”
  anchorThreshold: Number(process.env.ANCHOR_SIMILARITY_THRESHOLD || 0.45),
};
