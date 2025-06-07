// netlify/functions/discord.js
const fetch = require('node-fetch');
const nacl  = require('tweetnacl');


// Load required credentials from environment variables
const PUBLIC_KEY  = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN   = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID   = process.env.DISCORD_CLIENT_ID;
const GUILD_ID    = process.env.DISCORD_GUILD_ID;  // optional

// Predefined slash command definition
const COMMANDS = [ /* as defined above */ ];

let commandsRegistered = false;

exports.handler = async (event) => {
  // Register slash commands on cold start
  if (!commandsRegistered) {
    await registerCommands();
    commandsRegistered = true;
  }

  // Verify request signature
  const signature = event.headers['x-signature-ed25519'] || event.headers['X-Signature-Ed25519'];
  const timestamp = event.headers['x-signature-timestamp'] || event.headers['X-Signature-Timestamp'];
  const rawBody = event.body || '';
  if (!signature || !timestamp || !verifySignature(rawBody, signature, timestamp, PUBLIC_KEY)) {
    return { statusCode: 401, body: 'Invalid request signature' };
  }

  // Parse the interaction payload
  const payload = JSON.parse(rawBody);

  // Handle PING (type 1) from Discord (respond with Pong)
  if (payload.type === 1) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 1 })
    };
  }

  // Handle slash commands (type 2)
  if (payload.type === 2 && payload.data.name === 'crypto') {
    try {
      const sub = payload.data.options.find(o => o.name === 'price');
      const coin = sub.options.find(o => o.name === 'coin').value;
      const currency = sub.options.find(o => o.name === 'currency').value;

      // Fetch price from CoinGecko API
      const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${currency}`;
      const apiRes = await fetch(apiUrl);
      if (!apiRes.ok) throw new Error('CoinGecko API error');
      const priceData = await apiRes.json();
      const price = priceData[coin] && priceData[coin][currency];
      if (price === undefined) throw new Error('Price not found');

      // Format the response message
      const coinNames = {
        bitcoin: 'Bitcoin', ethereum: 'Ethereum', cardano: 'Cardano',
        dogecoin: 'Dogecoin', solana: 'Solana', polkadot: 'Polkadot',
        litecoin: 'Litecoin', ripple: 'XRP (Ripple)', binancecoin: 'BNB'
      };
      const coinLabel = coinNames[coin] || coin;
      const priceFormatted = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: currency.toUpperCase()
      }).format(price);
      const content = `💰 **${coinLabel}** price in **${currency.toUpperCase()}** is ${priceFormatted}`;

      // Send response (type 4 = channel message)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4,
          data: { content }
        })
      };
    } catch (error) {
      console.error('Command handling error:', error);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4,
          data: {
            content: '⚠️ Could not fetch price. Please try again later.',
            flags: 64
          }
        })
      };
    }
  }

  // Unknown interaction type (shouldn't happen)
  return { statusCode: 400, body: 'Unknown interaction type' };
};

// Helper: Verify Discord ED25519 signature
function verifySignature(body, signature, timestamp, publicKey) {
  const msg = Buffer.from(timestamp + body);
  const sig = Buffer.from(signature, 'hex');
  const key = Buffer.from(publicKey, 'hex');
  return nacl.sign.detached.verify(msg, sig, key);
}

// Registers (or updates) slash commands via Discord API
async function registerCommands() {
  const urlBase = `https://discord.com/api/v10/applications/${CLIENT_ID}`;
  const url = GUILD_ID
    ? `${urlBase}/guilds/${GUILD_ID}/commands`
    : `${urlBase}/commands`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(COMMANDS)
  });
  if (!res.ok) {
    console.error('Failed to register commands:', await res.text());
  }
} 