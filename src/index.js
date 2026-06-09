const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const axios  = require('axios');
const config = require('../config');
const db     = require('./database');
const { startServer, setDiscordClient } = require('./oauth');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Refresh token expiré
async function refreshToken(record) {
  try {
    const res = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: record.refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, refresh_token, expires_in } = res.data;
    await db.updateAccessToken(record.user_id, access_token, refresh_token, expires_in);
    return access_token;
  } catch (err) {
    console.error(`❌ Refresh échoué pour ${record.username}:`, err.response?.data || err.message);
    return null;
  }
}

// Ajouter un membre sur tous les serveurs
async function addMemberToGuilds(userId, accessToken) {
  let success = 0, failed = 0;
  for (const guildId of config.GUILD_IDS) {
    try {
      await axios.put(
        `https://discord.com/api/guilds/${guildId}/members/${userId}`,
        { access_token: accessToken },
        { headers: { Authorization: `Bot ${config.DISCORD_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      success++;
    } catch (err) {
      if (err.response?.status === 204) { success++; continue; }
      console.error(`❌ Impossible d'ajouter ${userId} dans ${guildId}:`, err.response?.data || err.message);
      failed++;
    }
  }
  return { success, failed };
}

// Message de vérification avec bouton
async function sendVerifyMessage(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛡️ Vérification requise')
    .setDescription(
      'Bienvenue sur le serveur !\n\n' +
      'Pour accéder aux channels, clique sur le bouton ci-dessous.\n\n' +
      '> ✅ Cela nous permet de te ré-ajouter automatiquement si besoin.\n' +
      '> 🔒 Tes données restent privées.'
    )
    .setFooter({ text: 'Une seule vérification suffit.' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('✅ Se vérifier')
      .setStyle(ButtonStyle.Link)
      .setURL(config.BASE_URL)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// Commandes slash
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;

  // /setup
  if (commandName === 'setup') {
    const channel = config.VERIFY_CHANNEL_ID
      ? guild.channels.cache.get(config.VERIFY_CHANNEL_ID)
      : guild.channels.cache.find(c => c.name === 'vérification' || c.name === 'verification');

    if (!channel)
      return interaction.reply({ content: '❌ Channel introuvable. Vérifie `VERIFY_CHANNEL_ID`.', ephemeral: true });

    if (!channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages))
      return interaction.reply({ content: `❌ Je ne peux pas écrire dans <#${channel.id}>.`, ephemeral: true });

    await sendVerifyMessage(channel);
    return interaction.reply({ content: `✅ Message envoyé dans <#${channel.id}> !`, ephemeral: true });
  }

  // /tokens
  if (commandName === 'tokens') {
    const count = await db.countTokens();
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Membres vérifiés').setDescription(`**${count}** membre(s) ont autorisé le bot.`).setTimestamp()],
      ephemeral: true
    });
  }

  // /link
  if (commandName === 'link') {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔗 Lien de vérification').setDescription(`${config.BASE_URL}`).setTimestamp()],
      ephemeral: true
    });
  }

  // /readd
  if (commandName === 'readd') {
    await interaction.deferReply({ ephemeral: true });

    const tokens = await db.getAllTokens();
    if (!tokens.length)
      return interaction.editReply('❌ Aucun membre vérifié en base.');

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFAA61A).setTitle('⏳ Re-ajout en cours...').setDescription(`**${tokens.length}** membre(s) sur **${config.GUILD_IDS.length}** serveur(s)...`).setTimestamp()]
    });

    let totalSuccess = 0, totalFailed = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const record of tokens) {
      let accessToken = record.access_token;

      if (record.expires_at <= now) {
        accessToken = await refreshToken(record);
        if (!accessToken) { totalFailed++; continue; }
      }

      const { success, failed } = await addMemberToGuilds(record.user_id, accessToken);
      totalSuccess += success;
      totalFailed += failed;
      await new Promise(r => setTimeout(r, 300));
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(totalSuccess > 0 ? 0x3ba55d : 0xed4245)
        .setTitle('✅ Re-ajout terminé')
        .addFields(
          { name: '✅ Succès', value: `${totalSuccess}`, inline: true },
          { name: '❌ Échecs', value: `${totalFailed}`, inline: true },
          { name: '📊 Total',  value: `${tokens.length}`, inline: true }
        ).setTimestamp()]
    });
  }
});

client.once('ready', async () => {
  const count = await db.countTokens();
  console.log(`✅ Connecté : ${client.user.tag}`);
  console.log(`📦 ${count} membre(s) en base`);
  console.log(`🏠 Serveurs : ${config.GUILD_IDS.join(', ')}`);
  setDiscordClient(client);
});

startServer();
client.login(config.DISCORD_TOKEN);