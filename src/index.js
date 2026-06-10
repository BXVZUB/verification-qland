const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios  = require('axios');
const config = require('../config');
const db     = require('./database');
const { startServer, setDiscordClient } = require('./oauth');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

async function deployCommands() {
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
      .setDescription('Affiche la liste des membres vérifiés')
      .setDefaultMemberPermissions(8),
    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Affiche le lien de vérification')
      .setDefaultMemberPermissions(8),
    new SlashCommandBuilder()
      .setName('show')
      .setDescription('Affiche les infos d\'un membre par son ID')
      .addStringOption(opt =>
        opt.setName('id')
          .setDescription('ID Discord du membre')
          .setRequired(true)
      )
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

async function addMemberToGuilds(userId, accessToken) {
  let success = 0, failed = 0;
  for (const guildId of config.GUILD_IDS) {
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;

  // /setup
  if (commandName === 'setup') {
    const channel = config.VERIFY_CHANNEL_ID
      ? guild.channels.cache.get(config.VERIFY_CHANNEL_ID)
      : guild.channels.cache.find(c => c.name === 'vérification' || c.name === 'verification');

    if (!channel)
      return interaction.reply({ content: '❌ Channel introuvable.', ephemeral: true });

    if (!channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages))
      return interaction.reply({ content: `❌ Je ne peux pas écrire dans <#${channel.id}>.`, ephemeral: true });

    await sendVerifyMessage(channel);
    return interaction.reply({ content: `✅ Message envoyé dans <#${channel.id}> !`, ephemeral: true });
  }

  // /tokens
  if (commandName === 'tokens') {
    const tokens = await db.getAllTokens();

    if (!tokens.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('📊 Membres vérifiés').setDescription('Aucun membre vérifié en base.').setTimestamp()],
        ephemeral: true
      });
    }

    const pageSize = 20;
    const pages = [];
    for (let i = 0; i < tokens.length; i += pageSize) {
      const chunk = tokens.slice(i, i + pageSize);
      const lines = chunk.map((t, idx) => `\`${i + idx + 1}.\` **${t.username}** — \`${t.user_id}\``).join('\n');
      pages.push(lines);
    }

    let currentPage = 0;

    const getEmbed = (page) => new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 Membres vérifiés — ${tokens.length} total`)
      .setDescription(pages[page])
      .setFooter({ text: `Page ${page + 1}/${pages.length}` })
      .setTimestamp();

    const getRow = (page) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('next').setLabel('Suivant ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1)
    );

    const msg = await interaction.reply({
      embeds: [getEmbed(0)],
      components: pages.length > 1 ? [getRow(0)] : [],
      ephemeral: true,
      fetchReply: true
    });

    if (pages.length <= 1) return;

    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async (btn) => {
      if (btn.user.id !== interaction.user.id) return btn.deferUpdate();
      if (btn.customId === 'prev') currentPage--;
      if (btn.customId === 'next') currentPage++;
      await btn.update({ embeds: [getEmbed(currentPage)], components: [getRow(currentPage)] });
    });
    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
    return;
  }

  // /link
  if (commandName === 'link') {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔗 Lien de vérification').setDescription(`${config.BASE_URL}`).setTimestamp()],
      ephemeral: true
    });
  }

  // /show
  if (commandName === 'show') {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.options.getString('id');

    const token = await db.getToken(userId);
    const guildsInfo = [];

    for (const guildId of config.GUILD_IDS) {
      const g = client.guilds.cache.get(guildId);
      if (!g) continue;
      try {
        const member = await g.members.fetch(userId);
        const roles = member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => r.name)
          .join(', ') || 'Aucun';
        guildsInfo.push(`**${g.name}**\n> Rejoint : <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n> Rôles : ${roles}`);
      } catch {
        guildsInfo.push(`**${g.name}**\n> ❌ Pas membre`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(token ? 0x5865F2 : 0xed4245)
      .setTitle(`🔍 Infos membre`)
      .addFields(
        { name: '🆔 User ID',      value: `\`${userId}\``,                                          inline: false },
        { name: '👤 Pseudo en base', value: token ? `\`${token.username}\`` : '❌ Pas en base',     inline: true  },
        { name: '🔑 Token',         value: token ? '✅ Présent' : '❌ Absent',                       inline: true  },
        { name: '🏠 Serveurs',      value: guildsInfo.join('\n\n') || 'Aucun serveur trouvé',        inline: false }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
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
          { name: '❌ Échecs', value: `${totalFailed}`,  inline: true },
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
  await deployCommands();
});

startServer();
client.login(config.DISCORD_TOKEN);