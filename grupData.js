const COUNTRY_CODE = '57'; // ej '57' opcional

function normalizeJidToPhone(jid) {
  if (!jid) return null;
  // si recibe objeto accidentalmente, normalizamos
  if (typeof jid !== 'string') {
    jid = String(jid);
  }

  // tomar lo que viene antes de @ (si existe)
  const atIndex = jid.indexOf('@');
  let numeric = atIndex === -1 ? jid : jid.slice(0, atIndex);

  // eliminar cualquier caracter no numérico
  numeric = numeric.replace(/\D+/g, '');

  // si definiste COUNTRY_CODE y el número comienza con él, lo eliminamos
  if (COUNTRY_CODE && numeric.startsWith(COUNTRY_CODE)) {
    numeric = numeric.slice(COUNTRY_CODE.length);
  }

  // eliminar ceros a la izquierda (opcional)
  numeric = numeric.replace(/^0+/, '');

  // si queda vacío -> null
  if (!numeric) return null;

  return numeric;
}

/**
 * Busca en la metadata del grupo un participante a partir de su lid o id
 * y devuelve su JID completo (ej: 573001112233@s.whatsapp.net).
 *
 * @param {object} sock - instancia de Baileys
 * @param {string} groupId - id del grupo (ej: "12345-67890@g.us")
 * @param {string} participantId - lid o id del participante (ej: "164424384024634@lid")
 * @returns {Promise<string|null>} - el jid normalizado o null si no se encuentra
 */
async function getJidFromGroup(sock, groupId, participantId) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        if (!metadata || !metadata.participants) return null;

        const participant = metadata.participants.find(p => {
            const pid = typeof p.id === 'string' ? p.id : p.id?._serialized;
            return (
                pid === participantId ||
                p.jid === participantId ||
                p.lid === participantId ||
                (pid && participantId && pid.includes(participantId)) ||
                (p.jid && participantId && p.jid.includes(participantId)) ||
                (p.lid && participantId && p.lid.includes(participantId))
            );
        });

        if (!participant) return null;

        console.log(participant)

        // normalizar para devolver el JID correcto
        if (participant.jid && participant.jid.includes('@s.whatsapp.net')) {
            return participant.jid;
        }
        if (typeof participant.id === 'string' && participant.id.includes('@s.whatsapp.net')) {
            return participant.id;
        }
        if (participant.id?._serialized && participant.id._serialized.includes('@s.whatsapp.net')) {
            return participant.id._serialized;
        }

        return null;
    } catch (err) {
        console.error("Error buscando JID en grupo:", err);
        return null;
    }
}

/**
 * Obtiene el nombre visible (display name) de un participante en un grupo.
 *
 * @param {object} sock - instancia de Baileys
 * @param {string} groupId - ID del grupo (ej: "12345-67890@g.us")
 * @param {string} participantId - JID o LID del participante
 * @returns {Promise<string>} - el nombre visible o null si no se encuentra
 */
async function getDisplayNameFromGroup(sock, groupId, participantId) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        if (!metadata?.participants) return "";

        const participant = metadata.participants.find(p => {
            const pid = typeof p.id === 'string' ? p.id : p.id?._serialized;
            return (
                pid === participantId ||
                (pid && participantId && pid.includes(participantId))
            );
        });

        if (!participant) return "";

        // 🔹 Buscar en propiedades comunes
        const displayName =
            participant.name ||
            participant.notifyName ||
            participant?.id?.user || // como fallback: el número
            "";

        // Si aún no hay nombre, intentar con el store de contactos de Baileys
        if (!displayName) {
            const contact = await sock.onWhatsApp(participantId);
            if (contact?.[0]?.notifyName) return contact[0].notifyName;
        }

        return displayName;
    } catch (err) {
        console.error("Error obteniendo nombre de participante:", err);
        return "";
    }
}



module.exports = { normalizeJidToPhone, getJidFromGroup, getDisplayNameFromGroup };