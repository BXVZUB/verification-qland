module.exports = {
  DISCORD_TOKEN:      process.env.DISCORD_TOKEN,
  CLIENT_ID:          process.env.CLIENT_ID,
  CLIENT_SECRET:      process.env.CLIENT_SECRET,
  GUILD_ID:           process.env.GUILD_ID,
  VERIFY_CHANNEL_ID:  process.env.VERIFY_CHANNEL_ID,
  VERIFIED_ROLE_NAME: process.env.VERIFIED_ROLE_NAME || 'Membre',
  BASE_URL:           process.env.BASE_URL,
};
