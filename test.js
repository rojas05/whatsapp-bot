const enviarMensajeTelegram = require('./telegram');

function mensaje(state){
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
  exec('node -v', (err, stdout, stderr) => {
    if (err) {
      console.error('❌ Error reiniciando el bot:', err);
      return;
    }
    console.log('✅ Bot reiniciado con PM2');
  });
}
}

mensaje('CONFLICT');
