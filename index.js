// ===== SETUP =====
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
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder
} = require('discord.js');

// ===== CLIENT =====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ===== AI =====
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// ===== DATA =====
const FILE = path.join(__dirname, 'data.json');

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
