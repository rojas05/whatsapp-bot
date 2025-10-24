// firebase.js
const admin = require('firebase-admin');
const path = require('path');

// ruta al json de la service account (usa variable de entorno o path seguro)
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || path.join(__dirname, 'firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  });
}

const db = admin.firestore();
const pedidosCollection = db.collection('pedidos'); // coleccion principal

/**
 * guardarPedidoFirestore(cliente, numeros, tipo)
 * guarda un pedido en Firestore
 */
async function guardarPedidoFirestore(cliente, numeros, tipo = 'suyo') {
  const doc = {
    cliente: cliente || 'desconocido',
    pedido: Array.isArray(numeros) ? numeros : [numeros],
    tipo,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const res = await pedidosCollection.add(doc);
  return res.id;
}

/**
 * listenPedidosRealtime(callback)
 * callback(docData, docId, changeType)
 */
function listenPedidosRealtime(callback) {
  return pedidosCollection.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      const doc = change.doc;
      const data = doc.data();
      callback(data, doc.id, change.type); // change.type: 'added'|'modified'|'removed'
    });
  }, err => {
    console.error('Firestore listen error:', err);
  });
}

module.exports = { guardarPedidoFirestore, listenPedidosRealtime, db };
