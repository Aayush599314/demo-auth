import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  plugins: [
    {
      name: 'auto-provision-claims-middleware',
      configureServer(server) {
        server.middlewares.use('/api/provision-claim', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }

          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const { uid } = JSON.parse(body || '{}');
              if (!uid) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing UID' }));
                return;
              }

              const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || resolve(process.cwd(), 'firebase-service-account.json');
              if (!existsSync(keyPath)) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'firebase-service-account.json not found' }));
                return;
              }

              const { initializeApp, cert, getApps } = await import('firebase-admin/app');
              const { getAuth } = await import('firebase-admin/auth');

              const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
              const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) });
              const auth = getAuth(app);

              const user = await auth.getUser(uid);
              const existing = user.customClaims || {};
              await auth.setCustomUserClaims(uid, { ...existing, role: 'authenticated' });

              console.log(`\n⚡ [Auto-Provision] Claim role:"authenticated" automatically set for ${user.email} (${uid})`);

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, uid, email: user.email }));
            } catch (err) {
              console.error('Auto-provisioning error:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        });
      },
    },
  ],
});

