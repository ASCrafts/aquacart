import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import crypto from 'crypto';
import { ROLES, WS_EVENT } from '@/lib/constants';
import jwt from 'jsonwebtoken';

// Accepts WSS_PORT (the name used in .env and netlify.toml) and falls back to
// the older WS_PORT so an existing deployment keeps working.
const PORT = parseInt(process.env.WSS_PORT || process.env.WS_PORT || '3001', 10);

/**
 * The shared key the app server presents on POST /broadcast.
 *
 * The upgrade handshake below has always verified a signed JWT and refused
 * anyone who is not an admin. The HTTP hook sitting beside it verified
 * NOTHING — same process, same port, no check — so anything that could reach
 * the port could push a forged "new order" to every admin screen, or a forged
 * short-fall notice, which is worse: it is an instruction to act.
 *
 * Read once at module load rather than per request so a key rotated in the
 * environment cannot half-apply while the process is running.
 */
const BROADCAST_SECRET = process.env.WSS_BROADCAST_SECRET;

/**
 * Refuse to start rather than start unprotected.
 *
 * The tempting alternative — log a warning and accept unauthenticated
 * broadcasts — is how an unset variable in one deploy turns into a permanently
 * open endpoint that nobody notices, because everything still works. A server
 * that will not boot gets fixed in minutes; a warning in a log does not.
 */
if (!BROADCAST_SECRET) {
    console.error(
        'WSS_BROADCAST_SECRET is not set. Refusing to start: /broadcast would ' +
            'accept forged admin alerts from anything that can reach this port. ' +
            'Generate one with `openssl rand -hex 32` and set it here AND in the ' +
            'app server environment (src/lib/notifications.ts sends it).'
    );
    process.exit(1);
}

// Narrowed once, above, so the comparison below does not have to re-check it.
const BROADCAST_SECRET_BUFFER = Buffer.from(BROADCAST_SECRET, 'utf8');

/**
 * A broadcast body is a handful of fields — an order id, a name, a couple of
 * numbers. Anything larger is either a bug or someone using the endpoint as a
 * memory pump: the body is buffered in this process before it is parsed, so
 * without a bound one request can allocate until the server dies, and it would
 * then be fanned out to every admin socket.
 */
const MAX_BROADCAST_BYTES = 16 * 1024;

/**
 * The events a caller is allowed to originate.
 *
 * `connection_ack` is deliberately absent. It is minted by this server when a
 * socket opens and means "your connection is live"; accepting it over the hook
 * would let a caller tell the dashboard it is connected when it is not.
 */
const BROADCASTABLE = new Set<string>([
    WS_EVENT.NEW_ORDER,
    WS_EVENT.SHORTFALL,
    WS_EVENT.UNDECLARED_NUDGE,
]);

/**
 * Constant-time comparison of the presented key against the configured one.
 *
 * timingSafeEqual THROWS on a length mismatch, and an exception is itself an
 * oracle — a 500 for the wrong length and a 401 for the wrong bytes tells the
 * caller how long the secret is, one probe at a time. Guarding the length
 * first turns that into a plain 401. The residual leak is the length alone,
 * which for a random 32-byte key tells an attacker nothing they can use; the
 * byte comparison, which is the part that would leak the key itself, stays
 * constant time.
 */
function broadcastSecretMatches(presented: string | undefined): boolean {
    if (typeof presented !== 'string' || presented.length === 0) return false;
    const given = Buffer.from(presented, 'utf8');
    if (given.length !== BROADCAST_SECRET_BUFFER.length) return false;
    return crypto.timingSafeEqual(given, BROADCAST_SECRET_BUFFER);
}

/** JSON response helper — every reply below is one of these. */
function respond(res: http.ServerResponse, status: number, body: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    // HTTP server for broadcasting
    if (req.method === 'POST' && req.url === '/broadcast') {
        // Checked BEFORE a single byte of body is buffered. Authenticating
        // after the read would still let an unauthenticated caller make this
        // process allocate MAX_BROADCAST_BYTES per request.
        const presented = req.headers['x-broadcast-secret'];
        if (!broadcastSecretMatches(Array.isArray(presented) ? presented[0] : presented)) {
            // Deliberately vague, and identical for a missing header and a
            // wrong one: the difference is free information.
            req.resume(); // drain, so the socket closes cleanly
            respond(res, 401, { success: false, message: 'Unauthorized' });
            return;
        }

        let body = '';
        let bytes = 0;
        let aborted = false;

        req.on('data', chunk => {
            if (aborted) return;
            bytes += chunk.length;
            if (bytes > MAX_BROADCAST_BYTES) {
                aborted = true;
                // Destroy only once the 413 has actually been flushed —
                // tearing the socket down first truncates the response and the
                // caller sees a network error instead of the reason.
                res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
                res.end(
                    JSON.stringify({ success: false, message: 'Payload too large' }),
                    () => req.destroy()
                );
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => {
            if (aborted) return;
            try {
                const message = JSON.parse(body) as { type?: unknown; payload?: unknown };
                // The type travels with the message so the dashboard can render
                // a short-fall differently from an order. Hardcoding 'new_order'
                // here meant a 05:00 "still undeclared" nudge arrived looking
                // like a sale.
                const type = typeof message.type === 'string' ? message.type : '';
                if (!BROADCASTABLE.has(type)) {
                    respond(res, 400, { success: false, message: 'Unknown event type' });
                    return;
                }
                const count = broadcast(type, message.payload ?? message);
                respond(res, 200, {
                    success: true,
                    message: `Broadcasted to ${count} admin(s)`,
                });
            } catch (error) {
                respond(res, 400, { success: false, message: 'Invalid JSON' });
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

    ws.send(JSON.stringify({ type: WS_EVENT.CONNECTION_ACK, message: 'Successfully connected to AquaCart notifications.' }));
});

/**
 * Fan one event out to every live admin socket. Returns how many it reached,
 * which is the only delivery evidence this channel has — and it is not a
 * guarantee, which is why the dashboard refetches on reconnect instead of
 * trusting the socket to have carried everything.
 */
function broadcast(type: string, payload: unknown): number {
    const data = JSON.stringify({ type, payload });
    let delivered = 0;
    console.log(`Broadcasting ${type} to ${adminClients.size} admin(s)`);
    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
            delivered += 1;
        }
    });
    return delivered;
}

server.listen(PORT, () => {
    console.log(`🚀 AquaCart WebSocket server is running on ws://localhost:${PORT}`);
});
