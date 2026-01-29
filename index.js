const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

const __path = process.cwd();

// pair.js file එක import කිරීම
let code = require('./pair'); 

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Pair logic route එක
app.use('/code', code);

// Home page එක විතරක් (main.html)
app.use('/', async (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});

module.exports = app;
