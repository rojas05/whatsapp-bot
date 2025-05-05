require('dotenv').config();
const FormData = require('form-data');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function enviarQRporTelegram(qrString) {
    try {
      const qrImagePath = './qr-code.png';
  
      // Generar imagen QR
      await QRCode.toFile(qrImagePath, qrString);
  
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', '🔐 Escanea este QR para reconectar el bot de WhatsApp');
      formData.append('photo', fs.createReadStream(qrImagePath));
  
      const response = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
        formData,
        {
          headers: formData.getHeaders(),
        }
      );
  
      console.log('✅ QR enviado a Telegram');
    } catch (err) {
      console.error('❌ Error enviando QR a Telegram:', err.response?.data || err.message);
    }
  }
  
  module.exports = enviarQRporTelegram;