// consulta y registro de grupos

const db = require('./firebase');

async function obtenerRedireccionGrupos() {
  try{
    console.log("firebase :)")
    const snapshot = await db.collection('gruposBot').get();
    const redireccionGrupos = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      redireccionGrupos[data.nombre.toLowerCase()] = data.grupoId;
    });

    return redireccionGrupos;
  } catch (error){
    console.log("firebase a fallado al listar :(")
  }
}

async function guardarRedireccionGrupos(nombre,grupoId) {
  try{
    await db.collection('gruposBot').add({
      nombre: nombre,
      grupoId: grupoId
    });
  } catch(error){
    console.log("firebase a fallado al guardar :(")
  }

}

module.exports = { obtenerRedireccionGrupos, guardarRedireccionGrupos };
