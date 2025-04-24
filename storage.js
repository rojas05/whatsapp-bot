const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(cors());

const GRUPOS_FILE = process.env.STORAGE;

// Guardar un nuevo grupo
function guardarGrupoLocal(nombre, grupoId) {
    let grupos = {};

    if (fs.existsSync(GRUPOS_FILE)) {
        const data = fs.readFileSync(GRUPOS_FILE, 'utf-8');
        grupos = JSON.parse(data);
    }

    // Guardar o actualizar el grupo
    grupos[nombre] = grupoId;

    fs.writeFileSync(GRUPOS_FILE, JSON.stringify(grupos, null, 2), 'utf-8');
}

// Leer datos de grupos
function obtenerGruposLocales() {
    if (fs.existsSync(GRUPOS_FILE)) {
        const data = fs.readFileSync(GRUPOS_FILE, 'utf-8');
        return JSON.parse(data);
    }
    return {};
}

function eliminarGrupoPorNombre(nombre) {
    try {
        if (!fs.existsSync(GRUPOS_FILE)) return false;

        const data = fs.readFileSync(GRUPOS_FILE, 'utf-8');
        const grupos = JSON.parse(data);

        if (!grupos[nombre]) {
            return false; // El grupo no existe
        }

        delete grupos[nombre];

        fs.writeFileSync(GRUPOS_FILE, JSON.stringify(grupos, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error("❌ Error al eliminar grupo:", error);
        return false;
    }
}

module.exports = {
    guardarGrupoLocal,
    obtenerGruposLocales,
    eliminarGrupoPorNombre
};
