const fs = require('fs');
const scriptContent = fs.readFileSync('script.js', 'utf8');

const originalCalculateMSNR = `
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}
`;

const newCalculateMSNR = `
function calculateMSNR(data,currentPrice){
  const period = Math.min(data.length, 20);
  let rH = -Infinity;
  let rL = Infinity;
  for (let i = data.length - period; i < data.length; i++) {
    if (data[i].h > rH) rH = data[i].h;
    if (data[i].l < rL) rL = data[i].l;
  }
  const rC = data[data.length - 1].c;

  const pp=(rH+rL+rC)/3;
  const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);
  const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);
  const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;
  const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);
  const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);
  return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};
}
`;

eval(originalCalculateMSNR.replace('calculateMSNR', 'oldMSNR'));
eval(newCalculateMSNR.replace('calculateMSNR', 'newMSNR'));

const dummyData = Array.from({length: 1000}, (_, i) => ({h: 100+Math.random()*10, l: 90+Math.random()*10, c: 95+Math.random()*10}));

const iters = 10000;

console.time('old');
for(let i=0; i<iters; i++) {
  oldMSNR(dummyData, 100);
}
console.timeEnd('old');

console.time('new');
for(let i=0; i<iters; i++) {
  newMSNR(dummyData, 100);
}
console.timeEnd('new');
