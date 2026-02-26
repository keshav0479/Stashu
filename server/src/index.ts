import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { stashRoutes } from './routes/stash.js';
import { unlockRoutes } from './routes/unlock.js';
import { earningsRoutes } from './routes/earnings.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { withdrawRoutes } from './routes/withdraw.js';
import { payRoutes } from './routes/pay.js';
import { settingsRoutes } from './routes/settings.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/ratelimit.js';

import { recoverPendingMelts } from './lib/recovery.js';

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
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health check
app.get('/', (c) => c.json({ status: 'ok', name: 'Stashu API', version: '0.1.0' }));

// Public API routes (rate limited)
app.use('/api/unlock/*', rateLimit(60_000, 30)); // 30 req/min
app.use('/api/pay/*', rateLimit(60_000, 60)); // 60 req/min (client polls every 2.5s)
app.route('/api/unlock', unlockRoutes);
app.route('/api/pay', payRoutes);

// Stash routes — GET is public (buyer preview), POST requires auth (prevents spoofing)
app.use('/api/stash/*', rateLimit(60_000, 10)); // 10 req/min
app.post('/api/stash', requireAuth); // Auth only on creation, not preview
app.route('/api/stash', stashRoutes);

// Protected API routes (require Nostr signature)
app.use('/api/earnings/*', requireAuth);
app.use('/api/dashboard/*', requireAuth);
app.use('/api/withdraw/*', requireAuth);
app.use('/api/settings/*', requireAuth);

app.route('/api/earnings', earningsRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/withdraw', withdrawRoutes);
app.route('/api/settings', settingsRoutes);

// Startup recovery — check for in-flight melts from a previous crash
recoverPendingMelts().catch((err) => console.error('Recovery error:', err));

const port = Number(process.env.PORT) || 3000;
console.log(`🐿️ Stashu server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
