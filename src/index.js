// ============================================================
// MediaFairy Tmail - FINAL v5.1
// With Global Domain List, User-Friendly Domain Selection
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Telegram Webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    // Email Handler (Cloudflare Email Routing)
    if (request.method === "POST" && url.pathname === "/email") {
      return new Response("OK");
    }

    // Main Webmail
    return handleWebmail(request, env);
  },

  async email(message, env, ctx) {
    try {
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      const from = message.from || "";
      const to = (message.to || "").toLowerCase().trim();
      const subject = message.headers.get("subject") || "(No Subject)";
      const date = new Date().toISOString();

      let raw = "";
      try {
        raw = await new Response(message.raw).text();
      } catch (e) {
        raw = "";
      }

      let body = "", htmlBody = "";

      if (raw) {
        const boundaryMatch = raw.match(/boundary="?([^"\s;\r\n]+)"?/i);
        if (boundaryMatch) {
          const boundary = boundaryMatch[1];
          const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));
          for (const part of parts) {
            if (!part.trim() || part.trim() === "--") continue;
            const headerEnd = part.indexOf("\r\n\r\n") !== -1 ? part.indexOf("\r\n\r\n") : part.indexOf("\n\n");
            if (headerEnd === -1) continue;
            const partHeader = part.substring(0, headerEnd);
            const partContent = part.substring(headerEnd + (part.indexOf("\r\n\r\n") !== -1 ? 4 : 2)).replace(/\r?\n$/, "");
            const ctMatch = partHeader.match(/Content-Type:\s*([^\r\n;]+)/i);
            const partCT = ctMatch ? ctMatch[1].trim().toLowerCase() : "";
            const encMatch = partHeader.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
            const enc = encMatch ? encMatch[1].trim().toLowerCase() : "";
            const isAtt = partHeader.match(/Content-Disposition:\s*attachment/i) || partHeader.match(/filename=/i);
            if (!isAtt) {
              if (partCT === "text/plain" && !body) body = decodeContent(partContent, enc);
              else if (partCT === "text/html" && !htmlBody) htmlBody = decodeContent(partContent, enc);
            }
          }
          if (!body && htmlBody) body = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        } else {
          const headerEnd = raw.indexOf("\r\n\r\n") !== -1 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
          if (headerEnd !== -1) {
            const mainHeader = raw.substring(0, headerEnd);
            const mainContent = raw.substring(headerEnd + (raw.indexOf("\r\n\r\n") !== -1 ? 4 : 2));
            const ctMatch = mainHeader.match(/Content-Type:\s*([^\r\n;]+)/i);
            const ct = ctMatch ? ctMatch[1].trim().toLowerCase() : "text/plain";
            const encMatch = mainHeader.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
            const enc = encMatch ? encMatch[1].trim().toLowerCase() : "";
            const decoded = decodeContent(mainContent, enc);
            if (ct === "text/html") { htmlBody = decoded; body = decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
            else body = decoded;
          } else body = raw;
        }

        const attachments = [];
        if (boundaryMatch) {
          const boundary = boundaryMatch[1];
          const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));
          for (const part of parts) {
            const headerEnd = part.indexOf("\r\n\r\n") !== -1 ? part.indexOf("\r\n\r\n") : part.indexOf("\n\n");
            if (headerEnd === -1) continue;
            const partHeader = part.substring(0, headerEnd);
            if (!partHeader.match(/Content-Disposition:\s*attachment/i) && !partHeader.match(/filename=/i)) continue;
            const partBody = part.substring(headerEnd + (part.indexOf("\r\n\r\n") !== -1 ? 4 : 2)).replace(/[\r\n]+$/, "");
            const fnMatch = partHeader.match(/filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^\r\n;]+))/i);
            const typeMatch = partHeader.match(/Content-Type:\s*([^\r\n;]+)/i);
            const encMatch = partHeader.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
            const enc = encMatch ? encMatch[1].trim().toLowerCase() : "";
            if (fnMatch) {
              const filename = decodeURIComponent(fnMatch[1] || fnMatch[2] || "file").trim();
              const attId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
              const attB64 = enc === "base64" ? partBody.replace(/\s+/g, "") : btoa(unescape(encodeURIComponent(partBody)));
              attachments.push({
                id: attId, filename,
                contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
                size: Math.round((attB64.length * 3) / 4),
                content: attB64, encoding: "base64"
              });
            }
          }
          for (const att of attachments) {
            await env.EMAILS.put("att_" + att.id, JSON.stringify(att));
          }
        }

        // Cari user berdasarkan alamat email
        const userMapping = await env.EMAILS.get(`email_to_user:${to}`);
        if (userMapping) {
          const { user_id } = JSON.parse(userMapping);
          const userData = await getUserData(env, user_id);
          if (userData && userData.status === "approved") {
            const emailData = JSON.stringify({
              id, from, to, subject, body: body || "(No content)", htmlBody, date,
              attachments: attachments.map(a => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size })),
              read: false, user_id
            });
            await env.EMAILS.put("email:" + id, emailData);
          }
        }
      }
    } catch (err) {
      // Silent fail
    }
  },
};

// ===================== TELEGRAM BOT =====================

async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  if (update.message) await handleMessage(update.message, env);
  else if (update.callback_query) await handleCallbackQuery(update.callback_query, env);
  return new Response("OK");
}

async function tgApi(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || "User";
  const firstName = msg.from.first_name || "";
  const text = msg.text || "";
  const isAdmin = userId.toString() === env.ADMIN_USER_ID.toString();

  if (text === "/start") {
    return await handleStart(userId, username, firstName, chatId, env);
  }

  if (isAdmin) {
    if (text.startsWith("/broadcast ")) return await handleBroadcast(userId, text.slice(11), env);
    if (text === "/stats") return await handleStats(userId, env);
    if (text === "/users") return await handleUsersList(userId, 1, env);
    if (text.startsWith("/block ")) return await handleBlock(userId, text.split(" ")[1], env);
    if (text.startsWith("/unblock ")) return await handleUnblock(userId, text.split(" ")[1], env);
    if (text === "/admin") {
      return await tgApi(env, "sendMessage", {
        chat_id: userId,
        text: "🔐 *Admin Panel*\n\nPilih menu:",
        parse_mode: "Markdown",
        reply_markup: getAdminKeyboard(),
      });
    }
  }

  if (text === "/mykey") return await handleMyKey(userId, env);
  if (text === "/genkey") return await handleGenKey(userId, env);
  if (text.startsWith("/customkey ")) return await handleCustomKey(userId, text.split(" ")[1], env);
  if (text === "/webmail") {
    const wmUrl = await getWebmailUrl(env);
    const userData = await getUserData(env, userId);
    return await tgApi(env, "sendMessage", {
      chat_id: userId,
      text: `🌐 *Info Login Webmail*\n\nURL: ${wmUrl}\n\n🆔 User ID: \`${userId}\`\n🔑 Key: \`${userData?.key || "Belum punya key"}\`\n\nCara login: Buka URL → pilih "User Login" → masukkan User ID & Key.`,
      parse_mode: "Markdown",
      reply_markup: getUserKeyboard(wmUrl),
    });
  }
  if (text === "/help") {
    await tgApi(env, "sendMessage", {
      chat_id: userId,
      text: `📖 *Bantuan*\n\n/start - Daftar\n/mykey - Lihat key\n/genkey - Generate key baru\n/customkey [key] - Key custom\n/webmail - Info login\n/help - Bantuan`,
      parse_mode: "Markdown",
    });
  }
}

async function getWebmailUrl(env) {
  if (env.WEBMAIL_URL) return env.WEBMAIL_URL;
  return "https://meilmaol.dikenyoed31.workers.dev";
}

async function handleStart(userId, username, firstName, chatId, env) {
  const userData = await getUserData(env, userId);

  if (userData && userData.status === "approved") {
    const isMember = await validateMembership(env, userId);
    if (!isMember) {
      await tgApi(env, "sendMessage", {
        chat_id: userId,
        text: "⚠️ *Akses Dicabut!*\n\nKamu keluar dari Channel/Grup. Silakan join kembali.",
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Join Channel", url: await getChannelInvite(env) }],
            [{ text: "💬 Join Grup", url: await getGroupInvite(env) }],
          ],
        },
      });
      userData.status = "suspended";
      await saveUserData(env, userId, userData);
      return;
    }
    const wmUrl = await getWebmailUrl(env);
    await tgApi(env, "sendMessage", {
      chat_id: userId,
      text: `✅ *Halo ${escapeMarkdown(firstName)}!*\n\nStatus: APPROVED ✅\n🔑 Key: \`${userData.key}\`\n📧 Email: \`${userData.email || "Atur di webmail"}\`\n\n🌐 Webmail: ${wmUrl}`,
      parse_mode: "Markdown",
      reply_markup: getUserKeyboard(wmUrl),
    });
    return;
  }

  if (userData && userData.status === "pending") {
    await tgApi(env, "sendMessage", { chat_id: userId, text: "⏳ *Menunggu Approval*", parse_mode: "Markdown" });
    return;
  }
  if (userData && userData.status === "blocked") {
    await tgApi(env, "sendMessage", { chat_id: userId, text: "🚫 *Akses Diblokir*", parse_mode: "Markdown" });
    return;
  }

  // New user
  const channelOk = await checkChatMember(env, env.CHANNEL_ID, userId);
  const groupOk = await checkChatMember(env, env.GROUP_ID, userId);
  if (!channelOk || !groupOk) {
    await tgApi(env, "sendMessage", {
      chat_id: userId,
      text: `👋 *Halo ${escapeMarkdown(firstName)}!*\n\nWajib join Channel & Grup dulu, lalu /start lagi.`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Join Channel", url: await getChannelInvite(env) }],
          [{ text: "💬 Join Grup", url: await getGroupInvite(env) }],
        ],
      },
    });
    return;
  }

  const pendingData = {
    user_id: userId, username, first_name: firstName,
    requested_at: new Date().toISOString(), status: "pending"
  };
  await env.EMAILS.put(`pending:${userId}`, JSON.stringify(pendingData));

  await tgApi(env, "sendMessage", {
    chat_id: env.ADMIN_USER_ID,
    text: `🔔 *Permintaan Baru*\n\n👤 ${escapeMarkdown(firstName)}\n🆔 \`${userId}\`\n📛 @${escapeMarkdown(username)}\n📅 ${new Date().toLocaleString("id-ID")}`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Approve", callback_data: `approve:${userId}` }, { text: "❌ Reject", callback_data: `reject:${userId}` }],
      ],
    },
  });

  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: "✅ *Permintaan Terkirim!* Silakan tunggu konfirmasi admin.",
    parse_mode: "Markdown",
  });
}

async function handleCallbackQuery(query, env) {
  const data = query.data;
  const fromId = query.from.id;
  const msgId = query.message.message_id;
  const chatId = query.message.chat.id;

  // User callbacks
  if (data === "mykey") { await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id }); return await handleMyKey(fromId, env); }
  if (data === "genkey") { await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id }); return await handleGenKey(fromId, env); }
  if (data === "help") {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    return await tgApi(env, "sendMessage", {
      chat_id: fromId,
      text: "📖 */start* - Daftar\n*/mykey* - Lihat key\n*/genkey* - Generate key\n*/customkey [key]* - Key custom\n*/webmail* - Info login\n*/help* - Bantuan",
      parse_mode: "Markdown",
    });
  }

  // Admin only
  if (fromId.toString() !== env.ADMIN_USER_ID.toString()) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id, text: "Kamu bukan admin!", show_alert: true });
    return;
  }

  if (data.startsWith("approve:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleApprove(data.split(":")[1], chatId, msgId, env);
  } else if (data.startsWith("reject:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleReject(data.split(":")[1], chatId, msgId, env);
  } else if (data.startsWith("page:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleUsersList(chatId, parseInt(data.split(":")[1]), env, msgId);
  } else if (data === "refresh_stats") {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleStats(chatId, env, msgId);
  } else if (data === "back_admin") {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await tgApi(env, "editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: "🔐 *Admin Panel*\n\nPilih menu:",
      parse_mode: "Markdown",
      reply_markup: getAdminKeyboard(),
    });
  } else if (data === "back_users") {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleUsersList(chatId, 1, env, msgId);
  } else if (data.startsWith("user_detail:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleUserDetail(chatId, data.split(":")[1], env, msgId);
  } else if (data.startsWith("block:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleBlock(chatId, data.split(":")[1], env);
    await handleUserDetail(chatId, data.split(":")[1], env, msgId);
  } else if (data.startsWith("unblock:")) {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id });
    await handleUnblock(chatId, data.split(":")[1], env);
    await handleUserDetail(chatId, data.split(":")[1], env, msgId);
  } else {
    await tgApi(env, "answerCallbackQuery", { callback_query_id: query.id, text: "Fitur belum tersedia" });
  }
}

async function handleApprove(userId, chatId, msgId, env) {
  const pending = await env.EMAILS.get(`pending:${userId}`);
  if (!pending) {
    if (msgId) await tgApi(env, "editMessageText", { chat_id: chatId, message_id: msgId, text: "⚠️ Permintaan tidak ditemukan." });
    return;
  }
  const pendingData = JSON.parse(pending);
  const key = generateAccessKey();
  const email = `${key}@${env.WEBMAIL_DOMAIN || "meilmaol.dikenyoed31.workers.dev"}`;

  const userData = {
    user_id: userId, username: pendingData.username, first_name: pendingData.first_name,
    status: "approved", key, email,
    approved_at: new Date().toISOString(), approved_by: env.ADMIN_USER_ID,
    joined_at: pendingData.requested_at,
  };

  await saveUserData(env, userId, userData);
  await env.EMAILS.put(`key:${key}`, JSON.stringify({ user_id: userId, created_at: new Date().toISOString() }));
  await env.EMAILS.put(`email_to_user:${email}`, JSON.stringify({ user_id: userId }));
  await env.EMAILS.delete(`pending:${userId}`);

  if (msgId) {
    await tgApi(env, "editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: `✅ *APPROVED*\n\n👤 ${escapeMarkdown(pendingData.first_name)}\n🆔 \`${userId}\`\n🔑 \`${key}\`\n📧 \`${email}\``,
      parse_mode: "Markdown",
    });
  }

  const wmUrl = await getWebmailUrl(env);
  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: `🎉 *Akses Diterima!*\n\n🔑 Key: \`${key}\`\n📧 Email: \`${email}\`\n🌐 Webmail: ${wmUrl}\n\nLogin dengan User ID & Key.`,
    parse_mode: "Markdown",
    reply_markup: getUserKeyboard(wmUrl),
  });
}

async function handleReject(userId, chatId, msgId, env) {
  const pending = await env.EMAILS.get(`pending:${userId}`);
  const pendingData = pending ? JSON.parse(pending) : { first_name: "Unknown" };
  await env.EMAILS.delete(`pending:${userId}`);
  await saveUserData(env, userId, {
    user_id: userId, username: pendingData.username, first_name: pendingData.first_name,
    status: "rejected", rejected_at: new Date().toISOString(),
  });
  if (msgId) {
    await tgApi(env, "editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: `❌ *REJECTED*\n\n👤 ${escapeMarkdown(pendingData.first_name)}\n🆔 \`${userId}\``,
      parse_mode: "Markdown",
    });
  }
  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: "🚫 *Permintaan Ditolak*",
    parse_mode: "Markdown",
  });
}

async function handleMyKey(userId, env) {
  const userData = await getUserData(env, userId);
  if (!userData || userData.status !== "approved") {
    return await tgApi(env, "sendMessage", { chat_id: userId, text: "⚠️ Belum punya akses." });
  }
  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: `🔑 *Key:* \`${userData.key}\`\n📧 *Email:* \`${userData.email || "Atur di webmail"}\`\n🆔 User ID: \`${userId}\``,
    parse_mode: "Markdown",
    reply_markup: getUserKeyboard(),
  });
}

async function handleGenKey(userId, env) {
  const userData = await getUserData(env, userId);
  if (!userData || userData.status !== "approved") {
    return await tgApi(env, "sendMessage", { chat_id: userId, text: "⚠️ Belum punya akses." });
  }
  if (userData.key) {
    await env.EMAILS.delete(`key:${userData.key}`);
    if (userData.email) await env.EMAILS.delete(`email_to_user:${userData.email}`);
  }
  const newKey = generateAccessKey();
  const newEmail = `${newKey}@${env.WEBMAIL_DOMAIN || "meilmaol.dikenyoed31.workers.dev"}`;
  userData.key = newKey;
  userData.email = newEmail;
  await saveUserData(env, userId, userData);
  await env.EMAILS.put(`key:${newKey}`, JSON.stringify({ user_id: userId, created_at: new Date().toISOString() }));
  await env.EMAILS.put(`email_to_user:${newEmail}`, JSON.stringify({ user_id: userId }));
  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: `🔄 *Key Baru*\n\n🔑 \`${newKey}\`\n📧 \`${newEmail}\``,
    parse_mode: "Markdown",
    reply_markup: getUserKeyboard(),
  });
}

async function handleCustomKey(userId, customKey, env) {
  const userData = await getUserData(env, userId);
  if (!userData || userData.status !== "approved") {
    return await tgApi(env, "sendMessage", { chat_id: userId, text: "⚠️ Belum punya akses." });
  }
  if (!customKey || customKey.length < 4 || customKey.length > 32) {
    return await tgApi(env, "sendMessage", { chat_id: userId, text: "⚠️ Key harus 4-32 karakter." });
  }
  const existing = await env.EMAILS.get(`key:${customKey}`);
  if (existing) {
    return await tgApi(env, "sendMessage", { chat_id: userId, text: "⚠️ Key sudah dipakai." });
  }
  if (userData.key) {
    await env.EMAILS.delete(`key:${userData.key}`);
    if (userData.email) await env.EMAILS.delete(`email_to_user:${userData.email}`);
  }
  const newEmail = `${customKey}@${env.WEBMAIL_DOMAIN || "meilmaol.dikenyoed31.workers.dev"}`;
  userData.key = customKey;
  userData.email = newEmail;
  await saveUserData(env, userId, userData);
  await env.EMAILS.put(`key:${customKey}`, JSON.stringify({ user_id: userId, created_at: new Date().toISOString() }));
  await env.EMAILS.put(`email_to_user:${newEmail}`, JSON.stringify({ user_id: userId }));
  await tgApi(env, "sendMessage", {
    chat_id: userId,
    text: `✅ *Key Custom Berhasil!*\n\n🔑 \`${customKey}\`\n📧 \`${newEmail}\``,
    parse_mode: "Markdown",
    reply_markup: getUserKeyboard(),
  });
}

// --- Admin handlers ---
async function handleBroadcast(adminId, message, env) {
  const allKeys = await listAllKeys(env, "user:");
  let sent = 0, failed = 0;
  for (const key of allKeys) {
    try {
      const data = await env.EMAILS.get(key.name);
      if (!data) continue;
      const user = JSON.parse(data);
      if (user.status === "approved") {
        const res = await tgApi(env, "sendMessage", { chat_id: user.user_id, text: `📢 *Pengumuman*\n\n${message}`, parse_mode: "Markdown" });
        if (res.ok) sent++; else failed++;
      }
    } catch (e) {}
  }
  await tgApi(env, "sendMessage", { chat_id: adminId, text: `📢 *Broadcast Selesai*\n✅ ${sent}\n❌ ${failed}`, parse_mode: "Markdown" });
}

async function handleStats(adminId, env, editMsgId = null) {
  const allKeys = await listAllKeys(env, "user:");
  let total = 0, approved = 0, pending = 0, blocked = 0, suspended = 0;
  for (const key of allKeys) {
    try {
      const data = await env.EMAILS.get(key.name);
      if (!data) continue;
      const u = JSON.parse(data);
      total++;
      if (u.status === "approved") approved++;
      else if (u.status === "pending") pending++;
      else if (u.status === "blocked") blocked++;
      else if (u.status === "suspended") suspended++;
    } catch (e) {}
  }
  const text = `📊 *Statistik*\n👥 Total: ${total}\n✅ Approved: ${approved}\n⏳ Pending: ${pending}\n🚫 Blocked: ${blocked}\n⚠️ Suspended: ${suspended}`;
  const payload = {
    chat_id: adminId, text, parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "refresh_stats" }], [{ text: "🔙 Kembali", callback_data: "back_admin" }]] },
  };
  if (editMsgId) { payload.message_id = editMsgId; await tgApi(env, "editMessageText", payload); }
  else await tgApi(env, "sendMessage", payload);
}

async function handleUsersList(adminId, page, env, editMsgId = null) {
  const allKeys = await listAllKeys(env, "user:");
  const users = [];
  for (const key of allKeys) {
    try {
      const data = await env.EMAILS.get(key.name);
      if (data) users.push(JSON.parse(data));
    } catch (e) {}
  }
  users.sort((a, b) => new Date(b.joined_at || 0) - new Date(a.joined_at || 0));
  const perPage = 5, totalPages = Math.ceil(users.length / perPage) || 1;
  const start = (page - 1) * perPage;
  const pageUsers = users.slice(start, start + perPage);
  let text = `👥 *User (Hal ${page}/${totalPages})*\n\n`;
  pageUsers.forEach((u, i) => {
    const icon = u.status === "approved" ? "✅" : u.status === "pending" ? "⏳" : u.status === "blocked" ? "🚫" : "⚠️";
    text += `${start + i + 1}. ${icon} ${escapeMarkdown(u.first_name || "?")} \`${u.user_id}\`\n`;
  });
  const buttons = [];
  if (page > 1) buttons.push({ text: "◀️ Prev", callback_data: `page:${page - 1}` });
  if (page < totalPages) buttons.push({ text: "Next ▶️", callback_data: `page:${page + 1}` });
  const inlineKeyboard = buttons.length ? [buttons] : [];
  pageUsers.forEach(u => inlineKeyboard.push([{ text: `👤 ${escapeMarkdown(u.first_name || "?")}`, callback_data: `user_detail:${u.user_id}` }]));
  inlineKeyboard.push([{ text: "🔙 Kembali", callback_data: "back_admin" }]);
  const payload = { chat_id: adminId, text, parse_mode: "Markdown", reply_markup: { inline_keyboard: inlineKeyboard } };
  if (editMsgId) { payload.message_id = editMsgId; await tgApi(env, "editMessageText", payload); }
  else await tgApi(env, "sendMessage", payload);
}

async function handleBlock(adminId, targetId, env) {
  const userData = await getUserData(env, targetId);
  if (!userData) return await tgApi(env, "sendMessage", { chat_id: adminId, text: "User tidak ditemukan." });
  userData.status = "blocked";
  await saveUserData(env, targetId, userData);
  await tgApi(env, "sendMessage", { chat_id: adminId, text: `🚫 User \`${targetId}\` diblokir.`, parse_mode: "Markdown" });
  await tgApi(env, "sendMessage", { chat_id: targetId, text: "🚫 *Akses Diblokir*", parse_mode: "Markdown" });
}

async function handleUnblock(adminId, targetId, env) {
  const userData = await getUserData(env, targetId);
  if (!userData) return await tgApi(env, "sendMessage", { chat_id: adminId, text: "User tidak ditemukan." });
  userData.status = "approved";
  await saveUserData(env, targetId, userData);
  await tgApi(env, "sendMessage", { chat_id: adminId, text: `✅ User \`${targetId}\` dibuka blokir.`, parse_mode: "Markdown" });
  await tgApi(env, "sendMessage", { chat_id: targetId, text: "✅ *Akses Dibuka*", parse_mode: "Markdown" });
}

async function handleUserDetail(adminId, userId, env, msgId) {
  const userData = await getUserData(env, userId);
  if (!userData) return await tgApi(env, "editMessageText", { chat_id: adminId, message_id: msgId, text: "User tidak ditemukan." });
  const text = `👤 *Detail*\n🆔 \`${userId}\`\n📛 ${escapeMarkdown(userData.first_name)}\n👤 @${escapeMarkdown(userData.username || "-")}\n📊 ${userData.status.toUpperCase()}\n🔑 \`${userData.key || "-"}\`\n📧 \`${userData.email || "-"}\``;
  await tgApi(env, "editMessageText", {
    chat_id: adminId, message_id: msgId, text, parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚫 Block", callback_data: `block:${userId}` }, { text: "✅ Unblock", callback_data: `unblock:${userId}` }],
        [{ text: "🔙 Kembali", callback_data: "back_users" }],
      ],
    },
  });
}

function getUserKeyboard(webmailUrl) {
  const kb = [
    [{ text: "🔑 Lihat Key", callback_data: "mykey" }, { text: "🔄 Generate Key", callback_data: "genkey" }],
    [{ text: "❓ Bantuan", callback_data: "help" }],
  ];
  if (webmailUrl) kb.unshift([{ text: "🌐 Buka Webmail", url: webmailUrl }]);
  return { inline_keyboard: kb };
}

function getAdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Statistik", callback_data: "refresh_stats" }, { text: "👥 Users", callback_data: "page:1" }],
      [{ text: "📢 Broadcast", callback_data: "broadcast" }, { text: "🚫 Block User", callback_data: "block_menu" }],
    ],
  };
}

// ===================== WEBMAIL HANDLER =====================

async function handleWebmail(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const getCookie = (name) => {
    const c = request.headers.get("Cookie");
    if (!c) return null;
    const m = c.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  };
  const cookieFlags = `Path=/; Max-Age=31536000; SameSite=Lax;`;
  const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

  if (params.get("page") === "login") {
    return new Response(loginPageHTML(), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
  }

  if (params.get("action") === "login") {
    const type = params.get("type");
    if (type === "admin") {
      if (params.get("username") === env.ADMIN_USERNAME && params.get("password") === env.ADMIN_PASSWORD) {
        const token = btoa(JSON.stringify({ type: "admin", t: Date.now() }));
        return new Response("", { status: 302, headers: { Location: "/", "Set-Cookie": `tmail_auth=${token}; ${cookieFlags}`, ...noCache } });
      }
      return new Response(loginPageHTML("❌ Admin username/password salah!"), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
    }
    if (type === "user") {
      const result = await validateUserAccess(env, params.get("user_id"), params.get("key"));
      if (result.valid) {
        const token = btoa(JSON.stringify({ type: "user", user_id: params.get("user_id"), key: params.get("key"), t: Date.now() }));
        return new Response("", { status: 302, headers: { Location: "/", "Set-Cookie": `tmail_auth=${token}; ${cookieFlags}`, ...noCache } });
      }
      return new Response(loginPageHTML(result.message), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
    }
  }

  if (params.get("action") === "logout") {
    return new Response("", { status: 302, headers: { Location: "/?page=login", "Set-Cookie": `tmail_auth=; Path=/; Max-Age=0`, ...noCache } });
  }

  const authCookie = getCookie("tmail_auth");
  if (!authCookie) return new Response("", { status: 302, headers: { Location: "/?page=login", ...noCache } });

  let authData;
  try { authData = JSON.parse(atob(authCookie)); } catch (e) { return new Response("", { status: 302, headers: { Location: "/?page=login", ...noCache } }); }

  if (authData.type === "admin") return await handleAdminWebmail(request, env, authData, getCookie, cookieFlags, noCache);
  if (authData.type === "user") {
    const result = await validateUserAccess(env, authData.user_id, authData.key);
    if (!result.valid) return new Response("", { status: 302, headers: { Location: "/?page=login", "Set-Cookie": `tmail_auth=; Path=/; Max-Age=0`, ...noCache } });
    return await handleUserWebmail(request, env, authData, getCookie, cookieFlags, noCache);
  }

  return new Response("", { status: 302, headers: { Location: "/?page=login", ...noCache } });
}

async function validateUserAccess(env, userId, key) {
  if (!userId || !key) return { valid: false, message: "User ID dan Key wajib diisi!" };
  const userData = await getUserData(env, userId);
  if (!userData) return { valid: false, message: "User tidak terdaftar!" };
  if (userData.status === "blocked") return { valid: false, message: "Akun diblokir!" };
  if (userData.status === "rejected") return { valid: false, message: "Permintaan ditolak!" };
  if (userData.status === "pending") return { valid: false, message: "Menunggu approval!" };
  if (userData.status === "suspended") return { valid: false, message: "Akses dicabut! Join channel/grup lagi." };
  if (userData.status !== "approved") return { valid: false, message: "Akses tidak valid!" };
  if (userData.key !== key) return { valid: false, message: "Key tidak valid!" };
  const isMember = await validateMembership(env, userId);
  if (!isMember) {
    userData.status = "suspended";
    await saveUserData(env, userId, userData);
    return { valid: false, message: "Akses dicabut! Kamu keluar dari Channel/Grup." };
  }
  return { valid: true };
}

async function validateMembership(env, userId) {
  try { return (await checkChatMember(env, env.CHANNEL_ID, userId)) && (await checkChatMember(env, env.GROUP_ID, userId)); }
  catch (e) { return false; }
}

async function checkChatMember(env, chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const res = await tgApi(env, "getChatMember", { chat_id: chatId, user_id: parseInt(userId) });
    return res.ok && res.result && ["member", "administrator", "creator"].includes(res.result.status);
  } catch (e) { return false; }
}

async function getChannelInvite(env) {
  const cached = await env.EMAILS.get("channel_invite");
  if (cached) return cached;
  try {
    const res = await tgApi(env, "getChat", { chat_id: env.CHANNEL_ID });
    if (res.ok && res.result.invite_link) {
      await env.EMAILS.put("channel_invite", res.result.invite_link, { expirationTtl: 86400 });
      return res.result.invite_link;
    }
  } catch (e) {}
  return "https://t.me/" + (env.CHANNEL_ID || "").replace("-100", "");
}

async function getGroupInvite(env) {
  const cached = await env.EMAILS.get("group_invite");
  if (cached) return cached;
  try {
    const res = await tgApi(env, "getChat", { chat_id: env.GROUP_ID });
    if (res.ok && res.result.invite_link) {
      await env.EMAILS.put("group_invite", res.result.invite_link, { expirationTtl: 86400 });
      return res.result.invite_link;
    }
  } catch (e) {}
  return "https://t.me/" + (env.GROUP_ID || "").replace("-100", "");
}

// ===================== USER WEBMAIL (v5.1 with domain selection) =====================

function getGlobalDomainList(env) {
  if (env.DOMAIN_LIST) {
    return env.DOMAIN_LIST.split(",").map(d => d.trim()).filter(d => d.length > 0);
  }
  return [];
}

function domainSelectionPage(domainList, error = "") {
  const options = domainList.map(d => `<option value="${d}">@${d}</option>`).join("");
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pilih Domain - MediaFairy Tmail</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
      .card{background:#fff;border-radius:16px;padding:30px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.03);border:1px solid #e0e4e8;}
      select{padding:14px;border-radius:10px;border:1px solid #e0e4e8;width:100%;font-size:14px;outline:none;margin:16px 0;background:#fafafa;box-sizing:border-box;}
      button{display:block;width:100%;padding:14px;border-radius:10px;background:#111;color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;}
      .error{color:#c62828;font-size:13px;margin-bottom:12px;}
    </style></head>
    <body><div class="card">
      <div style="font-size:48px;margin-bottom:16px;">📧</div>
      <h2 style="margin-bottom:8px;font-size:20px;">Pilih Domain</h2>
      <p style="color:#666;font-size:14px;margin-bottom:24px;">Pilih domain yang ingin digunakan untuk email sementara.</p>
      ${error ? `<div class="error">${error}</div>` : ""}
      <form action="/" method="GET">
        <input type="hidden" name="action" value="set_random">
        <select name="domain" required>
          <option value="">-- Pilih Domain --</option>
          ${options}
        </select>
        <button type="submit">Buat Email Acak</button>
      </form>
    </div></body></html>`;
}

async function handleUserWebmail(request, env, authData, getCookie, cookieFlags, noCache) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const userId = authData.user_id;

  const getHistory = async () => {
    try { const r = await env.EMAILS.get("account_history_" + userId); return r ? JSON.parse(r) : []; }
    catch (e) { return []; }
  };
  const addToHistory = async (email) => {
    let h = await getHistory();
    h = h.filter(e => e !== email);
    h.unshift(email);
    if (h.length > 20) h = h.slice(0, 20);
    await env.EMAILS.put("account_history_" + userId, JSON.stringify(h));
  };
  const registerEmail = async (email) => {
    await env.EMAILS.put(`email_to_user:${email.toLowerCase().trim()}`, JSON.stringify({ user_id: userId }));
  };

  // Gabungkan domain global admin + domain yang pernah disimpan user
  let domainList = getGlobalDomainList(env);
  try {
    const saved = await env.EMAILS.get("saved_domains_" + userId);
    if (saved) {
      const userDomains = JSON.parse(saved);
      userDomains.forEach(d => {
        if (!domainList.includes(d)) domainList.push(d);
      });
    }
  } catch (e) {}

  // Switch account
  if (params.get("action") === "switch_account") {
    const sw = (params.get("email") || "").toLowerCase().trim();
    if (sw && sw.includes("@")) {
      await addToHistory(sw);
      await registerEmail(sw); // DAFTARKAN
      return new Response("", { status: 302, headers: { Location: "/", "Set-Cookie": `active_mail_${userId}=${encodeURIComponent(sw)}; ${cookieFlags}`, ...noCache } });
    }
    return new Response("", { status: 302, headers: { Location: "/", ...noCache } });
  }

  // Set custom
  if (params.get("action") === "set_custom") {
    let user = (params.get("user") || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").trim();
    let domSel = (params.get("domain_select") || "").toLowerCase().trim();
    let domInp = (params.get("domain_input") || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").trim();
    let saveDom = params.get("save_domain") === "on";
    let finalDom = (domInp || domSel || "").trim();
    if (!finalDom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(finalDom)) finalDom = domainList[0] || "example.com";
    if (!user) user = Math.random().toString(36).substring(2, 10);
    if (domInp && saveDom && !domainList.includes(domInp)) {
      domainList.push(domInp);
      await env.EMAILS.put("saved_domains_" + userId, JSON.stringify(domainList));
    }
    const newEmail = `${user}@${finalDom}`;
    await addToHistory(newEmail);
    await registerEmail(newEmail); // DAFTARKAN
    return new Response("", { status: 302, headers: { Location: "/", "Set-Cookie": `active_mail_${userId}=${encodeURIComponent(newEmail)}; ${cookieFlags}`, ...noCache } });
  }

  const activeMailCookie = getCookie("active_mail_" + userId);

  // Set random / first time domain selection
  if (params.get("action") === "set_random" || !activeMailCookie) {
    let selectedDomain = (params.get("domain") || "").toLowerCase().trim();
    if (params.get("action") === "set_random" && selectedDomain && domainList.includes(selectedDomain)) {
      const randUser = Math.random().toString(36).substring(2, 10);
      const newEmail = `${randUser}@${selectedDomain}`;
      await addToHistory(newEmail);
      await registerEmail(newEmail); // DAFTARKAN
      return new Response("", { status: 302, headers: { Location: "/", "Set-Cookie": `active_mail_${userId}=${encodeURIComponent(newEmail)}; ${cookieFlags}`, ...noCache } });
    }
    if (domainList.length > 0) {
      return new Response(domainSelectionPage(domainList), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
    }
    return new Response(setupDomainPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Delete session
  if (params.get("action") === "delete_session") {
    const cookieEmail = (activeMailCookie || "").toLowerCase().trim();
    let h = await getHistory();
    h = h.filter(e => e !== cookieEmail);
    await env.EMAILS.put("account_history_" + userId, JSON.stringify(h));
    // Optional: hapus juga mapping? Sebaiknya jangan, karena email mungkin masih terkirim.
    return new Response("", { status: 302, headers: { Location: "/?action=set_random", "Set-Cookie": `active_mail_${userId}=; Path=/; Max-Age=0`, ...noCache } });
  }

  if (params.get("action") === "clear_domains") {
    await env.EMAILS.delete("saved_domains_" + userId);
    return new Response("", { status: 302, headers: { Location: "/", ...noCache } });
  }
  if (params.get("action") === "remove_history") {
    const em = (params.get("email") || "").toLowerCase().trim();
    let h = await getHistory();
    h = h.filter(e => e !== em);
    await env.EMAILS.put("account_history_" + userId, JSON.stringify(h));
    return new Response("", { status: 302, headers: { Location: "/", ...noCache } });
  }
  if (params.get("action") === "clear_history") {
    await env.EMAILS.delete("account_history_" + userId);
    return new Response("", { status: 302, headers: { Location: "/", ...noCache } });
  }

  const currentEmail = (activeMailCookie || "").toLowerCase().trim();
  if (!currentEmail || !currentEmail.includes("@")) {
    if (domainList.length === 0) return new Response(setupDomainPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("", { status: 302, headers: { Location: "/?action=set_random", ...noCache } });
  }

  const historyOnLoad = await getHistory();
  if (!historyOnLoad.includes(currentEmail)) await addToHistory(currentEmail);

  // Check count (AJAX)
  if (params.get("check")) {
    let count = 0;
    const allKeys = await listAllKeys(env, "email:");
    for (const key of allKeys) {
      try {
        const data = await env.EMAILS.get(key.name);
        if (data) {
          const parsed = JSON.parse(data);
          if (parsed.to.toLowerCase().trim() === currentEmail) count++;
        }
      } catch (e) {}
    }
    return new Response(JSON.stringify({ count }), { headers: { "Content-Type": "application/json" } });
  }
  
  const cleanStyles = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f6f9;color:#111;display:flex;justify-content:center;min-height:100vh;padding:20px 15px;-webkit-font-smoothing:antialiased}
    .container{width:100%;max-width:520px;position:relative}
    .title{text-align:center;font-size:20px;font-weight:800;margin-bottom:24px;letter-spacing:-0.5px;color:#111}
    .email-display-card{background:#fff;border:1px solid #e0e4e8;border-radius:16px;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;box-shadow:0 4px 12px rgba(0,0,0,0.03)}
    .email-text{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111;flex:1}
    .icon-btn{background:none;border:none;cursor:pointer;color:#111;display:flex;align-items:center;justify-content:center;padding:4px;transition:opacity 0.2s}
    .icon-btn:hover{opacity:0.6}
    .icon-btn svg{width:22px;height:22px}
    .action-row{display:flex;justify-content:space-between;margin-bottom:30px;padding:0 10px}
    .action-item{display:flex;flex-direction:column;align-items:center;gap:8px;background:none;border:none;cursor:pointer;color:#111;transition:transform 0.1s}
    .action-item:active{transform:scale(0.95)}
    .action-circle{width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e0e4e8;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.02)}
    .action-circle svg{width:20px;height:20px}
    .action-text{font-size:12px;font-weight:600;text-transform:lowercase;color:#333}
    .panel-section{background:#fff;border-radius:16px;padding:22px;margin-bottom:24px;border:1px solid #e0e4e8;box-shadow:0 4px 12px rgba(0,0,0,0.03);display:none;animation:fadeIn 0.2s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
    .section-title{font-size:12px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.8px;color:#666}
    .input-group{display:flex;gap:8px;margin-bottom:12px}
    .input-text,.select-box{flex:1;padding:14px;border:1px solid #e0e4e8;border-radius:10px;font-size:14px;outline:none;background:#fafafa;font-family:inherit;transition:border 0.2s;min-width:0}
    .input-text:focus,.select-box:focus{border-color:#111;background:#fff}
    .btn-primary{width:100%;padding:14px;background:#111;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;transition:background 0.2s}
    .btn-primary:hover{background:#333}
    .btn-danger-outline{padding:6px 10px;font-size:11px;font-weight:600;border:1px solid #ff3b30;color:#ff3b30;background:transparent;border-radius:6px;cursor:pointer}
    .inbox-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:0 5px}
    .inbox-title{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
    .badge{background:#e0e4e8;color:#111;font-size:12px;padding:2px 8px;border-radius:10px;font-weight:700}
    .email-item{display:flex;flex-direction:column;background:#fff;border:1px solid #e0e4e8;border-radius:14px;padding:18px;margin-bottom:12px;text-decoration:none;color:inherit;transition:border-color 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.02)}
    .email-item:hover{border-color:#111}
    .e-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .e-sender{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px}
    .e-time{font-size:12px;color:#888}
    .e-subject{font-size:14px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .unread-dot{width:8px;height:8px;border-radius:50%;background:#007AFF;flex-shrink:0}
    .history-item{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#fafafa;border:1px solid #e0e4e8;border-radius:10px;margin-bottom:8px}
    .history-email{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
    .history-active{color:#007AFF;font-weight:700}
    .history-actions{display:flex;gap:8px;margin-left:10px;flex-shrink:0}
    .btn-history{padding:6px 12px;font-size:11px;font-weight:600;border:none;border-radius:6px;cursor:pointer}
    .btn-use{background:#111;color:#fff}
    .btn-del{background:#ffe5e5;color:#ff3b30}
    #toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:12px 24px;border-radius:24px;font-size:13px;font-weight:600;display:none;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
    .view-card{background:#fff;border:1px solid #e0e4e8;border-radius:16px;padding:24px;margin-top:16px;box-shadow:0 4px 12px rgba(0,0,0,0.03);overflow-x:auto}
    .meta-box{background:#fafafa;padding:16px;border-radius:10px;border:1px solid #e0e4e8;font-size:13px;line-height:1.6;margin-bottom:20px}
    .tab-row{display:flex;gap:8px;margin-bottom:16px}
    .tab{padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;color:#666;background:#fafafa;border:1px solid #e0e4e8}
    .tab.active{background:#111;color:#fff;border-color:#111}
    .auth-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:10px 14px;background:#e8f5e9;border-radius:10px;border:1px solid #c8e6c9}
    .auth-text{font-size:12px;font-weight:600;color:#2e7d32;display:flex;align-items:center;gap:6px}
    .logout-link{font-size:12px;font-weight:600;color:#c62828;text-decoration:none;padding:4px 10px;background:#ffebee;border-radius:6px}
  `;

  try {
    // Delete
    if (params.get("delete")) {
      const id = params.get("delete");
      const data = await env.EMAILS.get("email:" + id);
      if (data) {
        const email = JSON.parse(data);
        if (email.to.toLowerCase().trim() === currentEmail) {
          if (email.attachments) for (const att of email.attachments) await env.EMAILS.delete("att_" + att.id);
          await env.EMAILS.delete("email:" + id);
        }
      }
      return new Response("", { status: 302, headers: { Location: "/", ...noCache } });
    }

    // View
    if (params.get("view")) {
      const id = params.get("view");
      const data = await env.EMAILS.get("email:" + id);
      if (!data) return notFoundPage(cleanStyles);
      const emailObj = JSON.parse(data);
      if (emailObj.to.toLowerCase().trim() !== currentEmail) return notFoundPage(cleanStyles);

      emailObj.read = true;
      await env.EMAILS.put("email:" + id, JSON.stringify(emailObj));

      const tab = params.get("tab") || (emailObj.htmlBody ? "html" : "text");
      let contentHTML = "";
      if (tab === "html" && emailObj.htmlBody) {
        const safeHtml = emailObj.htmlBody.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        contentHTML = `<iframe srcdoc="${safeHtml}" sandbox="allow-same-origin allow-popups" style="width:100%;height:60vh;border:none;background:#fff;"></iframe>`;
      } else {
        contentHTML = `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.6;color:#333;">${escapeHTML(emailObj.body || "(No content)")}</pre>`;
      }

      return new Response(
        `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHTML(emailObj.subject)} - MediaFairy Tmail</title><style>${cleanStyles}</style></head>
        <body><div class="container">
          <div class="auth-bar"><span class="auth-text">🛡️ Protected - User ${userId}</span><a href="/?action=logout" class="logout-link">Logout</a></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <a href="/" style="text-decoration:none;color:#111;font-weight:700;display:flex;align-items:center;gap:6px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Kembali</a>
            <a href="/?delete=${emailObj.id}" class="btn-danger-outline" onclick="return confirm('Hapus?')">Hapus</a>
          </div>
          <div class="view-card">
            <h1 style="font-size:20px;font-weight:800;margin-bottom:20px;line-height:1.4;">${escapeHTML(emailObj.subject)}</h1>
            <div class="meta-box"><div><strong>Dari:</strong> ${escapeHTML(emailObj.from)}</div><div><strong>Kepada:</strong> ${escapeHTML(emailObj.to)}</div><div><strong>Tanggal:</strong> ${new Date(emailObj.date).toLocaleString("id-ID")}</div></div>
            <div class="tab-row">${emailObj.htmlBody ? `<a href="/?view=${emailObj.id}&tab=html" class="tab ${tab==="html"?"active":""}">HTML</a>` : ""}<a href="/?view=${emailObj.id}&tab=text" class="tab ${tab==="text"?"active":""}">Teks</a></div>
            <div style="padding-top:16px;border-top:1px solid #e0e4e8;">${contentHTML}</div>
            ${emailObj.attachments?.length > 0 ? `<div style="margin-top:32px;padding-top:20px;border-top:1px dashed #e0e4e8;"><div style="font-weight:700;margin-bottom:16px;font-size:13px;color:#666;">📎 Lampiran (${emailObj.attachments.length})</div><div style="display:flex;flex-wrap:wrap;gap:10px;">${emailObj.attachments.map(a => `<a href="/?download=${a.id}" style="display:flex;align-items:center;gap:8px;background:#f4f6f9;border:1px solid #e0e4e8;padding:10px 14px;border-radius:10px;text-decoration:none;color:#111;font-size:12px;font-weight:600;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${escapeHTML(a.filename)}</a>`).join("")}</div></div>` : ""}
          </div>
        </div></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } }
      );
    }

    // Download attachment
    if (params.get("download")) {
      const attId = params.get("download");
      const attData = await env.EMAILS.get("att_" + attId);
      if (!attData) return new Response("Lampiran tidak ditemukan", { status: 404 });
      const att = JSON.parse(attData);
      let body;
      if (att.encoding === "base64") {
        const binaryStr = atob(att.content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        body = bytes;
      } else body = att.content;
      return new Response(body, {
        headers: { "Content-Type": att.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(att.filename)}"`, "Cache-Control": "no-cache" },
      });
    }

    // Inbox
    let emails = [];
    const allKeys = await listAllKeys(env, "email:");
    for (const key of allKeys) {
      try {
        const data = await env.EMAILS.get(key.name);
        if (data) {
          const parsed = JSON.parse(data);
          if (parsed.to.toLowerCase().trim() === currentEmail) emails.push(parsed);
        }
      } catch (e) {}
    }
    emails.sort((a, b) => Number(b.id.substring(0, 13)) - Number(a.id.substring(0, 13)));

    const accountHistory = await getHistory();
    const domainOptions = domainList.map(d => `<option value="${d}">${d}</option>`).join("");
    const [currentUser, currentDomain] = currentEmail.split("@");

    return new Response(
      `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>MediaFairy Tmail</title><style>${cleanStyles}</style>
      <script>
        let lastCount = ${emails.length};
        setInterval(async function(){
          try {
            const res = await fetch('/?check=1');
            if (!res.ok) return;
            const data = await res.json();
            if (data.count !== lastCount) window.location.reload();
          } catch(e) {}
        }, 10000);
        function copyMail(){
          navigator.clipboard.writeText(document.getElementById('current-email').innerText).then(()=>{
            const toast = document.getElementById('toast');
            toast.style.display = 'block';
            setTimeout(()=>{ toast.style.display = 'none'; }, 2000);
          });
        }
        function toggleMenu(id){
          const el = document.getElementById(id);
          const vis = el.style.display === 'block';
          document.getElementById('ubah-menu').style.display = 'none';
          document.getElementById('lainnya-menu').style.display = 'none';
          if (!vis) el.style.display = 'block';
        }
      </script>
      </head><body>
        <div class="container">
          <div class="auth-bar"><span class="auth-text">🛡️ Protected - User ${userId}</span><a href="/?action=logout" class="logout-link">Logout</a></div>
          <div class="title">MediaFairy Tmail</div>
          <div class="email-display-card">
            <div class="email-text" id="current-email">${escapeHTML(currentEmail)}</div>
            <button class="icon-btn" onclick="copyMail()" title="Salin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          </div>
          <div class="action-row">
            <button class="action-item" onclick="copyMail()"><div class="action-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></div><span class="action-text">salin</span></button>
            <button class="action-item" onclick="window.location.href='/?action=set_random'"><div class="action-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><span class="action-text">acak</span></button>
            <button class="action-item" onclick="toggleMenu('ubah-menu')"><div class="action-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div><span class="action-text">ubah</span></button>
            <button class="action-item" onclick="if(confirm('Hapus sesi?')) window.location.href='/?action=delete_session'"><div class="action-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div><span class="action-text">hapus</span></button>
            <button class="action-item" onclick="toggleMenu('lainnya-menu')"><div class="action-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="16" cy="12" r="1"/></svg></div><span class="action-text">lainnya</span></button>
          </div>
          <div id="ubah-menu" class="panel-section">
            <div class="section-title">Ubah Email Custom</div>
            <form action="/" method="GET" autocomplete="off">
              <input type="hidden" name="action" value="set_custom">
              <div class="input-group">
                <input type="text" name="user" class="input-text" value="${escapeHTML(currentUser)}" placeholder="username">
                <select name="domain_select" class="select-box">
                  ${domainList.map(d => `<option value="${d}" ${d === currentDomain ? "selected" : ""}>${d}</option>`).join("")}
                </select>
              </div>
              <button type="submit" class="btn-primary">Terapkan Email Baru</button>
            </form>
          </div>
          <div id="lainnya-menu" class="panel-section">
            <div class="section-title">Tambah Domain Baru</div>
            <form action="/" method="GET" autocomplete="off" style="margin-bottom:28px;">
              <input type="hidden" name="action" value="set_custom">
              <input type="hidden" name="save_domain" value="on">
              <div class="input-group"><input type="text" name="domain_input" class="input-text" placeholder="contoh: domain.com" required></div>
              <button type="submit" class="btn-primary" style="background:#007AFF;">Simpan Domain</button>
            </form>
            <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">Riwayat Sesi <button onclick="if(confirm('Hapus semua?')) window.location.href='/?action=clear_history'" class="btn-danger-outline">Clear All</button></div>
            ${accountHistory.length > 0 ? `<div style="display:flex;flex-direction:column;">${accountHistory.map(hist => `<div class="history-item"><div class="history-email ${hist === currentEmail ? 'history-active' : ''}">${escapeHTML(hist)}</div><div class="history-actions">${hist !== currentEmail ? `<button onclick="window.location.href='/?action=switch_account&email=${encodeURIComponent(hist)}'" class="btn-history btn-use">Pilih</button>` : `<span style="font-size:10px;font-weight:800;color:#007AFF;display:flex;align-items:center;padding:0 4px;">AKTIF</span>`}${hist !== currentEmail ? `<button onclick="window.location.href='/?action=remove_history&email=${encodeURIComponent(hist)}'" class="btn-history btn-del">×</button>` : ""}</div></div>`).join("")}</div>` : `<div style="font-size:13px;color:#888;text-align:center;padding:10px;">Belum ada riwayat.</div>`}
          </div>
          <div class="inbox-header"><div class="inbox-title">Kotak Masuk <span class="badge">${emails.length}</span></div><button onclick="window.location.reload()" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button></div>
          <div class="email-list">
            ${emails.length === 0 ? `<div style="text-align:center;padding:60px 20px;color:#888;"><div style="font-size:48px;margin-bottom:16px;opacity:0.8;">📬</div><div style="font-size:16px;font-weight:600;color:#111;">Kotak masuk kosong</div><div style="font-size:13px;margin-top:8px;">Menunggu pesan untuk ${escapeHTML(currentEmail)}</div></div>` : emails.map(e => `<a href="/?view=${e.id}" class="email-item"><div class="e-header"><div class="e-sender">${!e.read ? '<span class="unread-dot"></span>' : ''} ${escapeHTML(e.from)}</div><div class="e-time">${formatDate(e.date)}</div></div><div class="e-subject">${escapeHTML(e.subject)} ${e.attachments?.length > 0 ? "📎" : ""}</div></a>`).join("")}
          </div>
        </div>
        <div id="toast">Berhasil disalin!</div>
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } }
    );
  } catch (err) {
    return new Response(`<pre>Error: ${escapeHTML(err.message)}</pre>`, { status: 500 });
  }
}

// ===================== ADMIN WEBMAIL =====================

async function handleAdminWebmail(request, env, authData, getCookie, cookieFlags, noCache) {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (params.get("admin") === "users") {
    const allKeys = await listAllKeys(env, "user:");
    let users = [];
    for (const key of allKeys) {
      try { const data = await env.EMAILS.get(key.name); if (data) users.push(JSON.parse(data)); } catch (e) {}
    }
    const rows = users.map(u => `<tr><td>${u.user_id}</td><td>${escapeHTML(u.first_name || "-")}</td><td>${escapeHTML(u.username || "-")}</td><td><span class="status-${u.status}">${u.status.toUpperCase()}</span></td><td><code>${u.key || "-"}</code></td><td>${u.email || "-"}</td><td>${u.approved_at ? new Date(u.approved_at).toLocaleString("id-ID") : "-"}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin - Users</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f9;padding:20px;}.container{max-width:1200px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;}h1{font-size:24px;margin-bottom:24px;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{padding:12px;text-align:left;border-bottom:1px solid #e0e4e8;}th{background:#fafafa;font-weight:600;}.status-approved{color:#2e7d32;background:#e8f5e9;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}.status-pending{color:#f57c00;background:#fff3e0;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}.status-blocked{color:#c62828;background:#ffebee;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}.status-suspended{color:#1565c0;background:#e3f2fd;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}.back-btn{display:inline-block;margin-bottom:20px;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;}</style></head><body><div class="container"><a href="/" class="back-btn">← Kembali</a><h1>👥 Telegram Users</h1><table><thead><tr><th>User ID</th><th>Name</th><th>Username</th><th>Status</th><th>Key</th><th>Email</th><th>Approved At</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
  }

  if (params.get("admin") === "pending") {
    const allKeys = await listAllKeys(env, "pending:");
    let pending = [];
    for (const key of allKeys) {
      try { const data = await env.EMAILS.get(key.name); if (data) pending.push(JSON.parse(data)); } catch (e) {}
    }
    const rows = pending.map(p => `<tr><td>${p.user_id}</td><td>${escapeHTML(p.first_name || "-")}</td><td>${escapeHTML(p.username || "-")}</td><td>${new Date(p.requested_at).toLocaleString("id-ID")}</td><td><a href="/?admin=approve&id=${p.user_id}" style="padding:6px 12px;background:#2e7d32;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;">Approve</a> <a href="/?admin=reject&id=${p.user_id}" style="padding:6px 12px;background:#c62828;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;margin-left:4px;">Reject</a></td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin - Pending</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f9;padding:20px;}.container{max-width:1200px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;}h1{font-size:24px;margin-bottom:24px;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{padding:12px;text-align:left;border-bottom:1px solid #e0e4e8;}th{background:#fafafa;font-weight:600;}.back-btn{display:inline-block;margin-bottom:20px;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;}</style></head><body><div class="container"><a href="/" class="back-btn">← Kembali</a><h1>⏳ Pending Requests</h1><table><thead><tr><th>User ID</th><th>Name</th><th>Username</th><th>Requested</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888;">Tidak ada pending request</td></tr>'}</tbody></table></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
  }

  if (params.get("admin") === "approve") {
    await handleApprove(params.get("id"), env.ADMIN_USER_ID, null, env);
    return new Response("", { status: 302, headers: { Location: "/?admin=pending", ...noCache } });
  }
  if (params.get("admin") === "reject") {
    await handleReject(params.get("id"), env.ADMIN_USER_ID, null, env);
    return new Response("", { status: 302, headers: { Location: "/?admin=pending", ...noCache } });
  }

  // Dashboard
  const allUserKeys = await listAllKeys(env, "user:");
  let total = 0, app = 0, pen = 0, blk = 0;
  for (const key of allUserKeys) {
    try {
      const data = await env.EMAILS.get(key.name);
      if (data) {
        const u = JSON.parse(data);
        total++;
        if (u.status === "approved") app++;
        else if (u.status === "pending") pen++;
        else if (u.status === "blocked") blk++;
      }
    } catch (e) {}
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin Dashboard</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f9;padding:20px;}.container{max-width:800px;margin:0 auto;}.card{background:#fff;border-radius:16px;padding:24px;margin-bottom:20px;border:1px solid #e0e4e8;}h1{font-size:24px;margin-bottom:8px;}.subtitle{color:#666;font-size:14px;margin-bottom:24px;}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:24px;}.stat-box{background:#fafafa;padding:20px;border-radius:12px;text-align:center;border:1px solid #e0e4e8;}.stat-number{font-size:28px;font-weight:800;color:#111;}.stat-label{font-size:12px;color:#666;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;}.menu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;}.menu-item{display:block;padding:16px;background:#111;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;text-align:center;}.menu-item:hover{background:#333;}.logout-btn{display:inline-block;margin-top:20px;padding:10px 20px;background:#ff3b30;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;}</style></head><body><div class="container"><div class="card"><h1>🔐 Admin Dashboard</h1><div class="subtitle">MediaFairy Tmail</div><div class="stats"><div class="stat-box"><div class="stat-number">${total}</div><div class="stat-label">Total</div></div><div class="stat-box"><div class="stat-number">${app}</div><div class="stat-label">Approved</div></div><div class="stat-box"><div class="stat-number">${pen}</div><div class="stat-label">Pending</div></div><div class="stat-box"><div class="stat-number">${blk}</div><div class="stat-label">Blocked</div></div></div><div class="menu-grid"><a href="/?admin=users" class="menu-item">👥 Users</a><a href="/?admin=pending" class="menu-item">⏳ Pending</a><a href="/" class="menu-item">📧 Webmail</a></div><a href="/?action=logout" class="logout-btn">Logout</a></div></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
}

// ===================== LOGIN & SETUP PAGES =====================

function loginPageHTML(error = "") {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Login - MediaFairy Tmail</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f6f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .login-container{width:100%;max-width:400px}
    .login-card{background:#fff;border-radius:20px;padding:32px;border:1px solid #e0e4e8;box-shadow:0 4px 20px rgba(0,0,0,0.04)}
    .logo{text-align:center;margin-bottom:24px}
    .logo-icon{font-size:48px;margin-bottom:12px}
    .logo-text{font-size:22px;font-weight:800;letter-spacing:-0.5px}
    .logo-sub{font-size:13px;color:#888;margin-top:4px}
    .tabs{display:flex;gap:8px;margin-bottom:24px}
    .tab{flex:1;padding:12px;border:none;background:#f4f6f9;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;color:#666;transition:all 0.2s}
    .tab.active{background:#111;color:#fff}
    .form-group{margin-bottom:16px}
    .form-label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:6px}
    .form-input{width:100%;padding:14px;border:1px solid #e0e4e8;border-radius:10px;font-size:14px;outline:none;background:#fafafa;transition:all 0.2s}
    .form-input:focus{border-color:#111;background:#fff}
    .btn-submit{width:100%;padding:14px;background:#111;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.2s}
    .btn-submit:hover{background:#333}
    .error{background:#ffebee;color:#c62828;padding:12px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px;text-align:center}
    .info-box{background:#e3f2fd;color:#1565c0;padding:12px;border-radius:10px;font-size:12px;margin-bottom:16px;line-height:1.5}
    .hidden{display:none}
  </style></head>
  <body><div class="login-container"><div class="login-card">
    <div class="logo"><div class="logo-icon">📧</div><div class="logo-text">MediaFairy Tmail</div><div class="logo-sub">Protected Access</div></div>
    ${error ? `<div class="error">${error}</div>` : ""}
    <div class="tabs"><button class="tab active" onclick="switchTab('user')">User Login</button><button class="tab" onclick="switchTab('admin')">Admin</button></div>
    <form id="user-form" action="/" method="GET"><input type="hidden" name="action" value="login"><input type="hidden" name="type" value="user">
      <div class="info-box">💡 Login dengan Telegram User ID dan Access Key dari bot.</div>
      <div class="form-group"><label class="form-label">Telegram User ID</label><input type="text" name="user_id" class="form-input" placeholder="123456789" required></div>
      <div class="form-group"><label class="form-label">Access Key</label><input type="text" name="key" class="form-input" placeholder="your-access-key" required></div>
      <button type="submit" class="btn-submit">Login</button>
    </form>
    <form id="admin-form" class="hidden" action="/" method="GET"><input type="hidden" name="action" value="login"><input type="hidden" name="type" value="admin">
      <div class="form-group"><label class="form-label">Admin Username</label><input type="text" name="username" class="form-input" placeholder="admin" required></div>
      <div class="form-group"><label class="form-label">Admin Password</label><input type="password" name="password" class="form-input" placeholder="••••••" required></div>
      <button type="submit" class="btn-submit">Login Admin</button>
    </form>
  </div></div>
  <script>
    function switchTab(type){
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      event.target.classList.add('active');
      if(type==='user'){document.getElementById('user-form').classList.remove('hidden');document.getElementById('admin-form').classList.add('hidden');}
      else{document.getElementById('user-form').classList.add('hidden');document.getElementById('admin-form').classList.remove('hidden');}
    }
  </script></body></html>`;
}

// Old setup domain page (fallback if no domain configured)
function setupDomainPage() {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Setup Domain - MediaFairy Tmail</title>
  <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}.card{background:#fff;border-radius:16px;padding:30px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.03);border:1px solid #e0e4e8;}input{padding:14px;border-radius:10px;border:1px solid #e0e4e8;width:100%;font-size:14px;outline:none;margin:16px 0;background:#fafafa;box-sizing:border-box;}button{display:block;width:100%;padding:14px;border-radius:10px;background:#111;color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;}</style></head>
  <body><div class="card"><div style="font-size:48px;margin-bottom:16px;">📮</div><h2 style="margin-bottom:8px;font-size:20px;">Halo!</h2><p style="color:#666;font-size:14px;margin-bottom:24px;">Tambahkan domain email kamu untuk memulai Tmail.</p>
  <form action="/" method="GET"><input type="hidden" name="action" value="set_custom"><input type="hidden" name="save_domain" value="on"><input type="text" name="domain_input" placeholder="contoh: domain.com" required><button type="submit">Lanjutkan</button></form></div></body></html>`;
}

// ===================== UTILITY =====================

async function getUserData(env, userId) {
  try { const d = await env.EMAILS.get(`user:${userId}`); return d ? JSON.parse(d) : null; } catch (e) { return null; }
}
async function saveUserData(env, userId, data) {
  await env.EMAILS.put(`user:${userId}`, JSON.stringify(data));
}
async function listAllKeys(env, prefix) {
  let allKeys = [], cursor;
  do {
    const result = await env.EMAILS.list({ prefix, cursor, limit: 1000 });
    allKeys = allKeys.concat(result.keys);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return allKeys;
}
function generateAccessKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}
function escapeHTML(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeMarkdown(text) { return String(text || "").replace(/[_*\[\]()~`>#+\-=|{}.!]/g, "\\$&"); }
function formatDate(dStr) {
  const d = new Date(dStr), diff = Date.now() - d.getTime();
  if (isNaN(diff)) return "-";
  if (diff < 60000) return "Baru";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m lalu";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "j lalu";
  if (diff < 2592000000) return Math.floor(diff / 86400000) + "h lalu";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function decodeContent(content, encoding) {
  if (!content) return "";
  const enc = (encoding || "").toLowerCase().trim();
  if (enc === "quoted-printable") return decodeQuotedPrintableUtf8(content);
  if (enc === "base64") return decodeBase64Utf8(content);
  return content;
}
function decodeQuotedPrintableUtf8(input) {
  if (!input) return "";
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=") {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; }
      else bytes.push(61);
    } else bytes.push(cleaned.charCodeAt(i));
  }
  try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch (e) { return input; }
}
function decodeBase64Utf8(input) {
  if (!input) return "";
  try {
    const b = atob(input.replace(/\s+/g, ""));
    const bytes = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) { return input; }
}
function notFoundPage(styles) {
  return new Response(
    `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${styles}</style></head>
    <body><div class="container" style="text-align:center;padding-top:60px;">
      <div style="font-size:48px;margin-bottom:16px;">🔍</div>
      <h2 style="margin-bottom:12px;">Tidak Ditemukan</h2>
      <p style="color:#666;margin-bottom:24px;font-size:14px;">Pesan sudah dihapus atau sesi telah berganti.</p>
      <a href="/" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">Kembali</a>
    </div></body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}