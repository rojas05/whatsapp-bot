function delay(texto) {
    const caracteres = texto.length;
    const tiempo = Math.min(caracteres * velocidadLecturaMsPorCaracter, 5000); // máximo 5s
    return new Promise(resolve => setTimeout(resolve, tiempo));
}

module.exports = {
    delay
};