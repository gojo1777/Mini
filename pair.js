const express = require('express');
const router = express.Router();
const path = require('path');

// මෙතන තමයි ඔයාගේ pair code logic එක තියෙන්නේ. 
// මම මේක සරලව ලියලා තියෙන්නේ crash එක නැති වෙන්න.
router.get('/', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number required" });
    
    try {
        // ඔයාගේ බොට් එකේ Pair Code එක generate කරන කොටස මෙතනට එන්න ඕනේ.
        // දැනට test එකක් විදියට මේක දාන්න:
        res.json({ code: "SAYURA-MINI-TEST" }); 
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
