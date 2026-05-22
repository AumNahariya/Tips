# 🎬 YouTube Donation Alert System

> Razorpay payments + real-time OBS alerts for Indian YouTubers/streamers

## Files

| File | Purpose |
|---|---|
| `donate.html` | Donation page for viewers (host on Vercel/GitHub Pages) |
| `obs-overlay.html` | Add as Browser Source in OBS |
| `server.js` | Node.js backend (host on Railway/Render) |
| `package.json` | Node dependencies |

---

## 🚀 Quick Setup (30 minutes)

### Step 1 — Razorpay account
1. Sign up at https://razorpay.com (free)
2. Complete KYC with PAN + bank account
3. Go to **Settings → API Keys** → Generate Test Key
4. Copy `Key ID` and `Key Secret`
5. Go to **Settings → Webhooks** → Add webhook:
   - URL: `https://your-server.railway.app/webhook`
   - Events: check `payment.captured`
   - Copy the webhook secret

### Step 2 — Deploy the server (Railway — free tier)
```bash
# 1. Install dependencies
npm install

# 2. Deploy to Railway
# Go to https://railway.app → New Project → Deploy from GitHub
# Or use Railway CLI:
npm install -g @railway/cli
railway login
railway init
railway up

# 3. Set environment variables in Railway dashboard:
RAZORPAY_KEY_ID=rzp_test_XXXXXX
RAZORPAY_KEY_SECRET=your_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### Step 3 — Update donate.html
Open `donate.html` and edit the CONFIG section at the bottom:
```js
const RAZORPAY_KEY = 'rzp_test_XXXXXX';    // your Razorpay key_id
const CHANNEL_NAME = 'Your Channel Name';
const SERVER_URL = 'https://your-app.railway.app';
```

Host the file on:
- **GitHub Pages**: free, push to a repo → enable Pages
- **Vercel**: drag-and-drop deploy at vercel.com

### Step 4 — OBS Browser Source
1. Open OBS → Add Source → **Browser**
2. URL: full path to `obs-overlay.html` (`file:///path/to/obs-overlay.html`)
   - Or host it at `https://your-app.railway.app/overlay`
3. Width: `1920`, Height: `1080`
4. Check "Shutdown source when not visible"
5. Edit the CONFIG in `obs-overlay.html`:
```js
const SERVER_URL = 'wss://your-app.railway.app';
```

### Step 5 — Test it!
```bash
curl -X POST https://your-app.railway.app/test-alert \
  -H "Content-Type: application/json" \
  -d '{"name":"Rahul Sharma","amount":199,"message":"Test donation!"}'
```

You should see the alert pop up in OBS!

---

## 🎨 Customization

### Change channel name & colors
In `donate.html`:
- `CHANNEL_NAME` — your channel name
- `--red: #FF2D2D` in `:root` — change to your brand color

### Alert position in OBS
In `obs-overlay.html`, find `#alertWrap` and change:
- `bottom: 60px; left: 50px` → any corner
- `top: 60px; right: 50px` for top-right

### Alert sound
Set `SOUND_URL` in `obs-overlay.html` to any hosted `.mp3` file URL.

### Alert duration
Change `ALERT_DURATION = 8000` (milliseconds) in `obs-overlay.html`.

---

## 💡 Tips

- Use **test mode** in Razorpay (rzp_test_ keys) while developing
- Switch to **live mode** (rzp_live_ keys) when ready to go live
- Share your donation page link in your YouTube description and live chat
- Pin the link as a YouTube Super Chat alternative

---

## 📦 Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS, Bebas Neue + DM Sans fonts
- **Payments**: Razorpay SDK (UPI, Cards, Netbanking, Wallets)
- **Backend**: Node.js, Express, `ws` WebSocket library
- **Hosting**: Railway (server), GitHub Pages or Vercel (donation page)
