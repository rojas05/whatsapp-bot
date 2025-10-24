const { db } = require('../firebase');

function startCobroListener(sock) {
  const collectionRef = db.collection("cobroGrupo18");

  console.log("👂 Escuchando Firestore: cobroGrupo18 (envío secuencial cada 1 minuto)");

  // Cola de mensajes pendientes
  const messageQueue = [];
  let isProcessing = false;

  // Escucha cambios en la colección
  collectionRef.onSnapshot((snapshot) => {
    const newDocs = snapshot.docChanges().filter((c) => c.type === "added");

    for (const change of newDocs) {
      const data = change.doc.data();
      const ref = change.doc.ref;

      if (!data.cliente || !Array.isArray(data.numeros) || data.numeros.length === 0) {
        console.log("⚠️ Documento incompleto, ignorado:", data);
        continue;
      }

      // Agregamos a la cola
      messageQueue.push({ data, ref });
      console.log(`🆕 Agregado a la cola: ${data.cliente} (${data.numeros.join(", ")})`);
    }

    // Si no se está procesando, empezamos
    if (!isProcessing && messageQueue.length > 0) {
      processQueue(sock, messageQueue);
    }
  });
}

async function processQueue(sock, queue) {
  isProcessing = true;

  while (queue.length > 0) {
    const { data, ref } = queue.shift();
    const cliente = data.cliente;
    const numeros = data.numeros || [];
    const loteria = data.loteria || "lotería de hoy";

    const phoneNumber = normalizarTelefonoColombia(cliente);
    const jid = `${phoneNumber}@s.whatsapp.net`;
    const mensaje = `Hola 😊, te escribo de Dinámicas J&C para confirmar el pago de los números: ${numeros.join(", ")} del sorteo con la ${loteria}.\nRecuerda enviar el comprobante de pago al grupo.📸\n\n¡Gracias por participar! 🙌✨`;

    try {
      console.log(`🕒 Enviando mensaje a ${jid}...`);
      await sock.sendMessage(jid, { text: mensaje });
      console.log(`✅ Enviado correctamente a ${jid}`);
      await ref.delete();
      console.log(`🗑️ Documento eliminado de Firestore.`);
    } catch (err) {
      console.error(`❌ Error enviando a ${jid}: ${err.message}`);
    }

    // Esperar 1 minuto antes del siguiente
    await delay(30000);
  }

  isProcessing = false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarTelefonoColombia(numero) {
  let n = numero.toString().replace(/\D/g, "");
  if (!n.startsWith("57")) {
    n = "57" + n;
  }
  return n;
}

module.exports = { startCobroListener };

