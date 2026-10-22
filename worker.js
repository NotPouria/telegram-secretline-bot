/**
 * Open-Source Anonymous Telegram Relay Bot (Cloudflare Worker)
 * Zero database/KV storage. Zero access to sender names or usernames.
 * License: MIT
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const BOT_TOKEN = env.BOT_TOKEN;
    const ADMIN_ID = String(env.ADMIN_ID || "").trim();
    const REPO_URL = env.REPO_URL || "https://github.com";

    if (!BOT_TOKEN || !ADMIN_ID) {
      return new Response(
        "⚠️ Missing Configuration: Set BOT_TOKEN and ADMIN_ID in Cloudflare Worker Variables.",
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (url.pathname === "/register") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
      const data = await res.json();
      return new Response(
        data.ok
          ? `✅ Webhook registered: ${webhookUrl}`
          : `❌ Failed: ${JSON.stringify(data)}`,
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        if (update.message) {
          await handleMessage(update.message, BOT_TOKEN, ADMIN_ID, REPO_URL);
        }
      } catch (err) {
        console.error("Webhook error:", err);
      }
      return new Response("OK", { status: 200 });
    }

    return new Response(
      `🤖 Open-Source Anonymous Telegram Bot is running.\nSource code: ${REPO_URL}`,
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};

// Derive a cryptographic key from the secret token using SHA-256
async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Create a short, one-way anonymous alias (e.g., #a4f9c2) so conversations stay grouped
async function getAnonAlias(chatId, secret) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(`${chatId}:${secret}`));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 3).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Encrypt the routing ID using AES-GCM
async function encryptRoute(chatId, secret) {
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(chatId));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Array.from(combined).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Decrypt the routing ID when the admin replies
async function decryptRoute(hexToken, secret) {
  const key = await getCryptoKey(secret);
  const bytes = new Uint8Array(hexToken.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function tgApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function handleMessage(msg, token, adminId, repoUrl) {
  const senderId = String(msg.chat.id);
  const text = msg.text || "";

  // Handle /start and /source commands
  if (text.startsWith("/start") || text.startsWith("/source")) {
    const isAdmin = senderId === adminId;
    const welcomeText = isAdmin
      ? "👋 *Admin Mode Active*\n\nSwipe to reply on any incoming message to answer the anonymous sender."
      : "🔒 *Anonymous Two-Way Inbox*\n\nSend any text, photo, voice note, or sticker below. This bot is *100% open-source*—it never reads your name, username, or profile, and stores zero database logs.\n\nYou will receive replies right inside this chat.";

    await tgApi(token, "sendMessage", {
      chat_id: senderId,
      text: welcomeText,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔍 View Open-Source Code", url: repoUrl }]],
      },
    });
    return;
  }

  // CASE A: Admin is replying to an anonymous message
  if (senderId === adminId) {
    if (!msg.reply_to_message) {
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: "⚠️ Swipe to reply directly on an incoming message to send your response.",
      });
      return;
    }

    const originalContent = msg.reply_to_message.text || msg.reply_to_message.caption || "";
    const match = originalContent.match(/\[#RT_([0-9a-fA-F]+)\]/);

    if (!match) {
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: "❌ Could not find a valid routing tag in the message you replied to.",
      });
      return;
    }

    try {
      const targetChatId = await decryptRoute(match[1], token);
      const result = await tgApi(token, "copyMessage", {
        chat_id: targetChatId,
        from_chat_id: adminId,
        message_id: msg.message_id,
      });

      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: result.ok ? "✅ Reply delivered!" : "❌ Delivery failed (user may have blocked the bot).",
        reply_to_message_id: msg.message_id,
      });
    } catch {
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: "❌ Failed to decrypt routing token.",
      });
    }
    return;
  }

  // CASE B: User sends an anonymous message (Notice: msg.from is never accessed!)
  const alias = await getAnonAlias(senderId, token);
  const encryptedRoute = await encryptRoute(senderId, token);
  const header = `📩 Anon #${alias} [#RT_${encryptedRoute}]`;

  if (msg.text) {
    await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n\n${msg.text}`,
    });
  } else if (msg.photo || msg.video || msg.voice || msg.audio || msg.document) {
    const caption = msg.caption ? `${header}\n\n${msg.caption}` : header;
    await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
      caption: caption.slice(0, 1024),
    });
  } else {
    const copied = await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
    });
    await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n⬆️ (Reply to this message to answer the sender above)`,
      reply_to_message_id: copied.result?.message_id,
    });
  }

  await tgApi(token, "sendMessage", {
    chat_id: senderId,
    text: "✅ Sent anonymously!",
    reply_to_message_id: msg.message_id,
  });
}
