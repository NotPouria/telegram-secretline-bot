# 🔒 صندوق پیام ناشناس مشاور مدرسه | Telegram SecretLine Bot

این مخزن حاوی کدهای کامل ربات تلگرام **صندوق پیام ناشناس مشاور** است. هدف از انتشار عمومی (Open-Source) این کدها، شفافیت کامل و اطمینان خاطر دانش‌آموزان از حفظ حریم خصوصی‌شان است.

### 🛡️ این ربات چطور امنیت و ناشناس بودن شما را تضمین می‌کند؟
۱. **عدم دسترسی به اطلاعات پروفایل:** در کدهای فایل `worker.js`، ربات به هیچ عنوان نام (`first_name`)، نام خانوادگی (`last_name`) یا نام کاربری (`username`) فرستنده پیام را نمی‌خواند.
۲. **بدون دیتابیس و بدون ذخیره‌سازی:** این ربات روی زیرساخت ابری Cloudflare Workers اجرا می‌شود و هیچ پایگاه داده‌ای (Database) برای ذخیره تاریخچه پیام‌ها یا اطلاعات دانش‌آموزان ندارد.
۳. **رمزنگاری دوطرفه (`AES-GCM`):** برای اینکه مشاور بتواند بدون دیدن هویت شما به پیامتان پاسخ دهد، شناسه چت شما با استاندارد امنیتی `AES-GCM` قفل می‌شود و فقط در لحظه ارسال پاسخ، توسط ربات رمزگشایی می‌شود.

---

## 🌐 English Overview (For Developers & Educators)

**Telegram SecretLine Bot** is a lightweight, zero-database, two-way anonymous relay bot built for Cloudflare Workers. Originally created to replace physical school counselor drop-boxes (which lack privacy and two-way communication), it allows students to reach out for support anonymously and receive replies directly inside Telegram.

### Key Features
* **True Sender Anonymity:** Never accesses `msg.from` (names, usernames, or profile info).
* **Stateless & Zero-Database:** Uses Web Crypto API (`AES-GCM` + `SHA-256`) to encrypt routing tokens directly inside message footers—no KV or SQL database required.
* **Consistent Thread Aliases:** Generates a 6-character one-way hash (`#a4f9c2`) so the counselor knows when the same anonymous student is continuing a conversation.
* **English Admin / Persian User Interface:** Counselor notifications and code are in English; student-facing messages and privacy explanations are in Persian.

### Quick Deployment (Cloudflare Workers)
1. Fork or clone this repository.
2. Connect the repository to a Cloudflare Worker (`wrangler.toml` is pre-configured).
3. Add the following in **Settings -> Variables and Secrets**:
   * `BOT_TOKEN`: Your Telegram Bot token from `@BotFather`
   * `ADMIN_ID`: Your numeric Telegram chat ID
   * `REPO_URL`: Link to your public GitHub repository
4. Visit `https://<your-worker>.workers.dev/register` once in your browser to register the Telegram webhook.
