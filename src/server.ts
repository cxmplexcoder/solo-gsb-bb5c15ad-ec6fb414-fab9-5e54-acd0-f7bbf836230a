import express from 'express';
import path from 'path';
import { config } from './config';
import { api } from './routes';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', api);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  },
);

app.listen(config.port, () => {
  console.log(`条文变更审阅台已启动: http://localhost:${config.port}`);
  console.log(`数据库: ${config.dbPath}`);
});
