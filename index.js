require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    ActivityType,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
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

// welcome & logs config
let welcomeConfig = {};
let logsConfig    = {};

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw.warnings)      for (const [k, v] of Object.entries(raw.warnings))      warnings.set(k, v);
        if (raw.xp)            for (const [k, v] of Object.entries(raw.xp))            xp.set(k, v);
        if (raw.coins)         for (const [k, v] of Object.entries(raw.coins))         coins.set(k, v);
        if (raw.weapons)       for (const [k, v] of Object.entries(raw.weapons))       weapons.set(k, v);
        if (raw.staff)         for (const id of raw.staff)                             staffSet.add(id);
        if (raw.autoResponses) for (const [k, v] of Object.entries(raw.autoResponses)) autoResponses.set(k, v);
        if (raw.welcomeConfig) welcomeConfig = raw.welcomeConfig;
        if (raw.logsConfig)    logsConfig    = raw.logsConfig;
        console.log('data loaded from disk');
    } catch (e) { console.error('load error:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            warnings:      Object.fromEntries(warnings),
            xp:            Object.fromEntries(xp),
            coins:         Object.fromEntries(coins),
            weapons:       Object.fromEntries(weapons),
            staff:         [...staffSet],
            autoResponses: Object.fromEntries(autoResponses),
            welcomeConfig,
            logsConfig
        }, null, 2));
    } catch (e) { console.error('save error:', e.message); }
}

loadData();
setInterval(saveData, 5 * 60 * 1000);

// ─── OPENAI CLIENT ─────────────────────────────
const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// ─── RUNTIME MAPS ─────────────
const cooldowns   = new Map();
const xpCooldowns = new Map();
const spamMap     = new Map();

// ─── WORDLE STATE ────────────────────────────────────────────────
const wordleGames = new Map();

const WORDLE_WORDS = ['apple','brave','chess','drive','eight','flair','grace','heart','ivory','jewel','knack','lemon','maple','noble','ocean','piano','quest','raven','solar','tiger'];

// (Your evaluateGuess and buildWordleEmbed functions kept as-is)
function evaluateGuess(word, guess) {
    const result  = Array(5).fill('⬛');
    const wordArr = word.split('');
    const used    = Array(5).fill(false);
    const gArr    = guess.split('');
    for (let i = 0; i < 5; i++) {
        if (gArr[i] === wordArr[i]) { result[i] = '🟩'; used[i] = true; gArr[i] = null; }
    }
    for (let i = 0; i < 5; i++) {
        if (!gArr[i]) continue;
        for (let j = 0; j < 5; j++) {
            if (!used[j] && gArr[i] === wordArr[j]) { result[i] = '🟨'; used[j] = true; break; }
        }
    }
    return result;
}

// ─── BOSS SYSTEM ─────────────────────────────────────────────────
let boss = null;
const shop = [
    { name: 'Rusty Sword',   damage: 25,  price: 500   },
    { name: 'Shadow Blade',  damage: 80,  price: 5000  },
    { name: 'Galaxy Hammer', damage: 150, price: 25000 }
];

// ─── LEVEL SYSTEM ────────────────────────────────────────────────
function xpForLevel(n) { return 5 * n * n + 50 * n + 100; }

function getLevelInfo(totalXP) {
    let level = 0;
    let remaining = totalXP || 0;
    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
    }
    return { level, xpInLevel: remaining, xpRequired: xpForLevel(level), totalXP: totalXP || 0 };
}

// ─── SLASH COMMANDS ──────────────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder().setName('ping').setDescription('pong fr'),
    new SlashCommandBuilder().setName('help').setDescription('list all commands'),
    new SlashCommandBuilder().setName('bal').setDescription('check your coin balance'),
    new SlashCommandBuilder().setName('rank').setDescription('check your level & XP'),
    new SlashCommandBuilder().setName('shop').setDescription('view the weapon shop'),
    new SlashCommandBuilder().setName('coinflip').setDescription('flip a coin'),
    new SlashCommandBuilder().setName('8ball').setDescription('ask the magic 8ball').addStringOption(o => o.setName('question').setDescription('your question').setRequired(true)),
    new SlashCommandBuilder().setName('bossstatus').setDescription('check active boss hp'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('top 5 coin holders'),
    new SlashCommandBuilder().setName('warnings').setDescription('check your warnings'),
    new SlashCommandBuilder().setName('start').setDescription('confirm bot is online'),
    // ... (your other commands stay the same)
    new SlashCommandBuilder().setName('wordle').setDescription('Play Wordle').addStringOption(o => o.setName('guess').setDescription('Your 5-letter guess').setRequired(true).setMinLength(5).setMaxLength(5)),
].map(c => c.toJSON());

// ─── CLIENT SETUP ─────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const startTime = Date.now();

client.once('ready', async () => {
    console.log(`${client.user.tag} is online fr`);

    client.user.setPresence({
        status: 'online',
        activities: [{ name: '!help | /start', type: ActivityType.Watching }]
    });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
});

// ─── INTERACTION HANDLER ─────────────────────
client.on('interactionCreate', async (interaction) => {
    const isOwner = interaction.user.id === '1340069836096667859';
    const isStaff = staffSet.has(interaction.user.id);

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'ping') return interaction.reply('pong fr');

    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle('🤖 Ultimate Bot Commands')
            .setDescription('All available commands:')
            .addFields(
                { name: '📊 Economy', value: '`/bal` `/shop` `/buy` `/sell`', inline: true },
                { name: '📈 Leveling', value: '`/rank` `/leaderboard`', inline: true },
                { name: '⚔️ Fun', value: '`/bossstatus` `/wordle` `/coinflip` `/8ball`', inline: true },
                { name: '🔧 Others', value: '`/ping` `/warnings` `/start`', inline: true }
            )
            .setFooter({ text: 'Prefix commands also available: !daily, !rob, etc.' });
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bal')
        return interaction.reply(`${coins.get(interaction.user.id) || 0} coins`);

    if (commandName === 'rank') {
        const info = getLevelInfo(xp.get(interaction.user.id));
        const bar = '█'.repeat(Math.floor((info.xpInLevel / info.xpRequired) * 10)) + '░'.repeat(10 - Math.floor((info.xpInLevel / info.xpRequired) * 10));
        const embed = new EmbedBuilder()
            .setColor(0x7289DA)
            .setTitle(`⭐ ${interaction.user.username}'s Rank`)
            .addFields(
                { name: 'Level', value: `**${info.level}**`, inline: true },
                { name: 'Total XP', value: `**${info.totalXP}**`, inline: true },
                { name: 'Progress', value: `${info.xpInLevel} / ${info.xpRequired}`, inline: true }
            )
            .setDescription(bar);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'leaderboard') {
        const sorted = [...coins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (!sorted.length) return interaction.reply('Nobody has coins yet');
        let text = '**Leaderboard:**\n';
        sorted.forEach((u, i) => { text += `**#\( {i + 1}** <@ \){u[0]}> — 💰 **${u[1]}**\n`; });
        return interaction.reply(text);
    }

    if (commandName === 'bossstatus') {
        if (!boss) return interaction.reply('No boss active right now');
        const bar = '█'.repeat(Math.floor((boss.health / boss.maxHealth) * 10)) + '░'.repeat(10 - Math.floor((boss.health / boss.maxHealth) * 10));
        return interaction.reply(`\( {boss.emoji} ** \){boss.name}** HP: \( {bar} ** \){boss.health}/\( {boss.maxHealth}** \){boss.raging ? ' 🔥 RAGING' : ''}`);
    }

    // ... rest of your commands (addstaff, wordle, etc.) remain unchanged
});

client.login(process.env.TOKEN);
