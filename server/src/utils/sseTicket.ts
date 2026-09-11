import crypto from 'crypto';

/**
 * One-time-use short-lived tickets for SSE endpoints.
 * Avoids putting auth tokens in URLs (which leak via logs, referer, history).
 *
 * Usage:
 *   1. Client calls POST /ticket-endpoint (with normal Authorization header)
 *   2. Server generates ticket, stores user info with TTL, returns ticket
 *   3. Client opens EventSource with ?ticket=xxx
 *   4. Server validates ticket, consumes it (one-time use), proceeds
 */

interface TicketEntry {
  userId: number;
  phone: string;
  isAdmin: boolean;
  role: string;
  expiresAt: number;
  used: boolean;
}

const tickets = new Map<string, TicketEntry>();
const TTL_MS = 30_000; // 30 seconds — enough to start an SSE connection

function cleanup() {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt < now || entry.used) {
      tickets.delete(ticket);
    }
  }
}

// Periodic cleanup every 10s
setInterval(cleanup, 10_000).unref?.();

export function createSseTicket(user: { userId: number; phone: string; isAdmin: boolean; role: string }): string {
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, {
    userId: user.userId,
    phone: user.phone,
    isAdmin: user.isAdmin,
    role: user.role,
    expiresAt: Date.now() + TTL_MS,
    used: false,
  });
  return ticket;
}

export function consumeSseTicket(ticket: string): { userId: number; phone: string; isAdmin: boolean; role: string } | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  if (entry.used) {
    tickets.delete(ticket);
    return null;
  }
  entry.used = true;
  // Keep the entry until cleanup so we can detect replay attempts
  return { userId: entry.userId, phone: entry.phone, isAdmin: entry.isAdmin, role: entry.role };
}
