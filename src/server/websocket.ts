import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import { ROLES } from '@/lib/constants';
import jwt from 'jsonwebtoken';

// Accepts WSS_PORT (the name used in .env and netlify.toml) and falls back to
// the older WS_PORT so an existing deployment keeps working.
const PORT = parseInt(process.env.WSS_PORT || process.env.WS_PORT || '3001', 10);

const server = http.createServer((req, res) => {
    // HTTP server for broadcasting
    if (req.method === 'POST' && req.url === '/broadcast') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const message = JSON.parse(body);
                broadcast(message);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Broadcasted to admins' }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ noServer: true });

// Store authenticated admin clients
const adminClients = new Set<WebSocket>();

const secret = process.env.NEXTAUTH_SECRET;

server.on('upgrade', async (request, socket, head) => {
    // Log the path only. The full URL carries the admin's signed JWT in the
    // `token` query parameter, and process logs are far more widely readable
    // than the session itself — printing it here would hand out admin access.
    console.log('Received upgrade request for path:', url.parse(request.url || '').pathname);
    const { query } = url.parse(request.url || '', true);
    const token = query.token as string;

    if (!token) {
        console.error('No token provided');
        socket.destroy();
        return;
    }

    if (!secret) {
        console.error('No NEXTAUTH_SECRET provided in env');
        socket.destroy();
        return;
    }

    try {
        console.log('Verifying token...');
        const decodedToken = jwt.verify(token, secret) as { role?: string };
        console.log('Token verified, role:', decodedToken.role);

        if (decodedToken && decodedToken.role === ROLES.ADMIN) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            console.error('User is not an admin');
            socket.destroy();
        }
    } catch (error) {
        console.error('WS upgrade auth error:', error);
        socket.destroy();
    }
});


wss.on('connection', (ws) => {
    console.log('Admin client connected');
    adminClients.add(ws);

    ws.on('close', () => {
        console.log('Admin client disconnected');
        adminClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        adminClients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'connection_ack', message: 'Successfully connected to AquaCart notifications.' }));
});

function broadcast(message: any) {
    const data = JSON.stringify({ type: 'new_order', payload: message });
    console.log(`Broadcasting new order to ${adminClients.size} admin(s)`);
    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

server.listen(PORT, () => {
    console.log(`🚀 AquaCart WebSocket server is running on ws://localhost:${PORT}`);
});
