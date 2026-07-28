const fs = require('fs');
let c = fs.readFileSync('script.js', 'utf8');

c = c.replace(`            if(dailyDir === dirStr) htfMatch++;
            if(h4Dir === dirStr) htfMatch++;
            if(h1Dir === dirStr) htfMatch++;`,
`            if(dailyDir === dirStr) htfMatch++;
            if(h4Dir === dirStr) htfMatch++;
            if(h1Dir === dirStr) htfMatch++;

            if (htfMatch === 0) {
                console.log(\`  ❌ \${dir}: Contradicts HTF biases entirely\`);
                continue;
            }`);

fs.writeFileSync('script.js', c);
