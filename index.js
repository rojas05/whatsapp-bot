const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const { obtenerRedireccionGrupos, guardarRedireccionGrupos } = require('./redireccion');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const SESSION_PATH = process.env.SESSION_PATH;

//Guardar credenciales de usuario
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

//generar qr para inicio de cesion
client.on('qr', (qr) => {
    console.log('📲 Escanea este código QR para conectar:');
    qrcode.generate(qr, { small: true });
});

//verificar la secion
client.on('ready', () => {
    console.log('✅ Bot de WhatsApp conectado y listo');
});

//Listener de mensaje enviado
client.on('message_create', async (msg) => {
    if (msg.fromMe) {
        await manejarMensajeAdminBot(msg);
    }
});

//Listener de mensaje resivido
client.on('message', async (msg) => {
    if (!msg.fromMe) {
        await manejarMensajeAdminBot(msg);
    }
});

//Funcion para manejar mensaje con mencion
async function manejarMensaje(msg) {
    try {
        const chat = await msg.getChat();

        if (chat.isGroup) {
            const nombreGrupo = chat.name.toLowerCase();

            const redireccionGrupos = await obtenerRedireccionGrupos();

            if (redireccionGrupos[nombreGrupo]) {
                const destinoId = redireccionGrupos[nombreGrupo];
                const grupoDestino = await client.getChatById(destinoId);
                const contenido = msg.body;

                let mentions = [];
                let text = contenido + '\n';

                for (let participant of grupoDestino.participants) {
                    mentions.push(participant.id._serialized);
                }

                await grupoDestino.sendMessage(text, { mentions });
                console.log(`✅ Reenviado de "${chat.name}" a ${destinoId}`);
            }
        }
    } catch (error) {
        console.error("❌ Error al reenviar mensaje:", error);
    }
}

//Mensajes para tegistro o consulta de grupos
async function manejarMensajeAdminBot(msg) {
    try {
        const chat = await msg.getChat();

        if (chat.isGroup && chat.name.toLowerCase() === 'adminbot') {
            if(msg.body.toLowerCase() === 'grupos'){
                sentMensaggesAdminGrup(chat)
            }
            if(msg.body.startsWith('Registrar grupo')){
                registerMensaggesAdminGrup(chat,msg)
            }
        } else{
            manejarMensaje(msg)
        }

    } catch (error) {
        console.error("❌ Error al procesar mensaje:", error);
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

//Mensaje para registrar un nuevo grupo
async function registerMensaggesAdminGrup(chat,msg) {
    try{
        const nombreMatch = msg.body.match(/nombre:\s*(\S+)/i);
        const idMatch = msg.body.match(/grupoId:\s*([a-zA-Z0-9@.\-_]+)/i);

        if (nombreMatch && idMatch) {
            const nombre = nombreMatch[1];
            const grupoId = idMatch[1];

            await guardarRedireccionGrupos(nombre,grupoId)

            await chat.sendMessage(`✅ Grupo registrado correctamente:\n📛 Nombre: *${nombre}*\n🆔 ID: \`${grupoId}\``);} 
        else {
            await chat.sendMessage("❗Formato incorrecto. Usa:\n`registrar grupo nombre: grupo1 grupoId: iddelgrupo`");
        }
    } catch (error){
        chat.sendMessage("❌ Error al procesar mensaje de admin bot para registro:", error); 
    }

}

app.listen(3000, () => console.log('🚀 API corriendo en http://localhost:3000'));

client.initialize();


