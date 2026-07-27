import { base64Decode, base64DoubleDecode } from '../src/utils/crypto';

const keys = [
  'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==',
  'WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==',
];

for (const b64 of keys) {
  console.log(`Key: ${b64}`);
  // Step 1: base64 decode
  const pass1 = Buffer.from(b64, 'base64');
  console.log(`  Pass1 bytes (len=${pass1.length}): ${pass1.toString('hex')}`);
  
  // Step 2: interpret as UTF-8 string
  const str = pass1.toString('utf-8');
  console.log(`  UTF8 string: "${str}" (len=${str.length})`);
  
  // Check if the resulting string is valid base64
  try {
    const pass2 = Buffer.from(str, 'base64');
    console.log(`  Pass2 bytes (len=${pass2.length}): ${pass2.toString('hex')}`);
    // Double-check: re-encode pass2 and compare
    const reEncoded = pass2.toString('base64');
    console.log(`  Pass2 re-base64: ${reEncoded}`);
  } catch (e: any) {
    console.log(`  Pass2 ERROR: ${e.message}`);
  }

  // Also try: just single decode (raw base64→bytes→HMAC key directly)
  const singleDecode = Buffer.from(b64, 'base64');
  console.log(`  Single decode (len=${singleDecode.length}): ${singleDecode.toString('hex')}`);
  
  console.log('');
}
