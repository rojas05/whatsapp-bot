const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const { guardarGrupoLocal, obtenerGruposLocales, eliminarGrupoPorNombre } = require('./storage');
const { hour } = require('./hora');
const enviarMensajeTelegram = require('./telegram');
const enviarQRporTelegram = require('./notificarQR');
const TelegramBot = require('node-telegram-bot-api');

const { exec } = require('child_process');

require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COMANDO = process.env.COMANDO;

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const SESSION_PATH = process.env.SESSION_PATH;

// Variables en memoria
let gruposRegistrados = obtenerGruposLocales();

// Función centralizada para errores
function logError(context, error) {
    console.error(`${hour()} ::: [${context}]`, error);
}

// Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH
    }),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions'
        ]
    }
});

// QR de inicio de sesión

client.on('qr', async (qr) => {
    ultimoQR = qr
    console.log(hour(), '📲 Escanea este código QR para conectar:');
    await enviarQRporTelegram(qr);
});    


// Bot listo
client.on('ready', () => {
    console.log(hour(), '✅ Bot de WhatsApp conectado y listo');
});

//perdida de coneccion
client.on('disconnected', async (reason) => {
    console.log('Cliente desconectado:', reason);

    const mensaje = `⚠️ *Bot WhatsApp desconectado*
    *Razón:* \`${reason}\`
    *Hora:* ${new Date().toLocaleString()}
    📲 Necesita reiniciar o volver a vincular`;

    await enviarMensajeTelegram(mensaje);
});

//estado de cliente
client.on('change_state', (state) => {
    console.log('📡 Estado de conexión cambiado:', state);
  
    // Lista de estados donde es mejor reiniciar
    const estadosCriticos = [
      'CONFLICT',
      'TOS_BLOCK',
      'PROXYBLOCK',
      'SMB_TOS_BLOCK',
      'UNPAIRED',
      'UNPAIRED_IDLE',
      'DEPRECATED_VERSION'
    ];
  
    if (estadosCriticos.includes(state)) {
      console.log(`⚠️ Estado crítico detectado (${state}), reiniciando el bot...`);
  
      // Si tienes una notificación por Telegram, también puedes agregarla aquí
  
      // Reiniciar con PM2
      const { exec } = require('child_process');
      exec(COMANDO
        , (err, stdout, stderr) => {
        if (err) {
          console.error('❌ Error reiniciando el bot:', err);
          return;
        }
        console.log('✅ Bot reiniciado con PM2');
      });
    }
  })

// Solo mensajes que salen
client.on('message_create', async (msg) => {
    if (msg.fromMe) await manejarMensajeAdminBot(msg);
});

// Solo mensajes que llegan
client.on('message', async (msg) => {
    if (!msg.fromMe) await manejarMensajeAdminBot(msg);
});


// Manejo general
async function manejarMensajeAdminBot(msg) {
    try {
        const chat = await msg.getChat();
        const isAdminBot = chat.isGroup && chat.name.toLowerCase() === 'adminbottest';
        const body = msg.body.toLowerCase();

        if (isAdminBot) {
            if (body === 'grupos') {
                await sentMensaggesAdminGrup(chat);
            } else if (body.startsWith('delete')) {
                await deleteGrup(chat, msg);
            } else if (body.startsWith('registrar grupo')) {
                await registerMensaggesAdminGrup(chat, msg);
            }else if (body.startsWith('grupos registrados')) {
                await sentMensaggesAdminGrupRegister(chat, msg);
            }
        } else {
            await manejarMensaje(msg);
        }

    } catch (error) {
        logError("AdminBot", error);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Simula delay con base en la cantidad de caracteres del mensaje
function delayPorTexto(texto, velocidadLecturaMsPorCaracter = 50) {
    const caracteres = texto.length;
    const tiempo = Math.min(caracteres * velocidadLecturaMsPorCaracter, 5000); // máximo 5s
    return new Promise(resolve => setTimeout(resolve, tiempo));
}

// Mensaje desde otro grupo (reenviar)
async function manejarMensaje(msg) {
    try {
        const chat = await msg.getChat();

        if (chat.isGroup) {

            const nombreGrupo = chat.name.toLowerCase();

            if (gruposRegistrados[nombreGrupo]) {
                const destinoId = gruposRegistrados[nombreGrupo];
                const grupoDestino = await client.getChatById(destinoId);
                const contenido = msg.body;

                // Simula lectura
                await delayPorTexto(contenido);

                // Mencionar a todos los participantes
                const mentions = grupoDestino.participants.map(p => p.id._serialized);
                const text = contenido + '\n';

                try {
                    // Intentar enviar el mensaje a todos los participantes
                    // Simula escritura
                    await grupoDestino.sendStateTyping();
                    await delayPorTexto(contenido);
                    await grupoDestino.sendMessage(text, { mentions });
                    await grupoDestino.clearState();
                    console.log(hour(), `✅ Reenviado de "${chat.name}" a ${destinoId}`);
                } catch (error) {
                    // En caso de error, loguear el error pero no detener el servicio
                    logError("Error al reenviar mensaje", error);
                }
            }
        }
    } catch (error) {
        logError("Error en el manejo de mensaje", error);
    }
}

// Mostrar grupos disponibles para mencion
async function sentMensaggesAdminGrupRegister(chat) {
    try {
        if (Object.keys(gruposRegistrados).length === 0) {
            await chat.sendMessage("🤖 No hay grupos registrados.");
            return;
        }

        let respuesta = "📋 *Lista de Grupos Registrados:*\n\n";
        for (const nombre in gruposRegistrados) {
            respuesta += `• *${nombre}*\n  ID: \`${gruposRegistrados[nombre]}\`\n\n`;
        }

        await chat.sendMessage(respuesta);
    } catch (error) {
        logError("Mostrar grupos", error);
    }
}

//Mensaje de consulta de grupos 
async function sentMensaggesAdminGrup(chat) {
    try{
        const chats = await client.getChats();
        const grupos = chats.filter(c => c.isGroup);
        if (grupos.length === 0) {
            await chat.sendMessage("🤖 No estoy en ningún otro grupo.");
            return;
        }
        let respuesta = "📋 *Lista de Grupos Registrados:*\n\n";
        for (const grupo of grupos) {
            respuesta += `• *${grupo.name}*\n  ID: \`${grupo.id._serialized}\`\n\n`;
        }
        await chat.sendMessage(respuesta);
    } catch (error){
        console.error("❌ Error al procesar mensaje de admin bot:", error); 
    }
}

// Registrar nuevo grupo
async function registerMensaggesAdminGrup(chat, msg) {
    try {
        const nombreMatch = msg.body.match(/nombre:\s*(\S+)/i);
        const idMatch = msg.body.match(/grupoId:\s*([a-zA-Z0-9@.\-_]+)/i);

        if (nombreMatch && idMatch) {
            const nombre = nombreMatch[1].toLowerCase();
            const grupoId = idMatch[1];

            try {
                const grupo = await client.getChatById(grupoId);
                const nombreGrupoReal = grupo.name.toLowerCase();

                if (nombreGrupoReal === nombre) {
                    await chat.sendMessage(`⚠️ El nombre proporcionado *${nombre}* coincide con el nombre real del grupo *${nombreGrupoReal}*.`);
                    return;
                }

                guardarGrupoLocal(nombre, grupoId);
                gruposRegistrados[nombre] = grupoId;

                await chat.sendMessage(`✅ Grupo registrado:\n📛 Nombre: *${nombre}*\n🆔 ID: \`${grupoId}\``);
            } catch (error) {
                logError("Registrar grupo", error);
                await chat.sendMessage("❌ No se pudo encontrar el grupo con ese ID.");
            }
        } else {
            await chat.sendMessage("❗Formato incorrecto. Usa:\n`registrar grupo nombre: grupo1 grupoId: iddelgrupo`");
        }
    } catch (error) {
        logError("Registrar grupo externo", error);
    }
}

// Eliminar grupo por nombre
async function deleteGrup(chat, msg) {
    try {
        const nombreMatch = msg.body.match(/nombre:\s*(\S+)/i);

        if (!nombreMatch || !nombreMatch[1]) {
            await chat.sendMessage("❗Formato incorrecto. Usa:\n`Delete nombre: nombredelgrupo`");
            return;
        }

        const nombre = nombreMatch[1].toLowerCase();
        const eliminado = eliminarGrupoPorNombre(nombre);

        if (eliminado) {
            delete gruposRegistrados[nombre];
            await chat.sendMessage(`✅ Grupo eliminado:\n📛 Nombre: *${nombre}*`);
        } else {
            await chat.sendMessage(`⚠️ No se encontró el grupo con nombre: *${nombre}*`);
        }

    } catch (error) {
        logError("Eliminar grupo", error);
        await chat.sendMessage("❌ Error al eliminar el grupo.");
    }
}

// Escuchar comandos en Telegram
telegramBot.onText(/\/logout/, async (msg) => {
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

    try {
        await client.logout();
        telegramBot.sendMessage(msg.chat.id, '📴 Sesión de WhatsApp cerrada.');
    } catch (err) {
        telegramBot.sendMessage(msg.chat.id, '❌ Error al cerrar sesión.');
        logError("Telegram Logout", err);
    }
});

telegramBot.onText(/\/restart/, async (msg) => {
    console.error(hour(), "Reiniciando...");
    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
    exec(COMANDO, (err, stdout, stderr) => {
        if (err) {
          console.error('❌ Error reiniciando el bot:', err);
          return;
        }
        telegramBot.sendMessage(msg.chat.id, '✅ Bot reiniciado con PM2');
        console.log('✅ Bot reiniciado con PM2');
    });
});

// API en Express
app.listen(3000, () => console.log(hour(), '🚀 API corriendo en http://localhost:3000'));

// Captura errores no manejados en promesas
process.on('unhandledRejection', (reason, promise) => {
    console.error(hour(), '🟥 OJO ===== Unhandled Rejection:', reason);
});

// Captura errores no atrapados en general
process.on('uncaughtException', (err) => {
    console.error(hour(), '🟥 OJO ===== Uncaught Exception:', err);
});

client.initialize();


 