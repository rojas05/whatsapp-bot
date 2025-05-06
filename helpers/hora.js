

function hour() {
    const opciones = {
        timeZone: 'America/Bogota',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };

    const horaColombia = new Intl.DateTimeFormat('es-CO', opciones).format(new Date());
    return horaColombia;
}

module.exports = {
    hour
};