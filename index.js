require('dotenv').config();
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

// -------------------- IMPORTACIONES LOCALES --------------------
const enviarMensajeTelegram = require('./telegram/telegram');
const enviarQRporTelegram = require('./telegram/notificarQR');

// -------------------- VARIABLES DE ENTORNO --------------------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COMANDO = process.env.COMANDO;
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let sock;

// -------------------- CONTROL DE SECION --------------------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('📲 QR recibido. Enviando a Telegram...');
            await enviarQRporTelegram(qr);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada. ¿Reconectar?', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado correctamente');
            await enviarMensajeTelegram('✅ *Bot conectado correctamente a WhatsApp*');
        }
    });

// -------------------- MANEJADOR DE MENSAJES --------------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';

        if (text.startsWith('@t ')) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const sender = m.key.participant || m.key.remoteJid;

                const esAdmin = groupMetadata.participants.some(
                    p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin')
                );

                if (!esAdmin) {
                    await enviarMensajeTelegram(`⛔ Usuario ${sender} intentó usar @t sin ser admin.`);
                    console.log(`⛔ Usuario ${sender} intentó usar @t sin ser admin.`);
                    return;
                }

                const mensajeBase = text.replace('@t', '').trim();
                await mencionarTodos(sock, from, mensajeBase);
            } catch (error) {
                manejarError('Error procesando @t', error);
            }
        }
    });
}

// -------------------- MENCION --------------------
async function mencionarTodos(sock, groupId, mensajeBase) {
    const groupMetadata = await sock.groupMetadata(groupId);
    const participantes = groupMetadata.participants;
    const mentions = participantes.map(p => p.id);

    const maxPorMensaje = 600;
    for (let i = 0; i < mentions.length; i += maxPorMensaje) {
        const bloque = mentions.slice(i, i + maxPorMensaje);
        await sock.sendMessage(groupId, {
            text: mensajeBase,
            mentions: bloque
        });
    }

    console.log(`Mencionados ${mentions.length} miembros en ${groupId}`);
}

// -------------------- TELEGRAM COMANDOS --------------------
telegramBot.onText(/\/restart/, async (msg) => {
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
    try {
        exec(COMANDO, (err, stdout, stderr) => {
            if (err) throw err;
            telegramBot.sendMessage(msg.chat.id, '✅ Bot reiniciado con PM2');
            console.log('✅ Bot reiniciado con PM2');
        });
    } catch (err) {
        manejarError('Error reiniciando el bot', err);
    }
});

telegramBot.onText(/\/logout/, async (msg) => {
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

    try {
        if (sock) {
            await sock.logout();
            sock = null;

            const authFolder = path.join(__dirname, 'baileys_auth');
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
            }

            telegramBot.sendMessage(msg.chat.id, '📴 Sesión de WhatsApp cerrada y credenciales eliminadas.');
        } else {
            telegramBot.sendMessage(msg.chat.id, '⚠️ No hay ninguna sesión activa.');
        }
    } catch (err) {
        manejarError('Error al cerrar sesión', err);
    }
});

// -------------------- MANEJADOR GLOBAL DE ERRORES --------------------
async function manejarError(contexto, error) {
    const mensaje = `❌ *Error en ${contexto}:*\n\`\`\`${error.stack || error.message}\`\`\``;
    console.error(mensaje);
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, mensaje, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("No se pudo enviar el error a Telegram:", e);
    }
}

process.on('uncaughtException', (error) => {
    manejarError('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
    manejarError('unhandledRejection', reason instanceof Error ? reason : new Error(reason));
});

startBot();