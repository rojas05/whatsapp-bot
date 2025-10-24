// index.js (reemplaza tu archivo actual con esto)
// ------------------------------------------------
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
const {guardarPedido,
    isSpecialSticker,
    getQuotedText,
    expandNumberTokens,
    decideNumbersToSave,
    extractNumbersWithIndexes,
  splitTokenIfNeeded} = require('./helpers/messageProsesor')
const {normalizeJidToPhone,getJidFromGroup,getDisplayNameFromGroup} = require('./grupData')
const { startCobroListener } = require('./listener/cobroListener');

// -------------------- VARIABLES DE ENTORNO --------------------
const COMANDOW = (process.env.COMANDOW || '') + ' ';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COMANDO = process.env.COMANDO;
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
let sock = null;
let pendingReconnect = false;

const POSITIVE_KEYWORDS = ['suyo','suyos'];

// -------------------- SESIÓN / START BOT --------------------
async function startBot() {
  try {
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
      try {
        if (qr) {
          console.log('📲 QR recibido. Enviando a Telegram...');
          await enviarQRporTelegram(qr);
          await enviarMensajeTelegram('📌 Se requiere un *nuevo inicio de sesión*. Escanea el QR enviado para continuar.');
          return; // no reconectar cuando se requiere QR
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
            // limpiar credenciales y pedir reconexión manual
            const authFolder = path.join(__dirname, 'baileys_auth');
            if (fs.existsSync(authFolder)) {
              fs.rmSync(authFolder, { recursive: true, force: true });
              console.log('🗑️ Credenciales eliminadas por logout.');
            }
            await enviarMensajeTelegram('📴 *Sesión cerrada.* Se requiere escanear un nuevo QR para continuar.');
            await enviarMensajeTelegram('¿Deseas reconectar? Responde con *si* para iniciar sesión de nuevo.');
            pendingReconnect = true;
            return;
          }

          // intentar reconectar automáticamente una vez
          reconnectionInProgress = true;
          try {
            console.log('🔄 Intentando reconectar automáticamente...');
            await startBot();
            reconnectionInProgress = false;
            return;
          } catch (err) {
            reconnectionInProgress = false;
            console.error('❌ Falló la reconexión automática:', err);
            await enviarMensajeTelegram('⚠️ Conexión cerrada. ¿Deseas reconectar? Responde con *si* para iniciar sesión de nuevo.');
            pendingReconnect = true;
            return;
          }
        } else if (connection === 'open') {
          reconnectionInProgress = false;
          console.log('✅ Bot conectado correctamente');
          await enviarMensajeTelegram(
            '✅ *Bot conectado correctamente a WhatsApp*\n\n' +
            '📌 *Recuerda:* tu comando principal es ' + COMANDOW + `.\n` +
            '⚠️ Si el bot falla, usa el comando \`@jh\` mientras el desarrollador soluciona el problema.'
          );
          startCobroListener(sock)
        }
      } catch (e) {
        console.error('Error en connection.update handler:', e);
      }
    });

    // Un solo listener para messages.upsert que maneja tanto "suyo" como el comando COMANDOW
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const m = messages[0];
        if (!m || !m.message) return;

        const from = m.key.remoteJid || '';
        const isGroup = from.endsWith('@g.us');

        // ---- Parte: respuestas "suyo" o sticker especial -> guardar pedidos (sólo en grupos)
        const replyText = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const stickerPresent = !!m.message.stickerMessage;
        const isStickerSpecial = isSpecialSticker(m);

        const shouldProcessSuyo = (
          (replyText && (/\d+/.test(replyText) || POSITIVE_KEYWORDS.some(k => replyText.toLowerCase().includes(k)) || replyText.trim().toLowerCase() === 'suyo'))
          || (stickerPresent && isStickerSpecial)
        );

        if (isGroup && shouldProcessSuyo) {
          try {
            // obtener contextInfo desde texto o sticker
            const ctx = m.message.extendedTextMessage?.contextInfo || m.message.stickerMessage?.contextInfo;
            if (!ctx) {
              console.log('⚠️ Respuesta no tiene contextInfo; imposible saber el mensaje citado.');
            } else {
              const quoted = ctx.quotedMessage;
              const participantRaw = ctx.participant || ctx.author || ctx.sender || 'desconocido';
              console.log(participantRaw)
              if (!quoted) {
                console.log('⚠️ No se encontró quotedMessage en contextInfo.');
              } else {
                const originalText = getQuotedText(quoted) || '';
                const originalTokens = extractNumbersWithIndexes(originalText).map(o => o.str);

                const originalExpanded = expandNumberTokens(originalTokens);

                // decide con la lógica de la función
                let selected = decideNumbersToSave(originalText, replyText);

                if (!Array.isArray(selected)) selected = [];

                // fallback: si vacío y original tiene números y reply es 'suyo' o triggered by sticker special
                const triggeredBySticker = stickerPresent && isStickerSpecial;
                const replyLower = (replyText || '').toLowerCase();
                const isTextSuyo = POSITIVE_KEYWORDS.some(k => replyLower.includes(k));

                if (selected.length === 0 && originalExpanded.length > 0 && (isTextSuyo || triggeredBySticker)) {
                  selected = Array.from(new Set(originalExpanded));
                }

                if (!selected || selected.length === 0) {
                  console.log('ℹ️ No se detectaron números para guardar en esta respuesta.');
                } else {
                  // normalizar y dividir tokens (ej: 3473 -> 34,73)
                  const normalizedSelected = Array.from(new Set(selected))
                    .flatMap(s => splitTokenIfNeeded(String(s)))
                    .map(s => String(s).replace(/\D+/g, ''))
                    .map(s => {
                      // si parece ser telefono con country code, normalizePhone lo limpiará
                      if (s.length > 6 && COUNTRY_CODE && s.startsWith(COUNTRY_CODE)) {
                        return s.slice(COUNTRY_CODE.length);
                      }
                      return s;
                    })
                    .filter(s => s && s.length > 0);

                  if (normalizedSelected.length === 0) {
                    console.log('ℹ️ Después de normalizar no hay números válidos.');
                  } else {
                    const jid = await getJidFromGroup(sock, from, ctx.participant);
                    const name = await getDisplayNameFromGroup(sock, from, ctx.participant)
                    console.log("jit  "+jid+name)
                    const clienteClean = normalizeJidToPhone(jid) + name
                    const tipo = stickerPresent && isStickerSpecial ? 'suyo_sticker' : 'suyo';
                    guardarPedido(clienteClean, normalizedSelected, tipo);
                    console.log(`✅ Guardado pedido de ${clienteClean}: ${normalizedSelected.join(', ')} (trigger: ${tipo})`);
                    try {
                      await enviarMensajeTelegram(`✅ Pedido guardado: ${normalizedSelected.join(', ')}\nCliente: ${clienteClean}`);
                    } catch (e) {
                      console.warn('No se pudo notificar a Telegram:', e?.message || e);
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error('❌ Error procesando respuesta suyo/sticker:', err);
            manejarError('respuesta suyo/sticker', err);
          }
        } // end shouldProcessSuyo

        // ---- Parte: comando COMANDOW (menciones) ----
        if (isGroup && (replyText || '').startsWith(COMANDOW.trim())) {
          try {
            const mensajeBase = (replyText || '').replace(COMANDOW.trim(), '').trim();
            if (mensajeBase.length === 0) {
              // no enviar nada vacío
            } else {
              await mencionarTodos(sock, from, mensajeBase);
            }
          } catch (error) {
            manejarError('Error procesando ' + COMANDOW, error);
          }
        }

      } catch (e) {
        console.error('Error general en messages.upsert:', e);
        manejarError('messages.upsert', e);
      }
    });

  } catch (e) {
    console.error('Error arrancando startBot:', e);
    manejarError('startBot', e);
  }
}

// -------------------- MENCION --------------------
async function mencionarTodos(sockInstance, groupId, mensajeBase) {
  try {
    const groupMetadata = await sockInstance.groupMetadata(groupId);
    const participantes = groupMetadata.participants || [];
    const mentions = participantes.map(p => p.id);

    const maxPorMensaje = 800;
    for (let i = 0; i < mentions.length; i += maxPorMensaje) {
      const bloque = mentions.slice(i, i + maxPorMensaje);
      await sockInstance.sendMessage(groupId, { text: mensajeBase, mentions: bloque });
      // aguantar un poco para no saturar
      await new Promise(r => setTimeout(r, 700));
    }
    console.log(`Mencionados ${mentions.length} miembros en ${groupId}`);
  } catch (err) {
    manejarError('mencionarTodos', err);
  }
}

// -------------------- TELEGRAM COMANDOS --------------------
telegramBot.onText(/\/restart/, async (msg) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  await restart(msg.chat.id);
});

telegramBot.onText(/\/logout/, async (msg) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  try {
    if (sock) {
      await sock.logout();
      sock = null;
      await logout();
      pendingReconnect = true;
      telegramBot.sendMessage(msg.chat.id, '📴 Sesión cerrada. ¿Deseas reconectar? Responde con *si* para reconectar.');
    } else {
      telegramBot.sendMessage(msg.chat.id, '⚠️ No hay ninguna sesión activa.');
    }
  } catch (err) {
    manejarError('Error al cerrar sesión', err);
  }
});

telegramBot.onText(/\/forcelogout/, async (msg) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  try {
    if (sock) {
      try { await sock.logout(); } catch (e) { console.log('Warn: sock.logout fallo', e.message); }
      sock = null;
    }
    const authFolder = path.join(__dirname, 'baileys_auth');
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
      console.log('🗑️ Carpeta de sesión eliminada manualmente con /forcelogout');
    }
    await telegramBot.sendMessage(msg.chat.id,
      '📴 *Se forzó el cierre de sesión y se eliminó la carpeta de credenciales.*\n\n🔄 Reiniciando el bot con PM2 para iniciar sesión limpia...');
    exec(COMANDO, (err) => {
      if (err) {
        console.error('❌ Error al reiniciar con PM2:', err);
        telegramBot.sendMessage(msg.chat.id, '❌ Error al reiniciar con PM2.');
        return;
      }
      console.log('✅ Bot reiniciado con PM2 tras forcelogout.');
    });
  } catch (err) {
    manejarError('Error ejecutando /forcelogout', err);
  }
});

telegramBot.onText(/\/update/, async (msg) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  try {
    await telegramBot.sendMessage(msg.chat.id, '📡 Actualizando código desde Git...');
    exec('git pull origin main', (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Error al actualizar código:', err);
        telegramBot.sendMessage(msg.chat.id, '❌ Error al actualizar código:\n' + stderr);
        return;
      }
      console.log('✅ Código actualizado:\n', stdout);
      telegramBot.sendMessage(msg.chat.id, '✅ Código actualizado:\n```\n' + (stdout || '') + '\n```', { parse_mode: 'Markdown' });
      exec(COMANDO, (err) => {
        if (err) {
          console.error('❌ Error al reiniciar con PM2:', err);
          telegramBot.sendMessage(msg.chat.id, '❌ Error al reiniciar con PM2.');
          return;
        }
        telegramBot.sendMessage(msg.chat.id, '🔄 Bot reiniciado con la última versión del repositorio.');
      });
    });
  } catch (err) {
    manejarError('Error ejecutando /update', err);
  }
});

// Respuesta "si" para pendingReconnect
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
  const mensaje = `❌ *Error en ${contexto}:*\n\`\`\`${(error && error.stack) ? error.stack : (error && error.message) ? error.message : JSON.stringify(error)}\`\`\``;
  console.error(mensaje);
  try {
    await telegramBot.sendMessage(TELEGRAM_CHAT_ID, mensaje, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('No se pudo enviar el error a Telegram:', e);
  }
}

function esErrorCritico(error) {
  const mensaje = (error && error.message) ? error.message : String(error || '');
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
  try {
    if (esErrorCritico(err)) {
      await enviarMensajeTelegram(`⚠️ *Error crítico detectado:* \n${err.message}\n\n🗑️ Eliminando sesión y reiniciando con PM2...`);
      await logout();
      restart();
    } else {
      await enviarMensajeTelegram(`ℹ️ *Error no crítico:* \n${err.message}`);
    }
  } catch (e) {
    console.error('Error manejando uncaughtException:', e);
  }
});

process.on('unhandledRejection', async (reason) => {
  console.error('⚠️ Promesa rechazada sin capturar:', reason);
  try {
    if (esErrorCritico(reason)) {
      await enviarMensajeTelegram(`⚠️ *Error crítico en promesa:* \n${reason}\n\n🗑️ Eliminando sesión y reiniciando con PM2...`);
      await logout();
      restart();
    } else {
      await enviarMensajeTelegram(`ℹ️ *Error no crítico en promesa:* \n${reason}`);
    }
  } catch (e) {
    console.error('Error manejando unhandledRejection:', e);
  }
});

// -------------------- LOGOUT / RESTART --------------------
async function logout() {
  const authFolder = path.join(__dirname, 'baileys_auth');
  if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
  }
}

async function restart(chatId) {
  try {
    exec(COMANDO, (err) => {
      if (err) {
        console.error('Error reiniciando con PM2:', err);
        if (chatId) telegramBot.sendMessage(chatId, '❌ Error reiniciando el bot con PM2.');
        return;
      }
      if (chatId) telegramBot.sendMessage(chatId, '✅ Bot reiniciado con PM2');
      console.log('✅ Bot reiniciado con PM2');
    });
  } catch (err) {
    manejarError('Error reiniciando el bot', err);
  }
}

startBot();
