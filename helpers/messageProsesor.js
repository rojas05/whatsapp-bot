const path = require('path');
const fs = require('fs');

const { guardarPedidoFirestore } = require('../firebase');
const SPECIAL_STICKER_HASH = process.env.SPECIAL_STICKER_HASH || null;
const NEGATIVE_KEYWORDS = ['no disponible'];
const pedidosFile = path.join(process.cwd(), 'pedidos.json');
const POSITIVE_KEYWORDS = ['suyo','suyos'];


// Extrae tokens numéricos con índices
function extractNumbersWithIndexes(text) {
  const re = /\d+/g;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ str: m[0], index: m.index, len: m[0].length });
  }
  return results;
}

// splitTokenIfNeeded (3473 -> ['34','73']) según regla: par, 4-6 dígitos
function splitTokenIfNeeded(numStr) {
  const len = numStr.length;
  if (len >= 4 && len <= 6 && len % 2 === 0) {
    const out = [];
    for (let i = 0; i < len; i += 2) out.push(numStr.slice(i, i + 2));
    return out;
  }
  return [numStr];
}

// expandNumberTokens acepta objetos {str,...} o strings
function expandNumberTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    const s = typeof t === 'string' ? t : t.str;
    const pieces = splitTokenIfNeeded(s);
    for (const p of pieces) out.push(p);
  }
  return out;
}

function keywordNear(textLower, index, len) {
  const WINDOW = 30; // ventana de 30 caracteres alrededor
  const start = Math.max(0, index - WINDOW);
  const end = Math.min(textLower.length, index + len + WINDOW);
  const window = textLower.slice(start, end);

  for (const pk of POSITIVE_KEYWORDS) {
    if (window.includes(pk)) return 'positive';
  }
  for (const nk of NEGATIVE_KEYWORDS) {
    if (window.includes(nk)) return 'negative';
  }
  return null;
}

function decideNumbersToSave(originalText, replyText) {
  const originalObjs = extractNumbersWithIndexes(originalText);
  const originalNums = originalObjs.map(o => o.str);
  const replyLower = (replyText || '').toLowerCase();

  // 🟢 Caso 1: El reply NO tiene números, pero contiene palabras positivas ("suyo", "suyos", etc.)
  if (!/\d+/.test(replyText || '') && POSITIVE_KEYWORDS.some(k => replyLower.includes(k))) {
    return Array.from(new Set(originalNums));
  }

  // 🟡 Caso 2: El reply tiene números → procesar solo si el texto contiene palabras clave positivas
  const replyObjs = extractNumbersWithIndexes(replyText || '');
  if (replyObjs.length > 0) {
    // ✅ Si el texto NO tiene ninguna palabra positiva, no guardamos nada
    if (!POSITIVE_KEYWORDS.some(k => replyLower.includes(k))) {
      console.log('⚠️ Reply contiene números pero no palabra clave positiva. No se guardan.');
      return [];
    }

    const toSave = [];
    for (const rn of replyObjs) {
      const kind = keywordNear(replyLower, rn.index, rn.len);
      if (kind === 'positive') {
        toSave.push(rn.str);
      } else if (kind === 'negative') {
        // no guardar
      } else {
        // 🧩 En esta versión NO asumimos positivo por defecto
        // solo se guarda si existe alguna palabra positiva en el mensaje completo
        if (POSITIVE_KEYWORDS.some(k => replyLower.includes(k))) {
          toSave.push(rn.str);
        }
      }
    }

    return Array.from(new Set(toSave));
  }

  // ❌ Caso 3: No hay números ni palabra positiva → no guardar nada
  return [];
}


// Guardar pedido: append a pedidos.json (o usar tu helper si lo prefieres)

async function guardarPedido(cliente, numeros, tipo = 'suyo') {
  // intenta Firestore primero
  try {
    const id = await guardarPedidoFirestore(cliente, numeros, tipo);
    console.log(`✅ Pedido guardado en Firestore (id=${id}) cliente:${cliente} => ${JSON.stringify(numeros)}`);
    return { success: true, id };
  } catch (e) {
    console.warn('❌ Falló escribir en Firestore, guardando localmente:', e.message || e);
    appendLocalPedido({ cliente, pedido: numeros, respuesta: tipo, error: String(e) });
    return { success: false, error: e.message || e };
  }
}

function appendLocalPedido(obj) {
  const pedidosFile = path.join(process.cwd(), 'pedidos.json');
  let arr = [];
  try {
    if (fs.existsSync(pedidosFile)) arr = JSON.parse(fs.readFileSync(pedidosFile, 'utf8') || '[]');
  } catch (e) { arr = []; }
  arr.push({ ...obj, fecha: new Date().toISOString() });
  try { fs.writeFileSync(pedidosFile, JSON.stringify(arr, null, 2)); } catch (e) { console.error('Error escribiendo local pedidos.json', e); }
}

// extrae texto robustamente desde quotedMessage
function getQuotedText(q) {
  if (!q) return '';
  if (typeof q.conversation === 'string' && q.conversation.trim().length > 0) return q.conversation;
  if (q.extendedTextMessage?.text) return q.extendedTextMessage.text;
  if (q.imageMessage?.caption) return q.imageMessage.caption;
  if (q.videoMessage?.caption) return q.videoMessage.caption;
  if (q.documentMessage?.caption) return q.documentMessage.caption;
  if (q.audioMessage?.caption) return q.audioMessage.caption;
  if (q.message) {
    const inner = q.message;
    if (inner.conversation) return inner.conversation;
    if (inner.extendedTextMessage?.text) return inner.extendedTextMessage.text;
    if (inner.imageMessage?.caption) return inner.imageMessage.caption;
    if (inner.videoMessage?.caption) return inner.videoMessage.caption;
    if (inner.documentMessage?.caption) return inner.documentMessage.caption;
  }
  return '';
}

// isSpecialSticker util
function isSpecialSticker(message) {
  const sticker = message?.message?.stickerMessage;
  if (!sticker) return false;
  try {
    const buf = sticker.fileSha256 || sticker.fileSha256Value || sticker.sha256 || null;
    if (buf) {
      const hex = Buffer.from(buf).toString('hex');
      if (SPECIAL_STICKER_HASH) {
        return hex === SPECIAL_STICKER_HASH.toLowerCase();
      } else {
        return true;
      }
    }
    return !SPECIAL_STICKER_HASH;
  } catch (e) {
    return !SPECIAL_STICKER_HASH;
  }
}

module.exports = {
    guardarPedido,
    isSpecialSticker,
    getQuotedText,
    expandNumberTokens,
    decideNumbersToSave,
    extractNumbersWithIndexes,
    splitTokenIfNeeded
};