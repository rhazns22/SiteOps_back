import { app } from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`[SiteOps Server] listening on port ${env.port}`);
});
