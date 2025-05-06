const { hour } = require('./hora');

function logError(context, error) {
    console.error(`${hour()} ::: [${context}]`, error);
}

module.exports = {
    logError
};