const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('../config');

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

(async () => {
  try {
    console.log('🔄 Déploiement des commandes slash...');
    for (const guildId of config.GUILD_IDS) {
      await rest.put(
        Routes.applicationGuildCommands(config.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`✅ Commandes déployées sur ${guildId}`);
    }
  } catch (err) {
    console.error('Erreur:', err.message);
  }
})();