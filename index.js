require('dotenv').config();
const fs   = require('fs');
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
const weapons       = new Map();   // userId → array of items
const staffSet      = new Set();
const autoResponses = new Map();

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
        console.log('✅ Data loaded from disk');
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

// ─── SHOP WITH RARITY (NEW) ─────────────────────────────────────
const shop = [
    { name: 'Rusty Sword',   damage: 25,  price: 500,   rarity: 'Common' },
    { name: 'Shadow Blade',  damage: 80,  price: 5000,  rarity: 'Rare' },
    { name: 'Galaxy Hammer', damage: 150, price: 25000, rarity: 'Legendary' }
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

// ─── SLASH COMMANDS (Updated) ───────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder().setName('ping').setDescription('pong fr'),
    new SlashCommandBuilder().setName('help').setDescription('list all commands'),
    new SlashCommandBuilder().setName('bal').setDescription('check your coin balance'),
    new SlashCommandBuilder().setName('rank').setDescription('check your level & XP'),
    new SlashCommandBuilder().setName('profile').setDescription('show full profile'),
    new SlashCommandBuilder().setName('shop').setDescription('view the weapon shop'),
    new SlashCommandBuilder().setName('buy').setDescription('buy an item').addStringOption(o => o.setName('item').setDescription('item name').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('sell an item').addStringOption(o => o.setName('item').setDescription('item name').setRequired(true)),
    new SlashCommandBuilder().setName('bossfight').setDescription('fight the current boss'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('top 5 coin holders'),
    new SlashCommandBuilder().setName('wordle').setDescription('Play Wordle').addStringOption(o => o.setName('guess').setDescription('Your 5-letter guess').setRequired(true).setMinLength(5).setMaxLength(5)),
    // Add your other original commands here...
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
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const { commandName } = interaction;

    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle('🤖 Ultimate Bot Commands')
            .setDescription('**Slash Commands:**\n`/ping` `/help` `/bal` `/rank` `/profile` `/shop` `/buy` `/sell` `/bossfight` `/leaderboard` `/wordle`');
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bal')
        return interaction.reply(`${coins.get(userId) || 0} coins`);

    if (commandName === 'rank') {
        const info = getLevelInfo(xp.get(userId));
        const bar = '█'.repeat(Math.floor((info.xpInLevel / info.xpRequired) * 10)) + '░'.repeat(10 - Math.floor((info.xpInLevel / info.xpRequired) * 10));
        const embed = new EmbedBuilder()
            .setColor(0x7289DA)
            .setTitle(`⭐ ${interaction.user.username}'s Rank`)
            .addFields(
                { name: 'Level', value: `**${info.level}**`, inline: true },
                { name: 'Total XP', value: `**${info.totalXP}**`, inline: true }
            )
            .setDescription(bar);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'profile') {
        const userCoins = coins.get(userId) || 0;
        const info = getLevelInfo(xp.get(userId));
        const inv = weapons.get(userId) || [];
        const embed = new EmbedBuilder()
            .setColor(0xff00ff)
            .setTitle(`${interaction.user.username}'s Profile`)
            .addFields(
                { name: '💰 Coins', value: `**${userCoins}**`, inline: true },
                { name: '⭐ Level', value: `**${info.level}**`, inline: true },
                { name: '⚔️ Weapons', value: inv.length ? inv.map(w => `\( {w.name} ( \){w.rarity})`).join('\n') : 'None' }
            );
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'shop') {
        let text = '**🛒 Shop:**\n';
        shop.forEach(item => {
            text += `**${item.name}** — 💰 ${item.price} — ⚔️ \( {item.damage} dmg [ \){item.rarity}]\n`;
        });
        return interaction.reply(text);
    }

    if (commandName === 'buy') {
        const itemName = interaction.options.getString('item').toLowerCase();
        const item = shop.find(i => i.name.toLowerCase() === itemName);
        if (!item) return interaction.reply({ content: '❌ Item not found!', ephemeral: true });

        const userCoins = coins.get(userId) || 0;
        if (userCoins < item.price) return interaction.reply({ content: '❌ Not enough coins!', ephemeral: true });

        coins.set(userId, userCoins - item.price);
        if (!weapons.has(userId)) weapons.set(userId, []);
        weapons.get(userId).push({ ...item });
        saveData();

        return interaction.reply(`🛒 Bought **\( {item.name}** ( \){item.rarity})!`);
    }

    if (commandName === 'sell') {
        const itemName = interaction.options.getString('item').toLowerCase();
        const inv = weapons.get(userId) || [];
        const index = inv.findIndex(i => i.name.toLowerCase() === itemName);
        if (index === -1) return interaction.reply({ content: '❌ You don\'t own that item!', ephemeral: true });

        const item = inv.splice(index, 1)[0];
        const sellPrice = Math.floor(item.price * 0.6);
        coins.set(userId, (coins.get(userId) || 0) + sellPrice);
        saveData();

        return interaction.reply(`💰 Sold **\( {item.name}** for ** \){sellPrice}** coins!`);
    }

    if (commandName === 'bossfight') {
        // Simple boss logic (you can expand this)
        if (!boss) {
            boss = { name: 'Cosmic God', health: 6000, maxHealth: 6000, raging: false };
        }
        const inv = weapons.get(userId) || [];
        const best = inv.sort((a,b) => b.damage - a.damage)[0] || { damage: 20 };
        let dmg = best.damage + Math.floor(Math.random() * 30);

        boss.health -= dmg;
        coins.set(userId, (coins.get(userId) || 0) + Math.floor(dmg / 2));

        if (boss.health <= 0) {
            boss = null;
            return interaction.reply(`🎊 You defeated the boss! +${Math.floor(dmg/2)} coins`);
        }
        return interaction.reply(`⚔️ You dealt **${dmg}** damage!\n**Boss HP:** \( {boss.health}/ \){boss.maxHealth}`);
    }

    if (commandName === 'leaderboard') {
        const sorted = [...coins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (!sorted.length) return interaction.reply('Nobody has coins yet');
        let text = '**🏆 Leaderboard:**\n';
        sorted.forEach((u, i) => { 
            text += `**#\( {i + 1}** <@ \){u[0]}> — 💰 **${u[1]}**\n`; 
        });
        return interaction.reply(text);
    }

    // ... (Keep all your other original commands here: wordle, addstaff, etc.)
});

client.login(process.env.TOKEN);const FILE = path.join(__dirname, 'data.json');

const coins = new Map();
const xp = new Map();
const inventory = new Map();

// ===== LOAD / SAVE =====
function loadData() {
    if (!fs.existsSync(FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FILE));

    Object.entries(raw.coins || {}).forEach(([k,v]) => coins.set(k,v));
    Object.entries(raw.xp || {}).forEach(([k,v]) => xp.set(k,v));
    Object.entries(raw.inventory || {}).forEach(([k,v]) => inventory.set(k,v));

    console.log("✅ Data loaded");
}

function saveData() {
    fs.writeFileSync(FILE, JSON.stringify({
        coins: Object.fromEntries(coins),
        xp: Object.fromEntries(xp),
        inventory: Object.fromEntries(inventory)
    }, null, 2));
}

loadData();
setInterval(saveData, 300000);

// ===== HELPERS =====
const getCoins = id => coins.get(id) || 0;

function addCoins(id, amount) {
    coins.set(id, Math.max(0, getCoins(id) + amount));
}

function addXP(id, amount = 10) {
    xp.set(id, (xp.get(id) || 0) + amount);
}

function xpForLevel(l) {
    return 5*l*l + 50*l + 100;
}

function getLevelInfo(total = 0) {
    let level = 0;
    let remaining = total;

    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
    }

    return { level, xp: remaining, req: xpForLevel(level) };
}

// ===== COOLDOWNS =====
const cooldowns = {
    daily: new Map(),
    boss: new Map(),
    ai: new Map()
};

const xpCooldown = new Map();

// ===== SHOP =====
const shop = [
    { name: "Rusty Sword", dmg: 25, price: 500 },
    { name: "Shadow Blade", dmg: 80, price: 5000 },
    { name: "Galaxy Hammer", dmg: 150, price: 25000 }
];

// ===== BOSS =====
const bosses = new Map();

function spawnBoss(guildId) {
    bosses.set(guildId, {
        name: "🌌 Cosmic God",
        hp: 6000,
        max: 6000,
        rage: false
    });
}

// ===== WORDLE =====
const wordles = new Map();

function startWordle(guildId) {
    const WORDS = ['apple','tiger','zebra','ghost','flame'];
    wordles.set(guildId, {
        word: WORDS[Math.floor(Math.random()*WORDS.length)],
        tries: []
    });
}

// ===== XP SYSTEM =====
client.on('messageCreate', msg => {
    if (msg.author.bot) return;

    const now = Date.now();
    if (xpCooldown.has(msg.author.id) && now - xpCooldown.get(msg.author.id) < 60000) return;

    xpCooldown.set(msg.author.id, now);

    const before = xp.get(msg.author.id) || 0;
    addXP(msg.author.id);
    const after = xp.get(msg.author.id);

    if (getLevelInfo(after).level > getLevelInfo(before).level) {
        addCoins(msg.author.id, 500);
        msg.channel.send(`🎉 ${msg.author} leveled up! +500 coins`);
    }
});

// ===== COMMANDS =====
const commands = [
    new SlashCommandBuilder().setName('bal').setDescription('Balance'),
    new SlashCommandBuilder().setName('daily').setDescription('Daily coins'),
    new SlashCommandBuilder().setName('rank').setDescription('Level'),
    new SlashCommandBuilder().setName('shop').setDescription('Shop'),
    new SlashCommandBuilder().setName('boss').setDescription('Fight boss'),
    new SlashCommandBuilder().setName('ai')
        .setDescription('Ask AI')
        .addStringOption(o=>o.setName('prompt').setRequired(true))
].map(c=>c.toJSON());

// ===== READY =====
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} online`);

    const rest = new REST({ version:'10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    client.guilds.cache.forEach(g => {
        if (!bosses.has(g.id)) spawnBoss(g.id);
        if (!wordles.has(g.id)) startWordle(g.id);
    });
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guild } = interaction;
    const id = user.id;

    if (commandName === 'bal') {
        return interaction.reply(`💰 ${getCoins(id)} coins`);
    }

    if (commandName === 'daily') {
        const last = cooldowns.daily.get(id);
        if (last && Date.now() - last < 86400000)
            return interaction.reply("⏳ Already claimed");

        cooldowns.daily.set(id, Date.now());
        addCoins(id, 500);
        return interaction.reply("💸 +500 coins");
    }

    if (commandName === 'rank') {
        const info = getLevelInfo(xp.get(id));
        return interaction.reply(`Level ${info.level} (${info.xp}/${info.req})`);
    }

    if (commandName === 'shop') {
        return interaction.reply(
            shop.map(i => `${i.name} — ${i.price}`).join('\n')
        );
    }

    if (commandName === 'boss') {
        const guildId = guild.id;
        let boss = bosses.get(guildId);

        const damage = Math.floor(Math.random()*50)+20;
        boss.hp -= damage;

        addCoins(id, Math.floor(damage/2));

        if (boss.hp <= 0) {
            spawnBoss(guildId);
            return interaction.reply("🎉 Boss defeated!");
        }

        return interaction.reply(`⚔️ ${damage} dmg | HP: ${boss.hp}`);
    }

    if (commandName === 'ai') {
        if (!openai) return interaction.reply("❌ AI disabled");

        const prompt = interaction.options.getString('prompt');

        const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }]
        });

        return interaction.reply(res.choices[0].message.content.slice(0, 2000));
    }
});

// ===== LOGIN =====
client.login(process.env.TOKEN);
