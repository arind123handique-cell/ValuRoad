import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
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
                const project = JSON.parse(body);
                if (project && project.id) {
                  // Ensure backups directory exists
                  const backupsDir = path.resolve(__dirname, 'backups');
                  if (!fs.existsSync(backupsDir)) {
                    fs.mkdirSync(backupsDir, { recursive: true });
                  }
                  
                  // Format file name
                  const safeName = (project.workName || 'project').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                  const filename = `project_${project.id}_${safeName}.json`;
                  const filePath = path.join(backupsDir, filename);
                  
                  // Write backup file
                  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
                  console.log(`[Local Backup] Saved snapshot: backups/${filename}`);
                  
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true, path: filePath }));
                } else {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Invalid project data' }));
                }
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
