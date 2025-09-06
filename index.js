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
const { exec } = require('child_process');

// -------------------- IMPORTACIONES LOCALES --------------------
const enviarMensajeTelegram = require('./telegram/telegram');
const enviarQRporTelegram = require('./telegram/notificarQR');

// -------------------- VARIABLES DE ENTORNO --------------------
const COMANDOW = process.env.COMANDOW+' ';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COMANDO = process.env.COMANDO;
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let sock;
let pendingReconnect = false;

// -------------------- CONTROL DE SESIÓN --------------------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

   let reconnectionInProgress = false;

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('📲 QR recibido. Enviando a Telegram...');
            await enviarQRporTelegram(qr);
            return;
        }

        if (connection === 'close') {
            if (reconnectionInProgress) {
                console.log('⏳ Reconexión ya en progreso. No preguntar de nuevo.');
                return;
            }

            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada. loggedOut: ${loggedOut}`);

            if (loggedOut) {
                const authFolder = path.join(__dirname, 'baileys_auth');
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                    console.log('🗑️ Credenciales eliminadas por logout.');
                }
            }

            await enviarMensajeTelegram(
                '⚠️ *Conexión cerrada.* ¿Deseas reconectar? Responde con *si* para iniciar sesión de nuevo.'
            );

            reconnectionInProgress = true; // <--- MARCAMOS EL PROCESO
            pendingReconnect = true;
        } else if (connection === 'open') {
            reconnectionInProgress = false; // <--- RESETEAMOS LA BANDERA
            console.log('✅ Bot conectado correctamente');
            await enviarMensajeTelegram(
                '✅ *Bot conectado correctamente a WhatsApp*\n\n' +
                '📌 *Recuerda:* tu comando principal es ' + COMANDOW + `.\n` +
                '⚠️ Si el bot falla o presenta inconvenientes, usa el comando `@jh` mientras el desarrollador soluciona el problema.'
            );

        }
    });

    // -------------------- MANEJADOR DE MENSAJES --------------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return; // Ahora sí procesamos fromMe también
        const from = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        if (text.startsWith(COMANDOW)) {
            try {
                const mensajeBase = text.replace(COMANDOW, '').trim();
                await mencionarTodos(sock, from, mensajeBase);
            } catch (error) {
                manejarError('Error procesando '+COMANDOW, error);
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
    await restart()
});

telegramBot.onText(/\/logout/, async (msg) => {
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
        try {
        if (sock) {
            await sock.logout();
            sock = null;

            await logout()

            pendingReconnect = true;
            telegramBot.sendMessage(msg.chat.id, '📴 Sesión cerrada. ¿Deseas reconectar? Responde con *si* para reconectar.');
        } else {
            telegramBot.sendMessage(msg.chat.id, '⚠️ No hay ninguna sesión activa.');
        }
    } catch (err) {
        manejarError('Error al cerrar sesión', err);
    }
});

// -------------------- ESCUCHAR RESPUESTA PARA RECONEXIÓN --------------------
telegramBot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

    const text = msg.text?.trim().toLowerCase();
    if (pendingReconnect && text === 'si') {
        pendingReconnect = false;
        await enviarMensajeTelegram('🔄 *Reconectando bot a WhatsApp...*');
        startBot();
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

function esErrorCritico(error) {
    const mensaje = error?.message || error?.toString();

    return (
        mensaje.includes('invalid session') ||
        mensaje.includes('baileys') ||
        mensaje.includes('connection failed') ||
        mensaje.includes('auth') ||
        mensaje.includes('ECONNRESET') ||
        mensaje.includes('EHOSTUNREACH') ||
        mensaje.includes('ENOTFOUND')
    );
}

process.on('uncaughtException', async (err) => {
    console.error('❌ Error no capturado:', err);

    if (esErrorCritico(err)) {
        await enviarMensajeTelegram(`⚠️ *Error crítico detectado:* \n${err.message}\n\nIntentaremos recuperarlo reiniciando el bot.`);
        setTimeout(() => restart());
    } else {
        await enviarMensajeTelegram(`ℹ️ *Error no crítico:* \n${err.message}`);
    }
});

process.on('unhandledRejection', async (reason) => {
    console.error('⚠️ Promesa rechazada sin capturar:', reason);

    if (esErrorCritico(reason)) {
        await enviarMensajeTelegram(`⚠️ *Error crítico en promesa:* \n${reason}\n\nReiniciando el bot...`);
        setTimeout(() => {restart()});
    } else {
        await enviarMensajeTelegram(`ℹ️ *Error no crítico en promesa:* \n${reason}`);
    }
});

async function logout() {
    const authFolder = path.join(__dirname, 'baileys_auth');
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
            }
}

async function restart() {
    try {
        exec(COMANDO, (err) => {
            if (err) throw err;
            telegramBot.sendMessage(msg.chat.id, '✅ Bot reiniciado con PM2');
            console.log('✅ Bot reiniciado con PM2');
        });
    } catch (err) {
        manejarError('Error reiniciando el bot', err);
    }
}

startBot();
