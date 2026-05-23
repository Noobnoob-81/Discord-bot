require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

// ─── DATA PERSISTENCE ────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

const warnings      = new Map();
const xp            = new Map();
const coins         = new Map();
const weapons       = new Map();
const staffSet      = new Set();
const autoResponses = new Map();

let welcomeConfig = {};
let logsConfig    = {};
let boss           = null;

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('📝 No data file found, creating new one');
            return;
        }
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw.warnings) for (const [k, v] of Object.entries(raw.warnings)) warnings.set(k, v);
        if (raw.xp) for (const [k, v] of Object.entries(raw.xp)) xp.set(k, v);
        if (raw.coins) for (const [k, v] of Object.entries(raw.coins)) coins.set(k, v);
        if (raw.weapons) for (const [k, v] of Object.entries(raw.weapons)) weapons.set(k, v);
        if (raw.staff) for (const id of raw.staff) staffSet.add(id);
        if (raw.autoResponses) for (const [k, v] of Object.entries(raw.autoResponses)) autoResponses.set(k, v);
        if (raw.welcomeConfig) welcomeConfig = raw.welcomeConfig;
        if (raw.logsConfig) logsConfig = raw.logsConfig;
        console.log('✅ Data loaded successfully');
    } catch (e) {
        console.error('❌ Load error:', e.message);
    }
}

function saveData() {
    try {
        const dataToSave = {
            warnings: Object.fromEntries(warnings),
            xp: Object.fromEntries(xp),
            coins: Object.fromEntries(coins),
            weapons: Object.fromEntries(weapons),
            staff: [...staffSet],
            autoResponses: Object.fromEntries(autoResponses),
            welcomeConfig,
            logsConfig
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
        console.error('❌ Save error:', e.message);
    }
}

loadData();
setInterval(saveData, 300000); // 5 min

// ─── SHOP + RARITY ─────────────────────────────────
const shop = [
    { name: 'Rusty Sword', damage: 25, price: 500, rarity: 'Common' },
    { name: 'Shadow Blade', damage: 80, price: 5000, rarity: 'Rare' },
    { name: 'Galaxy Hammer', damage: 150, price: 25000, rarity: 'Legendary' }
];

// ─── LEVEL SYSTEM ─────────────────────────────────
function xpForLevel(n) { 
    return 5 * n * n + 50 * n + 100; 
}

function getLevelInfo(totalXP) {
    let level = 0;
    let remaining = Math.max(0, totalXP || 0);
    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
    }
    return { level, xpInLevel: remaining, xpRequired: xpForLevel(level) };
}

// ─── COMMANDS ─────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('pong fr'),
    new SlashCommandBuilder().setName('help').setDescription('list all commands'),
    new SlashCommandBuilder().setName('bal').setDescription('check coins'),
    new SlashCommandBuilder().setName('rank').setDescription('check level'),
    new SlashCommandBuilder().setName('profile').setDescription('full profile'),
    new SlashCommandBuilder().setName('shop').setDescription('view shop'),
    new SlashCommandBuilder().setName('buy').setDescription('buy item').addStringOption(o => o.setName('item').setRequired(true).setDescription('Item name from shop')),
    new SlashCommandBuilder().setName('sell').setDescription('sell item').addStringOption(o => o.setName('item').setRequired(true).setDescription('Item to sell')),
    new SlashCommandBuilder().setName('bossfight').setDescription('fight boss'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('top players'),
    new SlashCommandBuilder().setName('wordle').setDescription('play wordle').addStringOption(o => o.setName('guess').setRequired(true).setMinLength(5).setMaxLength(5).setDescription('5 letter word')),
    new SlashCommandBuilder().setName('addxp').setDescription('add xp (staff only)').addUserOption(o => o.setName('user').setRequired(true)).addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('XP amount')),
    new SlashCommandBuilder().setName('addcoins').setDescription('add coins (staff only)').addUserOption(o => o.setName('user').setRequired(true)).addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Coin amount')),
    new SlashCommandBuilder().setName('ban').setDescription('ban user (admin only)').addUserOption(o => o.setName('user').setRequired(true).setDescription('User to ban')).addStringOption(o => o.setName('reason').setDescription('Ban reason')),
    new SlashCommandBuilder().setName('kick').setDescription('kick user (admin only)').addUserOption(o => o.setName('user').setRequired(true).setDescription('User to kick')).addStringOption(o => o.setName('reason').setDescription('Kick reason')),
].map(c => c.toJSON());

// ─── CLIENT ───────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

client.once('ready', async () => {
    try {
        console.log(`✅ Bot is running`);

        if (!process.env.TOKEN) {
            console.error('❌ TOKEN not found in environment variables');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash commands registered');
    } catch (e) {
        console.error('❌ Ready event error:', e.message);
    }
});

// ─── INTERACTIONS ─────────────────────────────────
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        const userId = interaction.user?.id;
        const { commandName } = interaction;

        if (!userId) {
            await interaction.reply({ content: '❌ Error: User ID not found', ephemeral: true }).catch(() => {});
            return;
        }

        // PING COMMAND
        if (commandName === 'ping') {
            return await interaction.reply({ content: '🏓 Pong! ' + client.ws.ping + 'ms', ephemeral: true }).catch(() => {});
        }

        // HELP COMMAND
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor(0x00ff88)
                .setTitle('🤖 Bot Commands')
                .setDescription('`/ping` `/bal` `/rank` `/profile` `/shop` `/buy` `/sell` `/bossfight` `/leaderboard` `/wordle` `/addxp` `/addcoins` `/ban` `/kick`');
            return await interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // BAL COMMAND
        if (commandName === 'bal') {
            const balance = coins.get(userId) || 0;
            return await interaction.reply({ content: `💰 **${balance}** coins`, ephemeral: true }).catch(() => {});
        }

        // RANK COMMAND
        if (commandName === 'rank') {
            const info = getLevelInfo(xp.get(userId));
            const bar = '█'.repeat(Math.floor((info.xpInLevel / info.xpRequired) * 10)) + '░'.repeat(10 - Math.floor((info.xpInLevel / info.xpRequired) * 10));
            return await interaction.reply({ content: `**Level ${info.level}**\n${bar} (${info.xpInLevel}/${info.xpRequired})`, ephemeral: true }).catch(() => {});
        }

        // PROFILE COMMAND
        if (commandName === 'profile') {
            const userCoins = coins.get(userId) || 0;
            const info = getLevelInfo(xp.get(userId));
            const inv = weapons.get(userId) || [];
            const embed = new EmbedBuilder()
                .setColor(0xff00ff)
                .setTitle(`${interaction.user?.username || 'User'}'s Profile`)
                .addFields(
                    { name: 'Coins', value: `**${userCoins}**`, inline: true },
                    { name: 'Level', value: `**${info.level}**`, inline: true },
                    { name: 'Weapons', value: inv.length ? inv.map(w => `• ${w?.name || 'Unknown'} (${w?.rarity || 'N/A'})`).join('\n') : 'None' }
                );
            return await interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // SHOP COMMAND
        if (commandName === 'shop') {
            let text = '**🛍️ Shop:**\n';
            shop.forEach(i => text += `**${i?.name || 'Item'}** — 💰 ${i?.price || 0} — ⚔️ ${i?.damage || 0} — ${i?.rarity || 'N/A'}\n`);
            return await interaction.reply({ content: text, ephemeral: true }).catch(() => {});
        }

        // BUY COMMAND
        if (commandName === 'buy') {
            const itemName = interaction.options?.getString('item')?.toLowerCase() || '';
            if (!itemName) return await interaction.reply({ content: '❌ Invalid item', ephemeral: true }).catch(() => {});

            const item = shop.find(i => i.name.toLowerCase() === itemName);
            if (!item) return await interaction.reply({ content: '❌ Item not found in shop', ephemeral: true }).catch(() => {});
            
            const userCoins = coins.get(userId) || 0;
            if (userCoins < item.price) return await interaction.reply({ content: `❌ Not enough coins (need ${item.price}, have ${userCoins})`, ephemeral: true }).catch(() => {});

            coins.set(userId, userCoins - item.price);
            if (!weapons.has(userId)) weapons.set(userId, []);
            weapons.get(userId).push({ ...item });
            saveData();
            return await interaction.reply({ content: `🛒 Bought **${item.name}** for **${item.price}** coins!`, ephemeral: true }).catch(() => {});
        }

        // SELL COMMAND
        if (commandName === 'sell') {
            const itemName = interaction.options?.getString('item')?.toLowerCase() || '';
            if (!itemName) return await interaction.reply({ content: '❌ Invalid item', ephemeral: true }).catch(() => {});

            const inv = weapons.get(userId) || [];
            const index = inv.findIndex(i => i?.name?.toLowerCase() === itemName);
            if (index === -1) return await interaction.reply({ content: '❌ You don\'t have that item', ephemeral: true }).catch(() => {});

            const item = inv.splice(index, 1)[0];
            const sellPrice = Math.max(1, Math.floor((item?.price || 100) * 0.6));
            coins.set(userId, (coins.get(userId) || 0) + sellPrice);
            saveData();
            return await interaction.reply({ content: `💰 Sold **${item?.name || 'Item'}** for **${sellPrice}** coins!`, ephemeral: true }).catch(() => {});
        }

        // BOSSFIGHT COMMAND
        if (commandName === 'bossfight') {
            if (!boss) boss = { name: 'Cosmic God', health: 6000, maxHealth: 6000 };
            const inv = weapons.get(userId) || [];
            const best = [...inv].sort((a, b) => (b?.damage || 0) - (a?.damage || 0))[0] || { damage: 20 };
            const damage = Math.max(1, (best?.damage || 20) + Math.floor(Math.random() * 40));

            boss.health = Math.max(0, boss.health - damage);
            coins.set(userId, (coins.get(userId) || 0) + Math.floor(damage / 2));
            saveData();

            if (boss.health <= 0) {
                boss = null;
                return await interaction.reply({ content: `🎊 **Boss defeated!** You earned **${Math.floor(damage / 2)}** coins!` }).catch(() => {});
            }
            return await interaction.reply({ content: `⚔️ Dealt **${damage}** damage!\n**HP:** ${boss.health}/${boss.maxHealth}` }).catch(() => {});
        }

        // LEADERBOARD COMMAND
        if (commandName === 'leaderboard') {
            const top = [...coins.entries()]
                .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                .slice(0, 5)
                .map(([id, amount], i) => `**#${i+1}** <@${id}> — 💰 **${amount || 0}**`)
                .join('\n');
            return await interaction.reply({ content: top || 'No players yet' }).catch(() => {});
        }

        // ADDXP COMMAND (STAFF ONLY)
        if (commandName === 'addxp') {
            if (!staffSet.has(userId)) {
                return await interaction.reply({ content: '❌ Staff only', ephemeral: true }).catch(() => {});
            }
            const target = interaction.options?.getUser('user');
            const amount = interaction.options?.getInteger('amount');
            if (!target || !amount) return await interaction.reply({ content: '❌ Invalid input', ephemeral: true }).catch(() => {});

            xp.set(target.id, (xp.get(target.id) || 0) + amount);
            saveData();
            return await interaction.reply({ content: `✅ Added **${amount}** XP to <@${target.id}>`, ephemeral: true }).catch(() => {});
        }

        // ADDCOINS COMMAND (STAFF ONLY)
        if (commandName === 'addcoins') {
            if (!staffSet.has(userId)) {
                return await interaction.reply({ content: '❌ Staff only', ephemeral: true }).catch(() => {});
            }
            const target = interaction.options?.getUser('user');
            const amount = interaction.options?.getInteger('amount');
            if (!target || !amount) return await interaction.reply({ content: '❌ Invalid input', ephemeral: true }).catch(() => {});

            coins.set(target.id, (coins.get(target.id) || 0) + amount);
            saveData();
            return await interaction.reply({ content: `✅ Added **${amount}** coins to <@${target.id}>`, ephemeral: true }).catch(() => {});
        }

        // BAN COMMAND
        if (commandName === 'ban') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
                return await interaction.reply({ content: '❌ You need Ban Members permission', ephemeral: true }).catch(() => {});
            }
            const target = interaction.options?.getUser('user');
            const reason = interaction.options?.getString('reason') || 'No reason provided';
            if (!target) return await interaction.reply({ content: '❌ Invalid user', ephemeral: true }).catch(() => {});

            try {
                await interaction.guild?.members.ban(target, { reason });
                return await interaction.reply({ content: `🔨 **${target.username}** has been banned. Reason: ${reason}`, ephemeral: true }).catch(() => {});
            } catch (error) {
                console.error('Ban error:', error.message);
                return await interaction.reply({ content: '❌ Failed to ban user', ephemeral: true }).catch(() => {});
            }
        }

        // KICK COMMAND
        if (commandName === 'kick') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.KickMembers)) {
                return await interaction.reply({ content: '❌ You need Kick Members permission', ephemeral: true }).catch(() => {});
            }
            const target = interaction.options?.getUser('user');
            const reason = interaction.options?.getString('reason') || 'No reason provided';
            if (!target) return await interaction.reply({ content: '❌ Invalid user', ephemeral: true }).catch(() => {});

            try {
                const member = await interaction.guild?.members.fetch(target.id);
                if (!member) return await interaction.reply({ content: '❌ User not found in server', ephemeral: true }).catch(() => {});
                await member.kick(reason);
                return await interaction.reply({ content: `👢 **${target.username}** has been kicked. Reason: ${reason}`, ephemeral: true }).catch(() => {});
            } catch (error) {
                console.error('Kick error:', error.message);
                return await interaction.reply({ content: '❌ Failed to kick user', ephemeral: true }).catch(() => {});
            }
        }

        // WORDLE COMMAND
        if (commandName === 'wordle') {
            return await interaction.reply({ content: '⚙️ Wordle game not implemented yet', ephemeral: true }).catch(() => {});
        }

    } catch (error) {
        console.error('❌ Interaction error:', error.message);
        try {
            if (!interaction.replied) {
                await interaction.reply({ content: '❌ An error occurred processing your command', ephemeral: true }).catch(() => {});
            }
        } catch (replyError) {
            console.error('Error replying to interaction:', replyError.message);
        }
    }
});

// ─── GLOBAL ERROR HANDLERS ─────────────────────────────
process.on('unhandledRejection', error => {
    console.error('⚠️ Unhandled Rejection:', error?.message || error);
});

process.on('uncaughtException', error => {
    console.error('⚠️ Uncaught Exception:', error?.message || error);
});

client.on('error', error => {
    console.error('⚠️ Client error:', error?.message || error);
});

client.on('warn', warning => {
    console.warn('⚠️ Client warning:', warning);
});

// ─── LOGIN ─────────────────────────────────────────
if (!process.env.TOKEN) {
    console.error('❌ ERROR: TOKEN environment variable is not set!');
    process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
});
