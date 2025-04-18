// iniciando servicio de fire base
require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require(process.env.GOOGLE_CREDENTIALS_PATH);
console.log(process.env.GOOGLE_CREDENTIALS_PATH)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = db;
