require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActivityType,
    EmbedBuilder,
    ChannelType
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

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw.warnings) for (const [k, v] of Object.entries(raw.warnings)) warnings.set(k, v);
        if (raw.xp) for (const [k, v] of Object.entries(raw.xp)) xp.set(k, v);
        if (raw.coins) for (const [k, v] of Object.entries(raw.coins)) coins.set(k, v);
        if (raw.weapons) for (const [k, v] of Object.entries(raw.weapons)) weapons.set(k, v);
        if (raw.staff) for (const id of raw.staff) staffSet.add(id);
        if (raw.autoResponses) for (const [k, v] of Object.entries(raw.autoResponses)) autoResponses.set(k, v);
        if (raw.welcomeConfig) welcomeConfig = raw.welcomeConfig;
        if (raw.logsConfig) logsConfig = raw.logsConfig;
        console.log('✅ Data loaded');
    } catch (e) { console.error('Load error:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            warnings: Object.fromEntries(warnings),
            xp: Object.fromEntries(xp),
            coins: Object.fromEntries(coins),
            weapons: Object.fromEntries(weapons),
            staff: [...staffSet],
            autoResponses: Object.fromEntries(autoResponses),
            welcomeConfig,
            logsConfig
        }, null, 2));
    } catch (e) { console.error('Save error:', e.message); }
}

loadData();
setInterval(saveData, 300000); // 5 min

// ─── OPENAI ─────────────────────────────────────
const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// ─── SHOP + RARITY ─────────────────────────────────
const shop = [
    { name: 'Rusty Sword', damage: 25, price: 500, rarity: 'Common' },
    { name: 'Shadow Blade', damage: 80, price: 5000, rarity: 'Rare' },
    { name: 'Galaxy Hammer', damage: 150, price: 25000, rarity: 'Legendary' }
];

// ─── LEVEL SYSTEM ─────────────────────────────────
function xpForLevel(n) { return 5 * n * n + 50 * n + 100; }

function getLevelInfo(totalXP) {
    let level = 0;
    let remaining = totalXP || 0;
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
    new SlashCommandBuilder().setName('buy').setDescription('buy item').addStringOption(o => o.setName('item').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('sell item').addStringOption(o => o.setName('item').setRequired(true)),
    new SlashCommandBuilder().setName('bossfight').setDescription('fight boss'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('top players'),
    new SlashCommandBuilder().setName('wordle').setDescription('play wordle').addStringOption(o => o.setName('guess').setRequired(true).setMinLength(5).setMaxLength(5)),
].map(c => c.toJSON());

// ─── CLIENT ───────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} online`);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});

// ─── INTERACTIONS ─────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const { commandName } = interaction;

    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle('🤖 Bot Commands')
            .setDescription('`/ping` `/bal` `/rank` `/profile` `/shop` `/buy` `/sell` `/bossfight` `/leaderboard` `/wordle`');
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bal') return interaction.reply(`💰 ${coins.get(userId) || 0} coins`);

    if (commandName === 'rank') {
        const info = getLevelInfo(xp.get(userId));
        const bar = '█'.repeat(Math.floor((info.xpInLevel / info.xpRequired) * 10)) + '░'.repeat(10 - Math.floor((info.xpInLevel / info.xpRequired) * 10));
        return interaction.reply(`**Level \( {info.level}**\n \){bar}`);
    }

    if (commandName === 'profile') {
        const userCoins = coins.get(userId) || 0;
        const info = getLevelInfo(xp.get(userId));
        const inv = weapons.get(userId) || [];
        const embed = new EmbedBuilder()
            .setColor(0xff00ff)
            .setTitle(`${interaction.user.username}'s Profile`)
            .addFields(
                { name: 'Coins', value: `**${userCoins}**`, inline: true },
                { name: 'Level', value: `**${info.level}**`, inline: true },
                { name: 'Weapons', value: inv.length ? inv.map(w => `• \( {w.name} ( \){w.rarity})`).join('\n') : 'None' }
            );
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'shop') {
        let text = '**Shop:**\n';
        shop.forEach(i => text += `**\( {i.name}** — 💰 \){i.price} — ⚔️${i.damage} — ${i.rarity}\n`);
        return interaction.reply(text);
    }

    if (commandName === 'buy') {
        const itemName = interaction.options.getString('item').toLowerCase();
        const item = shop.find(i => i.name.toLowerCase() === itemName);
        if (!item) return interaction.reply('❌ Item not found');
        if ((coins.get(userId) || 0) < item.price) return interaction.reply('❌ Not enough coins');

        coins.set(userId, (coins.get(userId) || 0) - item.price);
        if (!weapons.has(userId)) weapons.set(userId, []);
        weapons.get(userId).push({ ...item });
        saveData();
        return interaction.reply(`🛒 Bought **${item.name}**`);
    }

    if (commandName === 'sell') {
        const itemName = interaction.options.getString('item').toLowerCase();
        const inv = weapons.get(userId) || [];
        const index = inv.findIndex(i => i.name.toLowerCase() === itemName);
        if (index === -1) return interaction.reply('❌ You don\'t have that item');

        const item = inv.splice(index, 1)[0];
        const sellPrice = Math.floor(item.price * 0.6);
        coins.set(userId, (coins.get(userId) || 0) + sellPrice);
        saveData();
        return interaction.reply(`💰 Sold **\( {item.name}** for ** \){sellPrice}** coins`);
    }

    if (commandName === 'bossfight') {
        if (!boss) boss = { name: 'Cosmic God', health: 6000, maxHealth: 6000 };
        const inv = weapons.get(userId) || [];
        const best = [...inv].sort((a, b) => b.damage - a.damage)[0] || { damage: 20 };
        const damage = best.damage + Math.floor(Math.random() * 40);

        boss.health -= damage;
        coins.set(userId, (coins.get(userId) || 0) + Math.floor(damage / 2));
        saveData();

        if (boss.health <= 0) {
            boss = null;
            return interaction.reply('🎊 Boss defeated!');
        }
        return interaction.reply(`⚔️ ${damage} damage\n**HP:** \( {boss.health}/ \){boss.maxHealth}`);
    }

    if (commandName === 'leaderboard') {
        const top = [...coins.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, amount], i) => `**#\( {i+1}** <@ \){id}> — 💰 **${amount}**`)
            .join('\n');
        return interaction.reply(top || 'No players yet');
    }
});

client.login(process.env.TOKEN).catch(console.error);
