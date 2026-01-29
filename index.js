const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

// Path set කිරීම
const __path = process.cwd();

// Pair logic එක import කිරීම
let code = require('./pair'); 

// EventEmitter limit එක වැඩි කිරීම
require('events').EventEmitter.defaultMaxListeners = 500;

// Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/code', code);

app.use('/pair', async (req, res, next) => {
    res.sendFile(path.join(__path, 'pair.html'));
});

app.use('/', async (req, res, next) => {
    res.sendFile(path.join(__path, 'main.html'));
});

// Server එක start කිරීම
app.listen(PORT, () => {
    console.log(`
---------------------------------------
   SAYURA MINI BOT MD - SERVER STARTED
   Server running on port: ${PORT}
---------------------------------------
    `);
});

module.exports = app;
