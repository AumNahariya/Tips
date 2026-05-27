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
const RAZORPAY_KEY_ID         = process.env.RAZORPAY_KEY_ID      || 'rzp_test_SsSX9cBE5iMrD0';
const RAZORPAY_KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET  || 'KdvrvdxcxZzQjr4it5s7VVff';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'aumii062303';
const DASHBOARD_PASSWORD      = process.env.DASHBOARD_PASSWORD   || 'aumii123';
// ─────────────────────────────────────────────────────────────

// ── Persistent storage — saves to data.json so data survives restarts ──
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      console.log('[data] Loaded from data.json');
      return saved;
    }
  } catch(e) { console.warn('[data] Could not load data.json:', e.message); }
  return null;
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(overlaySettings, null, 2), 'utf-8');
  } catch(e) { console.warn('[data] Could not save data.json:', e.message); }
}

// ── In-memory settings store (persists while server runs) ──
let overlaySettings = {
  alert: {
    duration: 12000,
    position: 'top-center',
    ttsEnabled: true,
    ttsLang: 'hi-IN',
    ttsRate: 0.95,
    accentColor: '#FF2D2D',
  },
  recent: {
    maxItems: 5, slideMs: 3500, accentColor: '#FF2D2D',
    visible: true, scale: 1, opacity: 1, fontSize: 13, bgOpacity: 0.85, borderRadius: 10,
  },
  topdono: {
    accentColor: '#FFD700', visible: true, title: 'DONATION',
    scale: 1, opacity: 1, fontSize: 18, bgOpacity: 0.88, borderRadius: 12,
  },
  goal: {
    amount: 5000, title: 'Stream Goal', color: 'red', start: 0, currentTotal: 0,
    scale: 1, opacity: 1, fontSize: 21, bgOpacity: 0.78, borderRadius: 99, barHeight: 5,
  }
};

// Merge saved data on top of defaults (preserves any new keys added in updates)
const savedData = loadData();
if (savedData) {
  Object.keys(savedData).forEach(section => {
    if (overlaySettings[section]) {
      overlaySettings[section] = { ...overlaySettings[section], ...savedData[section] };
    }
  });
}

const app = express();
const server = http.createServer(app);

// ── WebSocket server — accepts connections on ANY path (/, /overlay, /ws etc) ──
const wss = new WebSocketServer({ noServer: true });
let overlayClients = new Set();

// Handle WS upgrade on ANY path including /ws
server.on('upgrade', (req, socket, head) => {
  console.log('[ws] Upgrade request on path:', req.url);
  // Accept on any path: /, /ws, /overlay, /overlay/recent, /overlay/top
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  overlayClients.add(ws);
  console.log(`[ws] Overlay connected from ${req.url}. Total: ${overlayClients.size}`);

  ws.on('close', () => {
    overlayClients.delete(ws);
    console.log(`[ws] Overlay disconnected. Total: ${overlayClients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] Error:', err.message);
    overlayClients.delete(ws);
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

// Dashboard
app.get('/dashboard', (req, res) => {
  const f = path.join(__dirname, 'dashboard.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('dashboard.html not found');
});

// Public settings endpoint — overlays fetch this on load (no password needed)
app.get('/api/settings/public', (req, res) => {
  res.json(overlaySettings);
});

// Get current settings
app.get('/api/settings', (req, res) => {
  const auth = req.headers['x-dashboard-password'];
  if (auth !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  res.json(overlaySettings);
});

// Update settings — broadcast to all overlays instantly
app.post('/api/settings', (req, res) => {
  const auth = req.headers['x-dashboard-password'];
  if (auth !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const { section, key, value } = req.body;
  if (!overlaySettings[section]) return res.status(400).json({ error: 'Unknown section' });
  overlaySettings[section][key] = value;
  saveData(); // persist immediately to data.json
  // Push update to all overlays in real time
  broadcast({ type: 'settings_update', section, key, value });
  console.log(`[settings] ${section}.${key} = ${JSON.stringify(value)}`);
  res.json({ success: true, settings: overlaySettings });
});

// Send test alert from dashboard
app.post('/api/test-alert', (req, res) => {
  const auth = req.headers['x-dashboard-password'];
  if (auth !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const testData = {
    type: 'donation',
    name: req.body.name || 'Test Donor',
    amount: req.body.amount || 99,
    message: req.body.message || 'Test donation from dashboard!',
    paymentId: 'test_' + Date.now(),
    timestamp: new Date().toISOString()
  };
  broadcast(testData);
  res.json({ success: true });
});

// Verify dashboard password
app.post('/api/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// Serve overlay files via HTTPS — avoids OBS file:// security restrictions
app.get('/overlay', (req, res) => {
  const f = path.join(__dirname, 'obs-overlay.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('obs-overlay.html not found in repo');
});
app.get('/overlay/recent', (req, res) => {
  const f = path.join(__dirname, 'obs-recent.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('obs-recent.html not found in repo');
});
app.get('/overlay/goal', (req, res) => {
  const f = path.join(__dirname, 'obs-goal.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('obs-goal.html not found');
});
app.get('/overlay/top', (req, res) => {
  // Try both filename variants
  const f1 = path.join(__dirname, 'obs-topdono.html');
  const f2 = path.join(__dirname, 'obs-_topdono.html');
  if (fs.existsSync(f1)) return res.sendFile(f1);
  if (fs.existsSync(f2)) return res.sendFile(f2);
  res.status(404).send('obs-topdono.html not found in repo. Files present: ' + fs.readdirSync(__dirname).join(', '));
});

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

    // Update goal total and save
    overlaySettings.goal.currentTotal = Math.min(
      (overlaySettings.goal.currentTotal || 0) + amount,
      overlaySettings.goal.amount
    );

    // Save top donor persistently
    const curTop = overlaySettings.topdono.topDonor;
    if (!curTop || amount > curTop.amount) {
      overlaySettings.topdono.topDonor = { name, amount };
    }

    // Save recent donations list (last 5)
    if (!overlaySettings.recent.donations) overlaySettings.recent.donations = [];
    overlaySettings.recent.donations.unshift({ name, amount, message, timestamp: new Date().toISOString() });
    overlaySettings.recent.donations = overlaySettings.recent.donations.slice(0, 5);

    saveData(); // persist all donation data

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