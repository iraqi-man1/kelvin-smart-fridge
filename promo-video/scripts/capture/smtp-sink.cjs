// A local SMTP "inbox" for filming: accepts any login and saves each message to mail/NNN.eml.
// Nothing leaves this computer.
const net = require('net'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'mail'); let n = 0;
net.createServer(sock => {
  let data = false, buf = '', msg = '', authStep = 0;
  const say = s => sock.write(s + '\r\n');
  say('220 kelvin-sink ESMTP');
  sock.on('data', chunk => {
    buf += chunk.toString('latin1');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; const f = path.join(dir, String(++n).padStart(3, '0') + '.eml'); fs.writeFileSync(f, msg); msg = ''; say('250 OK saved'); }
        else msg += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        continue;
      }
      if (authStep) { authStep = authStep === 1 ? (say('334 UGFzc3dvcmQ6'), 2) : (say('235 OK'), 0); continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { say('250-kelvin-sink'); say('250-AUTH PLAIN LOGIN'); say('250 8BITMIME'); }
      else if (cmd === 'HELO') say('250 kelvin-sink');
      else if (cmd === 'AUTH') { if (/LOGIN/i.test(line) && !line.split(' ')[2]) { authStep = 1; say('334 VXNlcm5hbWU6'); } else say('235 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 OK');
    }
  });
  sock.on('error', () => {});
}).listen(2525, '127.0.0.1', () => console.log('smtp sink on 2525'));
