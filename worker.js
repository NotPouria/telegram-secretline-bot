/**
 * Open-Source Anonymous School Counselor Bot (Cloudflare Worker)
 * Admin & Code: English | Student Interface: Persian (Farsi)
 * Zero-Database | AES-GCM Encrypted Routing
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

    // 1. One-click Webhook Registration: https://your-worker.workers.dev/register
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

    // 2. Telegram Webhook Endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        if (update.message) {
          await handleMessage(update.message, BOT_TOKEN, ADMIN_ID, REPO_URL);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query, BOT_TOKEN, REPO_URL);
        }
      } catch (err) {
        console.error("Webhook error:", err);
      }
      return new Response("OK", { status: 200 });
    }

    return new Response(
      `🤖 Open-Source Anonymous School Counselor Bot is running.\nSource Code: ${REPO_URL}`,
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};

// Escape HTML special characters so student/counselor text never breaks Telegram parsing
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Derive a cryptographic key from the bot token using SHA-256
async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Generate a short 6-character anonymous alias (e.g., #a4f9c2) to group repeat messages from the same student
async function getAnonAlias(chatId, secret) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(`${chatId}:${secret}`));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 3).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Encrypt the student's Chat ID using AES-GCM
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

// Decrypt the student's Chat ID when the admin replies
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

// Handle the student's "How does anonymity work?" button click (Persian for students)
async function handleCallback(cb, token, repoUrl) {
  if (cb.data === "explain_privacy") {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    const privacyText =
      "🛡️ <b>چطور هویتت کاملاً مخفی می‌مونه؟</b>\n\n" +
      "۱. این ربات طوری برنامه‌نویسی شده که اصلاً به نام، نام خانوادگی، یوزرنیم یا عکس پروفایل تو دسترسی نداره و اون‌ها رو نمی‌خونه.\n\n" +
      "۲. ربات هیچ دیتابیس یا حافظه‌ای برای ذخیره اطلاعات دانش‌آموزها نداره.\n\n" +
      "۳. وقتی پیامی می‌فرستی، آیدی عددی تلگرامت با الگوریتم امنیتی <code>AES-GCM</code> قفل (رمزنگاری) میشه تا مشاور فقط بتونه به پیامت جواب بده، بدون اینکه بدونه فرستنده کیه.\n\n" +
      "۴. برای اینکه خیالت راحت باشه، کل کدهای این ربات به صورت <b>متن‌باز (Open-Source)</b> در گیت‌هاب منتشر شده و هر کسی می‌تونه کدهاش رو بررسی کنه.";

    await tgApi(token, "sendMessage", {
      chat_id: cb.message.chat.id,
      text: privacyText,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "🔍 مشاهده کدهای ربات در GitHub", url: repoUrl }]],
      },
    });
  }
}

async function handleMessage(msg, token, adminId, repoUrl) {
  const senderId = String(msg.chat.id);
  const text = msg.text || "";

  // Handle /start and /source commands (English for Admin, Persian for Students)
  if (text.startsWith("/start") || text.startsWith("/source")) {
    const isAdmin = senderId === adminId;
    const welcomeText = isAdmin
      ? "👋 <b>Counselor Admin Mode Active!</b>\n\nWhenever a student sends a message, it will appear here with a short thread alias (e.g., <code>#a4f9c2</code>).\nSimply <b>swipe to reply</b> on any student message to deliver your answer back to them."
      : "سلام! 👋 به <b>صندوق پیام ناشناس مشاور</b> خوش اومدی. 🌱\n\n" +
        "برخلاف صندوق‌های قدیمی که وسط راهروی مدرسه و زیر دوربینن هستن و عملا هیچ راه بدرد بخوری هم برای جواب دادن ندارن، اینجا یه فضای کاملاً امن و دوطرفه‌ست!\n\n" +
        "هر دغدغه، سوال، درد دل یا پیشنهادی داری، می‌تونی همین‌جا به صورت <b>متن، عکس یا حتی ویس</b> بفرستی:\n" +
        "🔹 نام، یوزرنیم و پروفایل تلگرامت <b>به هیچ وجه</b> برای من قابل دیدن نیست.\n" +
        "🔹 وقتی جوابت رو بدم، همین‌جا برات ارسال میشه و می‌تونیم بدون اینکه هویتت مشخص بشه با هم گفتگو کنیم.\n\n" +
        "هر وقت آماده بودی، پیامت رو پایین بنویس 👇";

    const keyboard = isAdmin
      ? [[{ text: "🔍 View Open-Source Repository (GitHub)", url: repoUrl }]]
      : [
          [{ text: "🔒 چطور ناشناس می‌مونم؟ (توضیح امنیت)", callback_data: "explain_privacy" }],
          [{ text: "🔍 مشاهده کد متن‌باز ربات (GitHub)", url: repoUrl }],
        ];

    await tgApi(token, "sendMessage", {
      chat_id: senderId,
      text: welcomeText,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // CASE A: Admin is replying to a student's message (Admin notifications in English, Student view in Persian)
  if (senderId === adminId) {
    if (!msg.reply_to_message) {
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: "⚠️ To answer a student, please <b>swipe to reply</b> directly on their message.",
        parse_mode: "HTML",
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
      let result;

      // Deliver reply to student with Persian counselor header
      if (msg.text) {
        result = await tgApi(token, "sendMessage", {
          chat_id: targetChatId,
          text: `💬 <b>پاسخ مشاور:</b>\n\n${escapeHtml(msg.text)}\n\n🌱 <i>می‌تونی همین‌جا به گفتگو ادامه بدی:</i>`,
          parse_mode: "HTML",
        });
      } else {
        result = await tgApi(token, "copyMessage", {
          chat_id: targetChatId,
          from_chat_id: adminId,
          message_id: msg.message_id,
          caption: msg.caption ? `💬 پاسخ مشاور:\n\n${msg.caption}` : "💬 پاسخ مشاور",
        });
      }

      // Confirm delivery to Admin in English
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: result.ok
          ? "✅ Reply delivered to student!"
          : "❌ Delivery failed (the student may have blocked the bot).",
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

  // CASE B: Student sends an anonymous message (msg.from is NEVER read)
  // Header sent to Admin is in English
  const alias = await getAnonAlias(senderId, token);
  const encryptedRoute = await encryptRoute(senderId, token);
  const header = `📩 New Anonymous Message (Thread: #${alias})`;
  const footer = `[#RT_${encryptedRoute}]`;

  if (msg.text) {
    await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n\n${msg.text}\n\n${footer}`,
    });
  } else if (msg.photo || msg.video || msg.voice || msg.audio || msg.document) {
    const userCaption = msg.caption ? `\n\n${msg.caption}` : "";
    const fullCaption = `${header}${userCaption}\n\n${footer}`;
    await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
      caption: fullCaption.slice(0, 1024),
    });
  } else {
    // Stickers or round video notes
    const copied = await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
    });
    await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n⬆️ (Reply to this message to answer the student above)\n\n${footer}`,
      reply_to_message_id: copied.result?.message_id,
    });
  }

  // Confirm delivery to the student in Persian
  await tgApi(token, "sendMessage", {
    chat_id: senderId,
    text: "✅ پیامت به صورت کاملاً ناشناس به دست مشاور رسید.\nبه محض بررسی، جوابش رو همین‌جا دریافت می‌کنی. 🌱",
    reply_to_message_id: msg.message_id,
  });
}
