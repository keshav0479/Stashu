import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { stashRoutes } from './routes/stash.js';
import { unlockRoutes } from './routes/unlock.js';
import { earningsRoutes } from './routes/earnings.js';
import { dashboardRoutes } from './routes/dashboard.js';

const app = new Hono();

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5174'];

// Enable CORS for frontend
app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
);

// Health check
app.get('/', (c) => c.json({ status: 'ok', name: 'Stashu API', version: '0.1.0' }));

// API routes
app.route('/api/stash', stashRoutes);
app.route('/api/unlock', unlockRoutes);
app.route('/api/earnings', earningsRoutes);
app.route('/api/dashboard', dashboardRoutes);

const port = 3000;
console.log(`🐿️ Stashu server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
