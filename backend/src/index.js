import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { menu } from './routes/menu.js';
import { admin } from './routes/admin.js';
import { upload } from './routes/upload.js';
import { analytics } from './routes/analytics.js';
import { webhooks } from './routes/webhooks.js';

const app = new Hono();

app.use('*', logger());

const ALLOWED_ORIGINS = [
  'https://nume-lovat.vercel.app',
  'https://nume.com.ar',
  'https://www.nume.com.ar',
];
// Localhost y rangos de IP privados (LAN) — cualquier puerto.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
// Preview deploys de Vercel del mismo proyecto.
const VERCEL_PREVIEW_RE = /^https:\/\/nume-[\w-]+\.vercel\.app$/;

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin; // permitir requests sin origin (curl, server-to-server)
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    if (LOCAL_ORIGIN_RE.test(origin))    return origin;
    if (VERCEL_PREVIEW_RE.test(origin))  return origin;
    return null;
  },
}));

app.route('/api', menu);
app.route('/api/admin', admin);
app.route('/api/upload', upload);
app.route('/api', analytics);
app.route('/api/webhooks', webhooks);

app.get('/', (c) => c.json({ name: 'NuMe API', version: '0.1.0' }));

app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));

const PORT = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`NuMe API corriendo en http://localhost:${PORT}`);
});
