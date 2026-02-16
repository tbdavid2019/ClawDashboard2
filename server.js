const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const url = require('url');

// Configuration
const WORKSPACE = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3001;
const IGNORED_PATHS = ['**/node_modules/**', '**/.git/**', '**/ClawDashboard2/**'];

console.log(`Starting ClawDashboard2...`);
console.log(`Watching workspace: ${WORKSPACE}`);

// State
const agents = new Map();
const clients = new Set();

// ---- 1. Markdown Parser ----
function parseProjectMd(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const mtime = fs.statSync(filePath).mtime;
        const directory = path.dirname(filePath);

        // Try to read MEMORY.md in the same directory
        let memory = '';
        const memoryPath = path.join(directory, 'MEMORY.md');
        if (fs.existsSync(memoryPath)) {
            memory = fs.readFileSync(memoryPath, 'utf8');
        }

        // Scan for other documents (*.md) excluding PROJECT.md and MEMORY.md
        const docs = [];
        try {
            const files = fs.readdirSync(directory);
            files.forEach(file => {
                if (file.endsWith('.md') && file !== 'PROJECT.md' && file !== 'MEMORY.md') {
                    docs.push(file);
                }
            });
        } catch (e) {
            console.error('Error scanning docs:', e);
        }

        // Extract Agent Name from H1
        const nameMatch = content.match(/^#\s+(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : path.basename(directory);

        // Split by H2 sections
        const sections = {};
        let currentSection = null;

        content.split('\n').forEach(line => {
            const sectionMatch = line.match(/^##\s+(.+)$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim();
                sections[currentSection] = [];
            } else if (currentSection && line.trim() !== '') {
                sections[currentSection].push(line);
            }
        });

        return {
            id: directory, // Use directory path as unique ID
            name,
            status: parseStatus(sections['Status']),
            tasks: parseTasks(sections['Tasks']),
            log: parseLog(sections['Log']),
            memory,
            docs, // List of other markdown files
            lastUpdated: mtime.getTime(),
            directory
        };
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error);
        return null;
    }
}

function parseStatus(lines) {
    if (!lines || lines.length === 0) return { r: '🟢', text: 'idle' }; // Default

    // Find first line with emoji or text
    for (const line of lines) {
        const match = line.match(/([🟢🔵🟡🟠🔴⏸️❌])\s*(.*)/);
        if (match) {
            return { r: match[1], text: match[2].trim() };
        }
        // Fallback if no emoji found but text exists
        if (line.trim().length > 0) {
            return { r: '🟢', text: line.trim() };
        }
    }
    return { r: '🟢', text: 'idle' };
}

function parseTasks(lines) {
    if (!lines) return [];
    const tasks = [];

    // - [ ] Task name
    const regex = /-\s+\[([ x\/!~])\]\s*(.*)/;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            let status = 'todo';
            switch (match[1]) {
                case ' ': status = 'todo'; break;
                case '/': status = 'in-progress'; break;
                case 'x': status = 'done'; break;
                case '!': status = 'blocked'; break;
                case '~': status = 'cancelled'; break;
            }

            tasks.push({
                status,
                text: match[2].trim(),
                raw: line
            });
        }
    });
    return tasks;
}

function parseLog(lines) {
    if (!lines) return [];
    // Just return raw lines for now, maybe parse dates later for activity heatmap
    return lines.map(line => line.replace(/^-\s*/, '')).filter(l => l.length > 0);
}

// ---- 2. File Watcher ----
const watcher = chokidar.watch(`${WORKSPACE}/**/PROJECT.md`, {
    ignored: IGNORED_PATHS,
    depth: 4, // Increased depth for nested agents
    persistent: true,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
    }
});

watcher
    .on('add', filePath => updateAgent(filePath))
    .on('change', filePath => updateAgent(filePath))
    .on('unlink', filePath => removeAgent(filePath));

function updateAgent(filePath) {
    console.log(`Detected change: ${filePath}`);
    const agent = parseProjectMd(filePath);
    if (agent) {
        agents.set(agent.id, agent);
        broadcast('update', agent);
    }
}

function removeAgent(filePath) {
    const directory = path.dirname(filePath);
    console.log(`Agent removed: ${directory}`);
    agents.delete(directory);
    broadcast('remove', { id: directory });
}


// ---- 3. SSE & HTTP Server ----
function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        res.write(message);
    }
}

const server = http.createServer((req, res) => {
    // 1. CORS for dev
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 2. Parse URL
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 3. SSE Endpoint
    if (pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        clients.add(res);
        // Send initial data immediately
        const initialData = Array.from(agents.values());
        res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);

        req.on('close', () => clients.delete(res));
        return;
    }

    // 4. API Endpoint (Snapshot)
    if (pathname === '/api/agents') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(Array.from(agents.values())));
        return;
    }

    // 5. File Content API
    if (pathname === '/api/file') {
        const { id, file } = parsedUrl.query;
        if (!id || !file) {
            res.writeHead(400);
            res.end('Missing id or file params');
            return;
        }

        // Security check: ensure id is a known agent directory
        if (!agents.has(id)) {
            res.writeHead(403);
            res.end('Access denied: Unknown agent');
            return;
        }

        // Security check: prevent directory traversal
        const targetPath = path.join(id, path.basename(file));
        if (path.dirname(targetPath) !== id) {
            res.writeHead(403);
            res.end('Access denied: File must be in agent directory');
            return;
        }

        fs.readFile(targetPath, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(content);
            }
        });
        return;
    }

    // 6. Static Files
    if (pathname === '/' || pathname === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
});
