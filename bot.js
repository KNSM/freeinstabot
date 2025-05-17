const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BOT_TOKEN = '7565868655:AAGaELbwM3BtEPcjWRIR0aVL86t3qglb-YE'; // замени на свой
const bot = new Telegraf(BOT_TOKEN);
const videoPath = path.join(__dirname, 'temp_video.mp4');

// Улучшенная обработка ошибок
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

bot.on('text', async (ctx) => {
    const messageText = ctx.message.text;
    const chatType = ctx.chat.type;

    const botUsername = ctx.botInfo?.username;
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const isDirectMention = messageText.includes(`@${botUsername}`);
    const isCommand = messageText.startsWith('/reel');

    if (isGroup && !(isCommand || isDirectMention)) return;

    const urlMatch = messageText.match(/https?:\/\/(www\.)?instagram\.com\/reel\/[^\s]+/);
    if (!urlMatch) return ctx.reply('Пожалуйста, пришлите ссылку на Reels (Instagram)');

    const url = urlMatch[0];
    await ctx.reply('⏳ Обрабатываю ссылку...');

    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.goto('https://snapins.ai/', { waitUntil: 'domcontentloaded' });

        await page.type('input[name="url"]', url);
        await page.click('button[type="submit"]');

        const downloadButton = await page.waitForSelector('[download]', { timeout: 60000 });
        if (!downloadButton) throw new Error('Кнопка скачивания не найдена');

        const videoUrl = await page.$eval('[download]', (el) => el.href);
        await browser.close();

        const file = fs.createWriteStream(videoPath);
        https.get(videoUrl, (response) => {
            response.pipe(file);
            file.on('finish', async () => {
                try {
                    await ctx.replyWithVideo(
                        { source: videoPath },
                        {
                            caption: 'Вот ваше видео!',
                            supports_streaming: true,
                        }
                    );
                } catch (sendError) {
                    console.error('❌ Ошибка отправки видео:', sendError);
                    await ctx.reply('❌ Не удалось отправить видео. Попробуйте позже.');
                }
                try {
                    fs.unlinkSync(videoPath);
                } catch (unlinkError) {
                    console.error('❌ Ошибка удаления файла:', unlinkError);
                }
            });
        });
    } catch (err) {
        console.error('❌ Ошибка:', err);
        await ctx.reply('❌ Не удалось скачать видео. Попробуйте другую ссылку.');
    }
});

async function initBot() {
    try {
        console.log('🔄 Запуск бота...');
        const botInfo = await bot.telegram.getMe();
        bot.options.username = botInfo.username;
        console.log(`ℹ️ Информация о боте получена: @${botInfo.username}`);

        await bot.launch();
        console.log(`✅ Бот @${botInfo.username} успешно запущен!`);

        // Вывод информации о вебхуке (если используется)
        if (bot.options.telegram.webhookReply) {
            console.log('🌍 Режим работы: Webhook');
        } else {
            console.log('🔄 Режим работы: Long Polling');
        }
    } catch (err) {
        console.error('❌ Критическая ошибка запуска бота:', err);
        process.exit(1); // Завершаем процесс с ошибкой
    }
}

// Запускаем бота и обрабатываем завершение
initBot().then(() => {
    // Обработка сигналов завершения
    process.once('SIGINT', () => {
        console.log('\n🛑 Получен SIGINT. Остановка бота...');
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        console.log('\n🛑 Получен SIGTERM. Остановка бота...');
        bot.stop('SIGTERM');
    });
});