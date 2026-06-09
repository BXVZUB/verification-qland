const express = require('express');
const axios   = require('axios');
const db      = require('./database');
const config  = require('../config');

const app = express();
let discordClient = null;

function setDiscordClient(client) {
  discordClient = client;
}

const REDIRECT_URI = `${config.BASE_URL}/callback`;

// Donner le rôle vérifié sur tous les serveurs
async function giveVerifiedRole(userId) {
  for (const guildId of config.GUILD_IDS) {
    try {
      const guild = discordClient.guilds.cache.get(guildId);
      if (!guild) continue;

      let role = guild.roles.cache.find(r => r.name === config.VERIFIED_ROLE_NAME);
      if (!role) {
        role = await guild.roles.create({
          name: config.VERIFIED_ROLE_NAME,
          color: 0x5865F2,
          reason: 'Créé automatiquement par le bot de vérification'
        });
        console.log(`✅ Rôle "${role.name}" créé dans ${guild.name}`);
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && !member.roles.cache.has(role.id)) {
        await member.roles.add(role);
        console.log(`🎉 Rôle donné à ${member.user.tag} dans ${guild.name}`);
      }
    } catch (err) {
      console.error(`Erreur rôle guild ${guildId}:`, err.message);
    }
  }
}

// Redirige vers OAuth2 Discord
app.get('/', (req, res) => {
  const url = `https://discord.com/oauth2/authorize`
    + `?client_id=${config.CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&response_type=code`
    + `&scope=identify%20guilds.join`;
  res.redirect(url);
});

// Callback OAuth2
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Code manquant.');

  try {
    // Échange code → token
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Infos utilisateur
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { id, username, discriminator } = userRes.data;
    const tag = discriminator === '0' ? username : `${username}#${discriminator}`;

    // Sauvegarde token
    await db.saveToken(id, tag, access_token, refresh_token, expires_in);
    console.log(`✅ Token sauvegardé : ${tag} (${id})`);

    // Ajouter au serveur sur tous les guilds
    for (const guildId of config.GUILD_IDS) {
      try {
        await axios.put(
          `https://discord.com/api/guilds/${guildId}/members/${id}`,
          { access_token },
          { headers: { Authorization: `Bot ${config.DISCORD_TOKEN}`, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        if (e.response?.status !== 204) console.error(`guilds.join error ${guildId}:`, e.response?.data);
      }
    }

    // Donner le rôle sur tous les guilds
    if (discordClient) await giveVerifiedRole(id);

    res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Vérification réussie</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#36393f;font-family:'Whitney','Helvetica Neue',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
      .card{background:#2f3136;border-radius:8px;padding:40px;text-align:center;max-width:400px;width:90%;box-shadow:0 8px 16px rgba(0,0,0,.4)}
      .icon{font-size:52px;margin-bottom:16px}
      h1{color:#3ba55d;font-size:22px;margin-bottom:10px}
      p{color:#b9bbbe;font-size:14px;line-height:1.6}
      strong{color:#fff}
    </style></head>
    <body><div class="card">
      <div class="icon">✅</div>
      <h1>Vérification réussie !</h1>
      <p>Bienvenue <strong>${tag}</strong> !<br>Tu as maintenant accès au serveur.<br>Tu peux fermer cette page.</p>
    </div></body></html>`);

  } catch (err) {
    console.error('Erreur OAuth2:', err.response?.data || err.message);
    res.status(500).send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Erreur</title>
    <style>
      body{background:#36393f;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
      .card{background:#2f3136;border-radius:8px;padding:40px;text-align:center}
      h1{color:#ed4245} p{color:#b9bbbe;margin-top:10px;font-size:14px}
    </style></head>
    <body><div class="card"><h1>❌ Erreur</h1><p>Une erreur est survenue, réessaie.</p></div></body></html>`);
  }
});

function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌐 Serveur OAuth2 sur le port ${PORT}`);
    console.log(`🔗 URL publique : ${config.BASE_URL}`);
  });
}

module.exports = { startServer, setDiscordClient };