const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Конфигурация
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('❌ TELEGRAM_BOT_TOKEN не задан!');
const bot = new Telegraf(BOT_TOKEN);
const videoPath = path.join(__dirname, 'temp_video.mp4');

// Оптимизация для Puppeteer в облаке
const PUPPETEER_OPTIONS = {
    headless: 'new',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
};

// Обработка ошибок
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
    process.exit(1);
});

// Очистка временных файлов
function cleanup() {
    try {
        if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }
    } catch (err) {
        console.error('❌ Ошибка при очистке:', err);
    }
}

// Основной обработчик
bot.on('text', async (ctx) => {
    const { text, chat } = ctx.message;
    const botUsername = ctx.botInfo.username;

    // Проверка триггеров
    const isGroup = ['group', 'supergroup'].includes(chat.type);
    const isMentioned = text.includes(`@${botUsername}`);
    const isCommand = text.startsWith('/reel');

    if (isGroup && !(isCommand || isMentioned)) return;

    // Валидация URL
    const urlMatch = text.match(/https?:\/\/(www\.)?instagram\.com\/(reel|p)\/[^\s]+/i);
    if (!urlMatch) return ctx.reply('🔗 Пришлите ссылку на Instagram Reel или Post');

    const url = urlMatch[0];
    await ctx.replyWithChatAction('upload_video');

    try {
        // Загрузка видео
        await ctx.reply('⏳ Скачиваю видео...');
        const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
        const page = await browser.newPage();

        await page.goto('https://snapins.ai/', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await page.type('input[name="url"]', url);
        await page.click('button[type="submit"]');

        // Ожидание загрузки
        await page.waitForSelector('[download]', { timeout: 60000 });
        const videoUrl = await page.$eval('[download]', el => el.href);
        await browser.close();

        // Скачивание и отправка
        const file = fs.createWriteStream(videoPath);
        await new Promise((resolve, reject) => {
            https.get(videoUrl, response => {
                response.pipe(file);
                file.on('finish', resolve);
                file.on('error', reject);
            }).on('error', reject);
        });

        await ctx.replyWithVideo(
            { source: fs.createReadStream(videoPath) },
            {
                caption: '🎥 Ваше видео готово!',
                supports_streaming: true
            }
        );

    } catch (err) {
        console.error('❌ Ошибка:', err);
        await ctx.reply('⚠️ Не удалось обработать видео. Попробуйте другую ссылку.');
    } finally {
        cleanup();
    }
});

// Управление жизненным циклом
(async () => {
    try {
        await bot.launch();
        console.log('🤖 Бот успешно запущен!');
        console.log('⚡ Режим работы:', bot.options.telegram.webhookReply ? 'Webhook' : 'Long Polling');
    } catch (err) {
        console.error('❌ Фатальная ошибка:', err);
        process.exit(1);
    }
})();

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
    process.once(signal, () => {
        console.log(`🛑 Получен ${signal}. Остановка бота...`);
        bot.stop(signal);
        cleanup();
        process.exit(0);
    });
});