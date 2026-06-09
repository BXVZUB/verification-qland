const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, REST, Routes } = require('discord.js');
const axios  = require('axios');
const config = require('../config');
const db     = require('./database');
const { startServer, setDiscordClient } = require('./oauth');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Deploy commands automatique au démarrage
async function deployCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Envoie le message de vérification dans #vérification')
      .setDefaultMemberPermissions(8),
    new SlashCommandBuilder()
      .setName('readd')
      .setDescription('Re-ajoute tous les membres vérifiés au serveur')
      .setDefaultMemberPermissions(8),
    new SlashCommandBuilder()
      .setName('tokens')
      .setDescription('Affiche le nombre de membres vérifiés')
      .setDefaultMemberPermissions(8),
    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Affiche le lien de vérification')
      .setDefaultMemberPermissions(8),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  for (const guildId of config.GUILD_IDS) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`✅ Commandes déployées sur ${guildId}`);
    } catch (err) {
      console.error(`❌ Erreur deploy ${guildId}:`, err.message);
    }
  }
}

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

// Ajouter un membre — seulement sur GUILD_ID_1, pas sur GUILD_ID_2
async function addMemberToGuilds(userId, accessToken) {
  let success = 0, failed = 0;
  for (const guildId of config.GUILD_IDS) {
    // Pas de join forcé sur le 2ème serveur
    if (guildId === config.GUILD_IDS[1]) continue;
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

// Donner le rôle sur tous les serveurs sans join forcé
async function giveVerifiedRole(userId) {
  for (const guildId of config.GUILD_IDS) {
    try {
      const guild = client.guilds.cache.get(guildId);
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
      embeds: [new EmbedBuilder().setColor(0xFAA61A).setTitle('⏳ Re-ajout en cours...').setDescription(`**${tokens.length}** membre(s)...`).setTimestamp()]
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
  // Deploy auto au démarrage
  await deployCommands();
});

startServer();
client.login(config.DISCORD_TOKEN);
