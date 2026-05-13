import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { menu } from './routes/menu.js';
import { admin } from './routes/admin.js';
import { upload } from './routes/upload.js';
import { analytics } from './routes/analytics.js';

const app = new Hono();

app.use('*', logger());

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:61224',
  'https://nume-lovat.vercel.app',
];
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin; // permitir requests sin origin (curl, server-to-server)
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Permitir cualquier preview/branch deploy de Vercel del mismo proyecto
    if (/^https:\/\/nume-[\w-]+\.vercel\.app$/.test(origin)) return origin;
    return null;
  },
}));

app.route('/api', menu);
app.route('/api/admin', admin);
app.route('/api/upload', upload);
app.route('/api', analytics);

app.get('/', (c) => c.json({ name: 'NuMe API', version: '0.1.0' }));

app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));

const PORT = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`NuMe API corriendo en http://localhost:${PORT}`);
});
