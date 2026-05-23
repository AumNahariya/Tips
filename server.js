// ─────────────────────────────────────────────
//  YouTube Donation Alert Server
//  Stack: Node.js + Express + ws + Razorpay
//  Deploy free on: Railway / Render / Fly.io
// ─────────────────────────────────────────────

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');
const { WebSocketServer } = require('ws');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

// ── CONFIG (set these as environment variables) ──────────────
const PORT                 = process.env.PORT                  || 3000;
const RAZORPAY_KEY_ID      = process.env.RAZORPAY_KEY_ID      || 'rzp_test_SsSX9cBE5iMrD0';
const RAZORPAY_KEY_SECRET  = process.env.RAZORPAY_KEY_SECRET  || 'KdvrvdxcxZzQjr4it5s7VVff';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'aumii062303';
// ─────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// ── WebSocket server (OBS overlay connects here) ──
const wss = new WebSocketServer({ server });
let overlayClients = new Set();

wss.on('connection', (ws, req) => {
  overlayClients.add(ws);
  console.log(`[ws] Overlay connected. Total: ${overlayClients.size}`);

  ws.on('close', () => {
    overlayClients.delete(ws);
    console.log(`[ws] Overlay disconnected. Total: ${overlayClients.size}`);
  });

  // Send a welcome ping
  ws.send(JSON.stringify({ type: 'connected', message: 'Alert server ready' }));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  overlayClients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ── Razorpay instance ──
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

// ── Middleware ──
app.use(cors({ origin: '*' }));
// Raw body needed for webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', clients: overlayClients.size });
});

// Serve overlay files via HTTPS — avoids OBS file:// security restrictions
app.get('/overlay',        (req, res) => res.sendFile(path.join(__dirname, 'obs-overlay.html')));
app.get('/overlay/recent', (req, res) => res.sendFile(path.join(__dirname, 'obs-recent.html')));
app.get('/overlay/top',    (req, res) => res.sendFile(path.join(__dirname, 'obs-topdono.html')));

// Create Razorpay order (called by donation page before checkout)
app.post('/create-order', async (req, res) => {
  try {
    const { amount, name, message } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Minimum amount is ₹1 (100 paise)' });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount), // in paise
      currency: 'INR',
      receipt: `donation_${Date.now()}`,
      notes: { donor_name: name || 'Anonymous', message: message || '' }
    });

    console.log(`[order] Created: ${order.id} | ₹${amount/100} by ${name}`);
    res.json(order);
  } catch (err) {
    console.error('[order] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify payment after Razorpay checkout (signature check only — no broadcast)
// The webhook below handles the actual OBS alert broadcast to avoid double alerts
app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, donor_name, message, amount } = req.body;

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSig = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Signature mismatch' });
  }

  console.log(`[payment] Verified: ${razorpay_payment_id} | ₹${amount} by ${donor_name}`);
  // NOTE: broadcast is handled by the Razorpay webhook (payment.captured)
  // This prevents the alert from showing twice
  res.json({ success: true });
});

// Razorpay Webhook (server-to-server confirmation — most reliable)
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = req.body; // raw buffer

  const expectedSig = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSig !== signature) {
    console.warn('[webhook] Invalid signature');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(body.toString()); }
  catch(e) { return res.status(400).send('Bad JSON'); }

  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    const name    = payment.notes?.donor_name || 'Anonymous';
    const message = payment.notes?.message || '';
    const amount  = payment.amount / 100; // paise → rupees

    console.log(`[webhook] payment.captured: ₹${amount} from ${name}`);

    broadcast({
      type: 'donation',
      name,
      amount,
      message,
      paymentId: payment.id,
      timestamp: new Date().toISOString()
    });
  }

  res.json({ status: 'ok' });
});

// Test endpoint (send a fake donation alert for testing overlay)
app.post('/test-alert', (req, res) => {
  const testData = {
    type: 'donation',
    name: req.body.name || 'Test Donor',
    amount: req.body.amount || 99,
    message: req.body.message || 'This is a test donation! 🔥',
    paymentId: 'test_' + Date.now(),
    timestamp: new Date().toISOString()
  };
  broadcast(testData);
  console.log('[test] Alert sent:', testData);
  res.json({ success: true, data: testData });
});

// ── Start ──
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Donation Alert Server running!         ║
║   HTTP : http://localhost:${PORT}           ║
║   WS   : ws://localhost:${PORT}             ║
╚══════════════════════════════════════════╝

Endpoints:
  POST /create-order     — Create Razorpay order
  POST /verify-payment   — Verify after checkout
  POST /webhook          — Razorpay server webhook
  POST /test-alert       — Send a test alert to OBS

Set env vars:
  RAZORPAY_KEY_ID
  RAZORPAY_KEY_SECRET
  RAZORPAY_WEBHOOK_SECRET
  `);
});