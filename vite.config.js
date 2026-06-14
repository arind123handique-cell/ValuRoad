import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: true
  },
  plugins: [
    {
      name: 'local-backup-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/backup' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body);
                // Ensure backups directory exists in Documents/Valuroad
                const documentsDir = path.join(os.homedir(), 'Documents');
                const backupsDir = path.join(documentsDir, 'Valuroad');
                
                if (!fs.existsSync(backupsDir)) {
                  fs.mkdirSync(backupsDir, { recursive: true });
                }
                
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const filename = `ValuRoad_Backup_${ts}.json`;
                const filePath = path.join(backupsDir, filename);
                
                // Write backup file
                fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
                console.log(`[Local Backup] Saved snapshot: ${filePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, path: filePath }));
              } catch (err) {
                console.error('[Local Backup Error]:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else {
            next();
          }
        });
      }
    }
  ],
  build: {
    outDir: 'dist'
  }
});
