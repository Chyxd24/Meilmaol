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

### Step 5: Set Environment Variables
Masuk ke worker → **Settings → Variables and Secrets**

**Variables** (tab "Variables"):
| Key | Value |
|-----|-------|
| ADMIN_USERNAME | admin |
| ADMIN_USER_ID | 123456789 |
| CHANNEL_ID | -1001234567890 |
| GROUP_ID | -1001234567891 |

**Secrets** (tab "Secrets", akan di-encrypt):
| Key | Value |
|-----|-------|
| BOT_TOKEN | Token dari @BotFather |
| ADMIN_PASSWORD | Password untuk login web admin |

### Step 6: Set Webhook Telegram
Setelah deploy, dapatkan URL worker (contoh: `https://meilmaol.username.workers.dev`)

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://meilmaol.username.workers.dev/webhook"}'
```

### Step 7: Setup Email Routing
1. Dashboard → **Email → Email Routing**
2. Aktifkan Email Routing untuk domain
3. Tambah **Catch-all address** → route ke worker `meilmaol`

## 🤖 Cara Pakai Bot

### User:
1. Kirim `/start` ke bot
2. Join channel & grup (wajib)
3. Tunggu admin approve
4. Dapat key → login webmail

### Admin:
- `/admin` - Panel admin
- `/stats` - Statistik
- `/users` - List user
- `/broadcast [pesan]` - Kirim ke semua user
- `/block [user_id]` - Block user
- `/unblock [user_id]` - Unblock user

## 🔐 Sistem Proteksi

- ✅ Join channel & grup (wajib)
- ✅ Admin approval
- ✅ 1 User ID = 1 Key
- ✅ Real-time membership check
- ✅ Auto-suspend kalau keluar channel/grup
- ✅ Key bisa regenerate/custom

## 📁 Struktur Repo

```
Meilmaol/
├── src/
│   └── index.js          # Worker code (Tmail + Bot)
├── wrangler.toml         # Konfigurasi Cloudflare
├── package.json          # Dependencies
├── .gitignore
└── README.md             # Ini
```

## ⚠️ Catatan Penting

1. **JANGAN** push `wrangler.toml` dengan secret asli ke repo publik
2. Bot **harus admin** di channel & grup
3. Channel/Group ID harus pakai prefix `-100`
4. Setiap akses webmail hit Telegram API (cek membership real-time)


## 🔄 Auto-Deploy dengan GitHub Actions (Opsional)

Repo ini sudah include file `.github/workflows/deploy.yml`.

### Setup GitHub Secrets:
1. Buka repo GitHub → **Settings → Secrets and variables → Actions**
2. Tambahkan:

| Secret Name | Cara Dapatkan |
|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard Workers → lihat sidebar kanan bawah (Account ID) |

3. Setelah ini, tiap kali `git push` ke branch `main`, worker otomatis deploy!

### Manual Deploy (kalau tidak pakai GitHub Actions)
```bash
npm install -g wrangler
wrangler login
wrangler deploy
```
