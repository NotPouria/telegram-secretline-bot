/**
 * Open-Source Anonymous School Counselor Bot (Cloudflare Worker) - v2.1
 * Admin & Code: English | Student Interface: Persian (Farsi)
 *
 * Features:
 *  - Zero-Database AES-GCM Encrypted Routing + Exact Message-ID Threading
 *  - Overflow-Safe Routing Tags (Prevents 1024/4096 char truncation bugs)
 *  - True Delivery Verification (Confirms to student only if Admin receives it)
 *  - Two-Way Live Message Editing (edited_message support for Student & Admin)
 *  - Anti-Self-Doxxing Guard (Blocks accidental Contact / Location sharing)
 *  - Automatic Voice-Note Privacy Reminder & Clean 👍 Admin Reactions
 *  - X-Telegram-Bot-Api-Secret-Token Webhook Protection
 * License: MIT
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const BOT_TOKEN = env.BOT_TOKEN;
    const ADMIN_ID = String(env.ADMIN_ID || "").trim();
    const REPO_URL = env.REPO_URL || "https://github.com/NotPouria/telegram-secretline-bot";

    if (!BOT_TOKEN || !ADMIN_ID) {
      return new Response(
        "⚠️ Missing Configuration: Set BOT_TOKEN and ADMIN_ID in Cloudflare Worker Variables.",
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    const webhookSecret = await getWebhookSecret(BOT_TOKEN);

    // 1. Webhook Registration (Idempotent check to prevent rate-limit spam)
    if (url.pathname === "/register") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ["message", "edited_message", "callback_query"],
        }),
      });
      const data = await res.json();
      return new Response(
        data.ok
          ? `✅ Secured Webhook (v2.1) registered: ${webhookUrl}`
          : `❌ Failed: ${JSON.stringify(data)}`,
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    // 2. Verified Telegram Webhook Endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (incomingSecret !== webhookSecret) {
        return new Response("Unauthorized", { status: 403 });
      }

      try {
        const update = await request.json();
        if (update.message) {
          await handleMessage(update.message, BOT_TOKEN, ADMIN_ID, REPO_URL, false);
        } else if (update.edited_message) {
          await handleMessage(update.edited_message, BOT_TOKEN, ADMIN_ID, REPO_URL, true);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query, BOT_TOKEN, REPO_URL);
        }
      } catch (err) {
        console.error("Webhook error:", err);
      }
      return new Response("OK", { status: 200 });
    }

    return new Response(
      `🤖 Open-Source Anonymous School Counselor Bot (v2.1) is running.\nSource Code: ${REPO_URL}`,
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function getWebhookSecret(secret) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(`webhook:${secret}`));
  return Array.from(new Uint8Array(hashBuffer))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function getAnonAlias(chatId, secret) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(`${chatId}:${secret}`));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 3).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encryptRoute(chatId, msgId, secret) {
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(`${chatId}:${msgId}`);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Array.from(combined).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decryptRoute(hexToken, secret) {
  const key = await getCryptoKey(secret);
  const bytes = new Uint8Array(hexToken.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const decoded = new TextDecoder().decode(decrypted);
  const [chatId, msgId] = decoded.split(":");
  return { chatId, msgId: msgId ? Number(msgId) : undefined };
}

async function tgApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

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

async function handleMessage(msg, token, adminId, repoUrl, isEdit = false) {
  const senderId = String(msg.chat.id);
  const text = msg.text || "";

  // Handle /start and /source commands (ignore on edits)
  if (!isEdit && (text.startsWith("/start") || text.startsWith("/source"))) {
    const isAdmin = senderId === adminId;
    const welcomeText = isAdmin
      ? "👋 <b>Counselor Admin Mode Active (v2.1)!</b>\n\n" +
        "• Incoming student messages display a short thread alias (e.g., <code>#a4f9c2</code>).\n" +
        "• <b>Swipe to reply</b> on any student message to deliver your answer directly to that specific message bubble.\n" +
        "• If you edit a text reply, the updated version is automatically sent to the student.\n" +
        "• Delivered replies get an automatic 👍 reaction."
      : "سلام! 👋 به <b>صندوق پیام ناشناس مشاور</b> خوش اومدی. 🌱\n\n" +
        "برخلاف صندوق‌های قدیمی توی راهروی مدرسه که زیر دوربینن و هیچ راهی هم برای جواب دادن ندارن، اینجا یه فضای کاملاً امن و دوطرفه‌ست!\n\n" +
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

  // CASE A: Admin is replying (or editing a reply) to a student
  if (senderId === adminId) {
    if (!msg.reply_to_message) {
      if (!isEdit) {
        await tgApi(token, "sendMessage", {
          chat_id: adminId,
          text: "⚠️ To answer a student, please <b>swipe to reply</b> directly on their message.",
          parse_mode: "HTML",
        });
      }
      return;
    }

    const originalContent = msg.reply_to_message.text || msg.reply_to_message.caption || "";
    const match = originalContent.match(/\[#RT_([0-9a-fA-F]+)\]/);

    if (!match) {
      if (!isEdit) {
        await tgApi(token, "sendMessage", {
          chat_id: adminId,
          text: "❌ Could not find a valid routing tag in the message you replied to.",
        });
      }
      return;
    }

    try {
      const { chatId: targetChatId, msgId: targetMsgId } = await decryptRoute(match[1], token);
      let result;
      const prefix = isEdit ? "✏️ <b>اصلاحیه پاسخ مشاور:</b>" : "💬 <b>پاسخ مشاور:</b>";

      if (msg.text) {
        result = await tgApi(token, "sendMessage", {
          chat_id: targetChatId,
          text: `${prefix}\n\n${escapeHtml(msg.text.slice(0, 3800))}\n\n🌱 <i>می‌تونی همین‌جا به گفتگو ادامه بدی:</i>`,
          parse_mode: "HTML",
          reply_to_message_id: targetMsgId,
          allow_sending_without_reply: true,
        });
      } else {
        result = await tgApi(token, "copyMessage", {
          chat_id: targetChatId,
          from_chat_id: adminId,
          message_id: msg.message_id,
          caption: msg.caption
            ? `💬 پاسخ مشاور:\n\n${msg.caption.slice(0, 950)}`
            : "💬 پاسخ مشاور",
          reply_to_message_id: targetMsgId,
          allow_sending_without_reply: true,
        });
      }

      if (result.ok) {
        const reactRes = await tgApi(token, "setMessageReaction", {
          chat_id: adminId,
          message_id: msg.message_id,
          reaction: [{ type: "emoji", emoji: "👍" }],
        });
        if (!reactRes.ok && !isEdit) {
          await tgApi(token, "sendMessage", {
            chat_id: adminId,
            text: "✅ Reply delivered to student!",
            reply_to_message_id: msg.message_id,
          });
        }
      } else {
        await tgApi(token, "sendMessage", {
          chat_id: adminId,
          text: "❌ Delivery failed (the student may have blocked the bot).",
          reply_to_message_id: msg.message_id,
        });
      }
    } catch {
      await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text: "❌ Failed to decrypt routing token.",
      });
    }
    return;
  }

  // CASE B: Student sends or edits an anonymous message (msg.from is NEVER accessed)

  // Anti-Self-Doxxing Guard: Block accidental contact or location sharing
  if (msg.contact || msg.location || msg.venue) {
    await tgApi(token, "sendMessage", {
      chat_id: senderId,
      text: "🛡️ <b>محافظت از حریم خصوصی:</b>\n\nبرای اینکه هویتت ۱۰۰٪ ناشناس بمونه، ارسال شماره تماس (Contact) و موقعیت مکانی (Location) در این ربات مسدود شده است. لطفاً پیامت رو به صورت متنی بفرست. 🌱",
      parse_mode: "HTML",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  const alias = await getAnonAlias(senderId, token);
  const encryptedRoute = await encryptRoute(senderId, msg.message_id, token);
  const mediaTag = msg.voice ? " [🎙️ Voice Note]" : "";
  const actionLabel = isEdit ? "✏️ Edited Anonymous Message" : "📩 New Anonymous Message";
  const header = `${actionLabel} (Thread: #${alias})${mediaTag}`;
  const footer = `[#RT_${encryptedRoute}]`;

  let adminResult;

  if (msg.text) {
    // Truncate body safely to 3800 chars so header + body + [#RT_...] never exceeds 4096 chars
    const safeText = msg.text.length > 3800 ? msg.text.slice(0, 3800) + "…" : msg.text;
    adminResult = await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n\n${safeText}\n\n${footer}`,
    });
  } else if (msg.photo || msg.video || msg.voice || msg.audio || msg.document) {
    // Truncate caption safely to 800 chars so [#RT_...] is NEVER sliced off by Telegram's 1024-char limit
    const safeCaption = msg.caption
      ? `\n\n${msg.caption.length > 800 ? msg.caption.slice(0, 800) + "…" : msg.caption}`
      : "";
    const fullCaption = `${header}${safeCaption}\n\n${footer}`;
    adminResult = await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
      caption: fullCaption,
    });
  } else {
    const copied = await tgApi(token, "copyMessage", {
      chat_id: adminId,
      from_chat_id: senderId,
      message_id: msg.message_id,
    });
    adminResult = await tgApi(token, "sendMessage", {
      chat_id: adminId,
      text: `${header}\n⬆️ (Reply to this message to answer the student above)\n\n${footer}`,
      reply_to_message_id: copied.result?.message_id,
    });
  }

  // Only confirm delivery to the student if the message actually reached the Admin
  if (!adminResult || !adminResult.ok) {
    await tgApi(token, "sendMessage", {
      chat_id: senderId,
      text: "❌ متأسفانه خطایی در ارسال پیام پیش اومد. لطفاً پیامت رو کوتاه‌تر کن یا دوباره امتحان کن.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  const confirmationText = isEdit
    ? "✅ ویرایش پیامت برای مشاور ارسال شد. 🌱"
    : msg.voice
    ? "✅ ویس تو بدون نام و مشخصات برای مشاور ارسال شد.\n💡 <i>نکته: یادت باشه توی پیام صوتی، صدای خودت قابل شنیدنه! اگر می‌خوای صدات هم شناخته نشه، می‌تونی پیام متنی بفرستی.</i> 🌱"
    : "✅ پیامت به صورت کاملاً ناشناس به دست مشاور رسید.\nبه محض بررسی، جوابش رو همین‌جا دریافت می‌کنی. 🌱";

  await tgApi(token, "sendMessage", {
    chat_id: senderId,
    text: confirmationText,
    parse_mode: "HTML",
    reply_to_message_id: msg.message_id,
  });
}
