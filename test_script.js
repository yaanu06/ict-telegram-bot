const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');
console.log(code.includes('function calcStopLoss(data, dir, entry, zone, msnr, tfUsed, twelveIndicators, currentPair) {'));
