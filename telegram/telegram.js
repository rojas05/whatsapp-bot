require('dotenv').config();
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function enviarMensajeTelegram(mensaje) {
    console.log(TELEGRAM_CHAT_ID)
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  
      const response = await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        text: mensaje
      });
  
      console.log('✅ Mensaje enviado:');
    } catch (error) {
      console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
    }
  }

  
  
  module.exports = enviarMensajeTelegram;