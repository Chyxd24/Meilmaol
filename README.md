# Meilmaol - Protected Tmail Worker

Email temporary berbasis Cloudflare Workers dengan proteksi Telegram Bot Authentication.

## 🚀 Deploy via Cloudflare Dashboard (Git Integration)

### Prerequisites
1. Akun Cloudflare (free tier cukup)
2. Repo GitHub publik/privat
3. Bot Telegram (dari @BotFather)
4. Channel & Grup Telegram

### Step 1: Setup Cloudflare KV
1. Buka [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Pilih **Workers & Pages → KV**
3. Klik **Create a namespace**
4. Nama: `EMAILS`
5. Copy **Namespace ID**-nya

### Step 2: Edit wrangler.toml
```toml
[[kv_namespaces]]
binding = "EMAILS"
id = "PASTE_KV_ID_DISINI"  <-- GANTI INI
```

### Step 3: Push ke GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/username/Meilmaol.git
git push -u origin main
```

### Step 4: Connect di Cloudflare
1. Dashboard → **Workers & Pages → Create**
2. Pilih **Connect to Git**
3. Pilih repo `Meilmaol`
4. **Build command**: (kosongkan)
5. **Deploy command**: `npx wrangler deploy`
6. Klik **Deploy**

### Step 5: Set Variables & Secrets
Masuk ke worker → **Settings → Variables and Secrets**

**Variables** (tab Variables):
| Key | Value | Keterangan |
|-----|-------|------------|
| ADMIN_USERNAME | admin | Username login web |
| ADMIN_USER_ID | 123456789 | Telegram ID kamu |
| CHANNEL_ID | -100... | ID channel (dari @getidsbot) |
| GROUP_ID | -100... | ID grup (dari @getidsbot) |
| WEBMAIL_URL | https://... | URL worker (opsional, auto-detect) |

**Secrets** (tab Secrets → Encrypt):
| Key | Value |
|-----|-------|
| BOT_TOKEN | Token dari @BotFather |
| ADMIN_PASSWORD | Password login web admin |

### Step 6: Set Webhook Telegram
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook"   -H "Content-Type: application/json"   -d '{"url":"https://meilmaol.username.workers.dev/webhook"}'
```

### Step 7: Setup Email Routing
1. Dashboard → **Email → Email Routing**
2. Aktifkan Email Routing untuk domain
3. Catch-all → route ke worker `meilmaol`

## 🤖 Cara Pakai Bot

### User:
1. Kirim `/start` ke bot
2. Join channel & grup (wajib)
3. Tunggu admin approve
4. Bot kirim URL webmail + User ID + Key
5. Klik tombol "🌐 Buka Webmail" atau buka URL manual
6. Login dengan User ID & Key

### Commands User:
- `/start` - Daftar / Lihat status
- `/mykey` - Lihat key
- `/genkey` - Generate key baru
- `/customkey [key]` - Set key custom
- `/webmail` - Info login webmail (URL + User ID + Key)
- `/help` - Bantuan

### Commands Admin:
- `/admin` - Panel admin (button)
- `/stats` - Statistik
- `/users` - List user
- `/broadcast [pesan]` - Kirim ke semua user
- `/block [id]` / `/unblock [id]` - Block/Unblock

## 🔐 Sistem Proteksi
- ✅ Join channel & grup (wajib)
- ✅ Admin approval
- ✅ 1 User ID = 1 Key
- ✅ Real-time membership check
- ✅ Auto-suspend kalau keluar channel/grup
- ✅ Key bisa regenerate/custom
