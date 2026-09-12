const pin = process.argv[2];
if (!pin) { console.error('Usage: node hash-pin.mjs <pin>'); process.exit(1); }

const encoder = new TextEncoder();
const data = encoder.encode(pin + 'pendrops-salt-2026');
const buf = await crypto.subtle.digest('SHA-256', data);
const hash = Array.from(new Uint8Array(buf))
  .map(b => b.toString(16).padStart(2, '0')).join('');
console.log(hash);