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

// ─── GLOBAL ERROR HANDLERS ───────────────────────────────────────
process.on('unhandledRejection', err => {
    console.error('❌ UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', err => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

// ─── DATA PERSISTENCE ────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

const warnings      = new Map();
const xp            = new Map();
const coins         = new Map();
const weapons       = new Map();
const staffSet      = new Set();
const autoResponses = new Map();

// welcome & logs config (per-guild key = guild id, value = config object)
let welcomeConfig = {};  // { [guildId]: { channelId, roleId, message, imageUrl } }
let logsConfig    = {};  // { [guildId]: channelId }

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw.warnings)      for (const [k, v] of Object.entries(raw.warnings ?? {}))      warnings.set(k, v);
        if (raw.xp)            for (const [k, v] of Object.entries(raw.xp ?? {}))            xp.set(k, v);
        if (raw.coins)         for (const [k, v] of Object.entries(raw.coins ?? {}))         coins.set(k, v);
        if (raw.weapons)       for (const [k, v] of Object.entries(raw.weapons ?? {}))       weapons.set(k, v);
        if (raw.staff)         for (const id of (raw.staff ?? []))                             staffSet.add(id);
        if (raw.autoResponses) for (const [k, v] of Object.entries(raw.autoResponses ?? {})) autoResponses.set(k, v);
        if (raw.welcomeConfig) welcomeConfig = raw.welcomeConfig;
        if (raw.logsConfig)    logsConfig    = raw.logsConfig;
        console.log('✅ data loaded from disk');
    } catch (e) { console.error('❌ load error:', e.message); }
}

function saveData() {
    try {
        const data = {
            warnings:      Object.fromEntries(warnings),
            xp:            Object.fromEntries(xp),
            coins:         Object.fromEntries(coins),
            weapons:       Object.fromEntries(weapons),
            staff:         [...staffSet],
            autoResponses: Object.fromEntries(autoResponses),
            welcomeConfig,
            logsConfig
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error('❌ save error:', e.message); }
}

// ─── HELPER FUNCTIONS ────────────────────────────────────────────
function addCoins(userId, amount) {
    if (!userId || typeof amount !== 'number') return;
    const current = coins.get(userId) || 0;
    coins.set(userId, Math.max(0, current + amount));
}

function buildHpBar(current, max) {
    if (!max || max <= 0) return '█████ (error)';
    const filled = Math.round((current / max) * 10);
    const empty = 10 - filled;
    return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}

loadData();
setInterval(saveData, 5 * 60 * 1000); // auto-save every 5 min

// ─── OPENAI CLIENT (Replit AI proxy) ─────────────────────────────
let openai = null;
try {
    openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || '',
        apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || '',
    });
} catch (e) {
    console.warn('⚠️ OpenAI initialization failed:', e.message);
}

// ─── RUNTIME-ONLY MAPS (intentionally not persisted) ─────────────
const cooldowns   = new Map(); // !daily cooldown
const xpCooldowns = new Map(); // 60s XP cooldown per user
const spamMap     = new Map();

// ─── WORDLE STATE ────────────────────────────────────────────────
// channelId → { word, guesses: [{guess, result}], maxGuesses: 6 }
const wordleGames = new Map();

const WORDLE_WORDS = [
    'apple','brave','chess','drive','eight','flair','grace','heart','ivory','jewel',
    'knack','lemon','maple','noble','ocean','piano','quest','raven','solar','tiger',
    'ultra','vivid','wheat','xenon','yacht','zebra','adore','blaze','coral','daisy',
    'ember','flute','gleam','haste','inlet','joker','karma','lance','moose','nerve',
    'opera','prism','quail','reign','spine','torch','usher','vapor','waltz','xeric',
    'yield','zonal','amber','boost','crisp','delta','elbow','frost','globe','hover',
    'indie','jaunt','kneel','lunar','merit','niche','orbit','plaza','quirk','rifle',
    'shone','tread','uncle','venom','woven','xylem','yearn','zesty','agent','brisk',
    'cabin','debug','elite','flame','grasp','hyper','irony','judge','knave','latch',
    'mirth','nudge','onset','perch','quota','risky','shelf','thump','unify','verge',
    'witch','xylyl','yokel','zingy','adapt','blunt','cloak','dread','epoch','feast',
    'grand','haunt','image','joust','leach','mulch','naive','overt','pluck','quark',
    'rough','sniff','thorn','umbra','vinyl','wrist','young','scone','pixel','hoard',
    'gloom','fiend','exile','dwarf','crave','bytes','axiom','abyss','swirl','prawn',
];

function evaluateGuess(word, guess) {
    if (!word || !guess || word.length !== 5 || guess.length !== 5) {
        return Array(5).fill('⬛');
    }
    const result  = Array(5).fill('⬛');
    const wordArr = word.toLowerCase().split('');
    const used    = Array(5).fill(false);
    const gArr    = guess.toLowerCase().split('');
    // pass 1: exact matches
    for (let i = 0; i < 5; i++) {
        if (gArr[i] === wordArr[i]) { result[i] = '🟩'; used[i] = true; gArr[i] = null; }
    }
    // pass 2: wrong position
    for (let i = 0; i < 5; i++) {
        if (!gArr[i]) continue;
        for (let j = 0; j < 5; j++) {
            if (!used[j] && gArr[i] === wordArr[j]) { result[i] = '🟨'; used[j] = true; break; }
        }
    }
    return result;
}

function buildWordleEmbed(game, lastGuess, lastResult, finished) {
    if (!game || !game.guesses) {
        return new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Error').setDescription('Invalid game state');
    }
    const embed = new EmbedBuilder()
        .setTitle('🟩 Wordle')
        .setColor(finished === 'win' ? 0x57F287 : finished === 'lose' ? 0xFF4444 : 0x7289DA);
    let board = '';
    for (const { guess, result } of (game.guesses || [])) {
        board += result.join('') + '  ' + (guess || '').toUpperCase().split('').join(' ') + '\n';
    }
    embed.setDescription(board || 'No guesses yet');
    const guessCount = (game.guesses || []).length;
    embed.addFields({ 
        name: `Guess ${guessCount}/${game.maxGuesses || 6}`, 
        value: lastResult ? lastResult.join('') + ' — **' + (lastGuess || '').toUpperCase() + '**' : 'Game started! Use `/wordle guess:word`' 
    });
    if (finished === 'win')  embed.setFooter({ text: `🎉 Solved in ${guessCount} guess${guessCount === 1 ? '' : 'es'}!` });
    if (finished === 'lose') embed.setFooter({ text: `The word was: ${(game.word || '').toUpperCase()}` });
    return embed;
}

// ─── IMPERSONATE STATE ───────────────────────────────────────────
// channelId → { userId, username, avatarUrl, webhookId, webhookToken }
const activeImpersonations = new Map();

async function impersonateReply(channelId, text) {
    try {
        const imp = activeImpersonations.get(channelId);
        if (!imp || !imp.webhookId || !imp.webhookToken) return;
        const { WebhookClient } = require('discord.js');
        const wh = new WebhookClient({ id: imp.webhookId, token: imp.webhookToken });
        await wh.send({ content: text || '', username: imp.username || 'Unknown', avatarURL: imp.avatarUrl });
        wh.destroy();
    } catch (e) { console.error('⚠️ webhook send fail:', e.message); }
}

// ─── CONSTANTS ───────────────────────────────────────────────────
const PREFIX   = process.env.PREFIX || '!';
const OWNER_ID = process.env.OWNER_ID || '1340069836096667859';
const blockedWords = ['badword1', 'badword2'];

// ─── BOSS SYSTEM ─────────────────────────────────────────────────
let boss = null;
let messageCount = 0;
const bossParticipants = new Map();
const bossCooldowns    = new Map();

const shop = [
    { name: 'Rusty Sword',   damage: 25,  price: 500   },
    { name: 'Shadow Blade',  damage: 80,  price: 5000  },
    { name: 'Galaxy Hammer', damage: 150, price: 25000 }
];

const BOSSES = [
    {
        name: 'Goblin King', emoji: '👺', maxHealth: 1000, rewardMult: 1,
        description: 'A classic. Not too scary.'
    },
    {
        name: 'Shadow Demon', emoji: '👹', maxHealth: 3000, rewardMult: 3,
        description: 'An ancient evil with 3000 HP. Rewards tripled.',
        onHit: async (channel, attackerId) => {
            try {
                if (!channel || !attackerId) return;
                if (Math.random() < 0.3) {
                    addCoins(attackerId, -50);
                    saveData();
                    await channel.send(`👹 **Shadow Demon** strikes back! <@${attackerId}> loses 50 coins 💸`).catch(() => {});
                }
            } catch (e) { console.error('⚠️ Shadow Demon onHit error:', e.message); }
        }
    },
    {
        name: 'Cosmic God', emoji: '🌌', maxHealth: 6000, rewardMult: 6,
        description: '6000 HP. Enters RAGE at 50% HP — all damage is halved.',
        onHit: async (channel, attackerId, bossRef) => {
            try {
                if (!bossRef || !channel) return;
                if (!bossRef.raging && bossRef.health <= bossRef.maxHealth / 2) {
                    bossRef.raging = true;
                    await channel.send(`🌌 **Cosmic God** enters **RAGE MODE** — all damage is now halved! 😱`).catch(() => {});
                }
            } catch (e) { console.error('⚠️ Cosmic God onHit error:', e.message); }
        }
    }
];

// ─── ARCANE LEVEL SYSTEM ─────────────────────────────────────────
// Mirrors Arcane/MEE6: XP to reach next level = 5*N^2 + 50*N + 100
function xpForLevel(n) { 
    const level = Math.max(0, n || 0);
    return 5 * level * level + 50 * level + 100; 
}

function getLevelInfo(totalXP) {
    let level = 0;
    let remaining = Math.max(0, totalXP || 0);
    let iterations = 0;
    const maxIterations = 1000; // prevent infinite loops
    while (remaining >= xpForLevel(level) && iterations < maxIterations) {
        remaining -= xpForLevel(level);
        level++;
        iterations++;
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
    new SlashCommandBuilder()
        .setName('8ball').setDescription('ask the magic 8ball')
        .addStringOption(o => o.setName('question').setDescription('your question').setRequired(true)),
    new SlashCommandBuilder().setName('bossstatus').setDescription('check active boss hp'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('top 5 coin holders'),
    new SlashCommandBuilder().setName('warnings').setDescription('check your warnings'),
    new SlashCommandBuilder().setName('start').setDescription('confirm bot is online'),
    new SlashCommandBuilder()
        .setName('addstaff').setDescription('(owner) grant staff to a user')
        .addUserOption(o => o.setName('user').setDescription('user to promote').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removestaff').setDescription('(owner) remove staff from a user')
        .addUserOption(o => o.setName('user').setDescription('user to demote').setRequired(true)),
    new SlashCommandBuilder().setName('liststaff').setDescription('(owner) list all staff'),
    new SlashCommandBuilder()
        .setName('addresponse').setDescription('(owner) add auto-response')
        .addStringOption(o => o.setName('trigger').setDescription('trigger phrase').setRequired(true))
        .addStringOption(o => o.setName('response').setDescription('bot reply').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removeresponse').setDescription('(owner) remove auto-response')
        .addStringOption(o => o.setName('trigger').setDescription('trigger to remove').setRequired(true)),
    new SlashCommandBuilder().setName('listresponses').setDescription('(owner) list auto-responses'),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('(staff/owner) set up the welcome system')
        .addChannelOption(o =>
            o.setName('channel').setDescription('channel to send welcome messages in').setRequired(true)
             .addChannelTypes(ChannelType.GuildText))
        .addRoleOption(o =>
            o.setName('role').setDescription('role to give new members (optional)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('(staff/owner) set the mod-log channel')
        .addChannelOption(o =>
            o.setName('channel').setDescription('channel where logs will appear').setRequired(true)
             .addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder()
        .setName('wordle')
        .setDescription('Play Wordle! Guess the hidden 5-letter word')
        .addStringOption(o => o.setName('guess').setDescription('Your 5-letter guess').setRequired(true).setMinLength(5).setMaxLength(5)),
    new SlashCommandBuilder()
        .setName('endwordle')
        .setDescription('(staff/owner) End the current Wordle game and reveal the word'),
    new SlashCommandBuilder()
        .setName('impersonate')
        .setDescription('(staff/owner) Impersonate a user with AI')
        .addUserOption(o => o.setName('user').setDescription('User to impersonate').setRequired(true)),
    new SlashCommandBuilder()
        .setName('stopimpersonate')
        .setDescription('(staff/owner) Stop impersonating someone in this channel'),
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
    try {
        console.log(`✅ ${client.user?.tag || 'Bot'} is online fr`);

        client.user?.setPresence({
            status: 'online',
            activities: [{ name: '!help | /start', type: ActivityType.Watching }]
        }).catch(() => {});

        for (const guild of client.guilds.cache.values()) {
            try {
                const channel =
                    guild.systemChannel ||
                    guild.channels.cache
                        .filter(c => c.isTextBased?.() && c.permissionsFor?.(guild.members.me)?.has?.('SendMessages'))
                        .first();
                if (channel) {
                    await channel.send('Hi Guysssss I am Online and ready to work (:').catch(() => {});
                }
            } catch (e) {
                console.warn(`⚠️ Error sending startup message to guild ${guild.id}:`, e.message);
            }
        }

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN || '');
        try {
            await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
            console.log('✅ slash commands registered');
        } catch (e) { console.error('❌ slash reg failed:', e.message); }
    } catch (e) {
        console.error('❌ ready event error:', e.message);
    }
});

// ─── INTERACTION HANDLER (commands + modals) ─────────────────────
client.on('interactionCreate', async (interaction) => {
    try {
        const isOwner = interaction.user?.id === OWNER_ID;
        const isStaff = staffSet.has(interaction.user?.id);
        const isMod   = isOwner || isStaff;

        // ── modal submissions ──
        if (interaction.isModalSubmit?.()) {
            try {
                if (interaction.customId?.startsWith('welcome_modal_')) {
                    const guildId = interaction.customId.replace('welcome_modal_', '');
                    const message  = interaction.fields?.getTextInputValue('welcome_msg') || '';
                    const imageUrl = interaction.fields?.getTextInputValue('welcome_img')?.trim?.() || null;

                    const cfg = welcomeConfig[guildId] || {};
                    welcomeConfig[guildId] = { ...cfg, message, imageUrl };
                    saveData();

                    const preview = new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Welcome system configured!')
                        .addFields(
                            { name: 'Channel', value: `<#${welcomeConfig[guildId].channelId}>`, inline: true },
                            { name: 'Role',    value: welcomeConfig[guildId].roleId ? `<@&${welcomeConfig[guildId].roleId}>` : 'None', inline: true },
                            { name: 'Message', value: message }
                        );
                    if (imageUrl) preview.setImage(imageUrl);
                    return await interaction.reply({ embeds: [preview], ephemeral: true }).catch(() => {});
                }
            } catch (e) {
                console.error('⚠️ modal submission error:', e.message);
                return await interaction.reply({ content: '❌ Error processing modal', ephemeral: true }).catch(() => {});
            }
            return;
        }

        if (!interaction.isChatInputCommand?.()) return;
        const { commandName } = interaction;

        if (commandName === 'ping') return await interaction.reply('pong fr').catch(() => {});

        if (commandName === 'help') {
            return await interaction.reply(
                '**Slash commands:** `/ping` `/bal` `/rank` `/shop` `/coinflip` `/8ball` `/bossstatus` `/leaderboard` `/warnings` `/start`\n\n' +
                '**Prefix commands:** `!guess` `!daily` `!rob` `!fight` `!bossfight` `!buy` `!level`\n' +
                '**Anime:** `!domain` `!hollow` `!infinity` `!unleash` `!bankai` `!gear5` `!sharingan` `!attackontitan`\n' +
                '**Fun:** `!ragebait successful` / `!ragebait`\n' +
                '**Fake (members):** `?ban` `?kick` `?mute` `?hack` `?nuke`'
            ).catch(() => {});
        }

        if (commandName === 'bal')
            return await interaction.reply(`${coins.get(interaction.user?.id) || 0} coins`).catch(() => {});

        if (commandName === 'rank') {
            try {
                const info = getLevelInfo(xp.get(interaction.user?.id));
                const bar = buildHpBar(info.xpInLevel, info.xpRequired);
                const embed = new EmbedBuilder()
                    .setColor(0x7289DA)
                    .setTitle(`⭐ ${interaction.user?.username || 'Unknown'}'s Rank`)
                    .addFields(
                        { name: 'Level', value: `**${info.level}**`, inline: true },
                        { name: 'Total XP', value: `**${info.totalXP}**`, inline: true },
                        { name: 'XP to next level', value: `**${info.xpInLevel} / ${info.xpRequired}**`, inline: true }
                    )
                    .setDescription(`Progress: ${bar}`)
                    .setThumbnail(interaction.user?.displayAvatarURL?.());
                return await interaction.reply({ embeds: [embed] }).catch(() => {});
            } catch (e) {
                console.error('⚠️ rank command error:', e.message);
                return await interaction.reply({ content: '❌ Error fetching rank', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'shop') {
            try {
                let text = '**Shop:**\n';
                shop.forEach((item, i) => { text += `${i + 1}. **${item.name}** — ${item.price} coins (${item.damage} dmg)\n`; });
                return await interaction.reply(text).catch(() => {});
            } catch (e) {
                console.error('⚠️ shop command error:', e.message);
                return await interaction.reply({ content: '❌ Error fetching shop', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'coinflip') return await interaction.reply(Math.random() < 0.5 ? 'heads' : 'tails').catch(() => {});

        if (commandName === '8ball') {
            try {
                const replies = ['yes', 'no', 'maybe', 'ask later'];
                return await interaction.reply(replies[Math.floor(Math.random() * replies.length)]).catch(() => {});
            } catch (e) {
                console.error('⚠️ 8ball command error:', e.message);
            }
        }

        if (commandName === 'bossstatus') {
            if (!boss) return await interaction.reply('no boss active right now').catch(() => {});
            try {
                const bar = buildHpBar(boss.health || 0, boss.maxHealth || 1);
                return await interaction.reply(
                    `${boss.emoji || '👾'} **${boss.name || 'Unknown Boss'}** HP: ${bar} ${boss.health || 0}/${boss.maxHealth || 1}${boss.raging ? ' 🔥 RAGING' : ''}`
                ).catch(() => {});
            } catch (e) {
                console.error('⚠️ bossstatus error:', e.message);
            }
        }

        if (commandName === 'leaderboard') {
            try {
                const sorted = [...coins.entries()].sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 5);
                if (!sorted.length) return await interaction.reply('nobody has coins yet').catch(() => {});
                let text = '**Leaderboard:**\n';
                sorted.forEach((u, i) => { text += `${i + 1}. <@${u[0]}> — ${u[1] || 0}\n`; });
                return await interaction.reply(text).catch(() => {});
            } catch (e) {
                console.error('⚠️ leaderboard error:', e.message);
                return await interaction.reply({ content: '❌ Error fetching leaderboard', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'warnings')
            return await interaction.reply(`${warnings.get(interaction.user?.id) || 0} warnings`).catch(() => {});

        if (commandName === 'start') {
            try {
                const ms = Date.now() - startTime;
                const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
                return await interaction.reply(`✅ **Bot is online!**\nUptime: ${h}h ${m}m ${s}s\nPing: ${client.ws?.ping || 0}ms`).catch(() => {});
            } catch (e) {
                console.error('⚠️ start command error:', e.message);
            }
        }

        // ── owner-only slash commands ──
        if (commandName === 'addstaff') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                const user = interaction.options?.getUser('user');
                if (!user) return await interaction.reply({ content: 'Invalid user', ephemeral: true }).catch(() => {});
                if (user.id === OWNER_ID) return await interaction.reply({ content: "that's you lol", ephemeral: true }).catch(() => {});
                staffSet.add(user.id);
                saveData();
                return await interaction.reply({ content: `✅ **${user.tag}** is now staff 🛡️`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ addstaff error:', e.message);
                return await interaction.reply({ content: '❌ Error adding staff', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'removestaff') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                const user = interaction.options?.getUser('user');
                if (!user) return await interaction.reply({ content: 'Invalid user', ephemeral: true }).catch(() => {});
                staffSet.delete(user.id);
                saveData();
                return await interaction.reply({ content: `🗑️ Removed staff from **${user.tag}**`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ removestaff error:', e.message);
                return await interaction.reply({ content: '❌ Error removing staff', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'liststaff') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                if (!staffSet.size) return await interaction.reply({ content: 'no staff yet', ephemeral: true }).catch(() => {});
                const list = [...staffSet].map(id => `<@${id}>`).join('\n');
                return await interaction.reply({ content: `**Staff members:**\n${list}`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ liststaff error:', e.message);
            }
        }

        if (commandName === 'addresponse') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                const trigger = interaction.options?.getString('trigger')?.toLowerCase?.()?.trim?.();
                const response = interaction.options?.getString('response')?.trim?.();
                if (!trigger || !response) return await interaction.reply({ content: 'Invalid trigger or response', ephemeral: true }).catch(() => {});
                autoResponses.set(trigger, response);
                saveData();
                return await interaction.reply({ content: `✅ Added response for "${trigger}"`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ addresponse error:', e.message);
                return await interaction.reply({ content: '❌ Error adding response', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'removeresponse') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                const trigger = interaction.options?.getString('trigger')?.toLowerCase?.()?.trim?.();
                if (!trigger) return await interaction.reply({ content: 'Invalid trigger', ephemeral: true }).catch(() => {});
                const existed = autoResponses.has(trigger);
                autoResponses.delete(trigger);
                saveData();
                return await interaction.reply({ 
                    content: existed ? `✅ Removed response for "${trigger}"` : `⚠️ No response found for "${trigger}"`, 
                    ephemeral: true 
                }).catch(() => {});
            } catch (e) {
                console.error('⚠️ removeresponse error:', e.message);
                return await interaction.reply({ content: '❌ Error removing response', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'listresponses') {
            if (!isOwner) return await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
            try {
                if (!autoResponses.size) return await interaction.reply({ content: 'no responses yet', ephemeral: true }).catch(() => {});
                let text = '**Auto-responses:**\n';
                [...autoResponses.entries()].slice(0, 20).forEach(([trigger, resp]) => {
                    text += `• **${trigger}** → ${resp.substring(0, 50)}${resp.length > 50 ? '...' : ''}\n`;
                });
                return await interaction.reply({ content: text, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ listresponses error:', e.message);
            }
        }

        if (commandName === 'welcome') {
            if (!isMod) return await interaction.reply({ content: 'staff/owner only', ephemeral: true }).catch(() => {});
            try {
                const channel = interaction.options?.getChannel('channel');
                const role = interaction.options?.getRole('role');
                if (!channel) return await interaction.reply({ content: 'Invalid channel', ephemeral: true }).catch(() => {});
                
                const guildId = interaction.guildId;
                welcomeConfig[guildId] = { ...(welcomeConfig[guildId] || {}), channelId: channel.id, roleId: role?.id || null };
                
                const modal = new ModalBuilder()
                    .setCustomId(`welcome_modal_${guildId}`)
                    .setTitle('Configure Welcome Message');
                
                const msgInput = new TextInputBuilder()
                    .setCustomId('welcome_msg')
                    .setLabel('Welcome message')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setValue(welcomeConfig[guildId]?.message || 'Welcome to the server!');
                
                const imgInput = new TextInputBuilder()
                    .setCustomId('welcome_img')
                    .setLabel('Image URL (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(welcomeConfig[guildId]?.imageUrl || '');
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(msgInput),
                    new ActionRowBuilder().addComponents(imgInput)
                );
                
                return await interaction.showModal(modal).catch(() => {});
            } catch (e) {
                console.error('⚠️ welcome error:', e.message);
                return await interaction.reply({ content: '❌ Error setting up welcome', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'logs') {
            if (!isMod) return await interaction.reply({ content: 'staff/owner only', ephemeral: true }).catch(() => {});
            try {
                const channel = interaction.options?.getChannel('channel');
                if (!channel) return await interaction.reply({ content: 'Invalid channel', ephemeral: true }).catch(() => {});
                logsConfig[interaction.guildId] = channel.id;
                saveData();
                return await interaction.reply({ content: `✅ Logs channel set to <#${channel.id}>`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ logs error:', e.message);
                return await interaction.reply({ content: '❌ Error setting logs channel', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'wordle') {
            try {
                const channelId = interaction.channelId;
                const guess = interaction.options?.getString('guess')?.toLowerCase?.()?.trim?.();
                
                if (!guess || guess.length !== 5 || !/^[a-z]+$/.test(guess)) {
                    return await interaction.reply({ content: '❌ Must be a valid 5-letter word', ephemeral: true }).catch(() => {});
                }

                if (!wordleGames.has(channelId)) {
                    const word = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
                    wordleGames.set(channelId, {
                        word,
                        guesses: [],
                        maxGuesses: 6
                    });
                }

                const game = wordleGames.get(channelId);
                if (!game) return;

                if (game.guesses.length >= game.maxGuesses) {
                    wordleGames.delete(channelId);
                    return await interaction.reply({ content: '❌ Game over! Use `/wordle` again to play', ephemeral: true }).catch(() => {});
                }

                const result = evaluateGuess(game.word, guess);
                game.guesses.push({ guess, result });

                const finished = guess === game.word ? 'win' : game.guesses.length >= game.maxGuesses ? 'lose' : null;
                if (finished) wordleGames.delete(channelId);

                const embed = buildWordleEmbed(game, guess, result, finished);
                return await interaction.reply({ embeds: [embed] }).catch(() => {});
            } catch (e) {
                console.error('⚠️ wordle error:', e.message);
                return await interaction.reply({ content: '❌ Error with wordle', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'endwordle') {
            if (!isMod) return await interaction.reply({ content: 'staff/owner only', ephemeral: true }).catch(() => {});
            try {
                const game = wordleGames.get(interaction.channelId);
                if (!game) return await interaction.reply({ content: 'No active game', ephemeral: true }).catch(() => {});
                wordleGames.delete(interaction.channelId);
                return await interaction.reply(`The word was: **${(game.word || '').toUpperCase()}**`).catch(() => {});
            } catch (e) {
                console.error('⚠️ endwordle error:', e.message);
            }
        }

        if (commandName === 'impersonate') {
            if (!isMod) return await interaction.reply({ content: 'staff/owner only', ephemeral: true }).catch(() => {});
            try {
                const targetUser = interaction.options?.getUser('user');
                if (!targetUser) return await interaction.reply({ content: 'Invalid user', ephemeral: true }).catch(() => {});

                const webhooks = await interaction.channel?.fetchWebhooks?.().catch(() => null);
                let webhook = webhooks?.find(w => w.owner?.id === client.user?.id);
                if (!webhook) webhook = await interaction.channel?.createWebhook?.({ name: 'Impersonator' }).catch(() => null);

                if (!webhook) return await interaction.reply({ content: '❌ Cannot create webhook', ephemeral: true }).catch(() => {});

                activeImpersonations.set(interaction.channelId, {
                    userId: targetUser.id,
                    username: targetUser.username,
                    avatarUrl: targetUser.displayAvatarURL?.(),
                    webhookId: webhook.id,
                    webhookToken: webhook.token
                });

                return await interaction.reply({ content: `✅ Impersonating **${targetUser.username}**. Type messages to send as them. Use \`/stopimpersonate\` to stop.`, ephemeral: true }).catch(() => {});
            } catch (e) {
                console.error('⚠️ impersonate error:', e.message);
                return await interaction.reply({ content: '❌ Error setting up impersonation', ephemeral: true }).catch(() => {});
            }
        }

        if (commandName === 'stopimpersonate') {
            if (!isMod) return await interaction.reply({ content: 'staff/owner only', ephemeral: true }).catch(() => {});
            activeImpersonations.delete(interaction.channelId);
            return await interaction.reply({ content: '✅ Stopped impersonating', ephemeral: true }).catch(() => {});
        }

    } catch (e) {
        console.error('❌ INTERACTION ERROR:', e);
        try {
            await interaction.reply?.({ content: '❌ An error occurred', ephemeral: true }).catch(() => {});
        } catch {}
    }
});

// ─── MESSAGE HANDLER (for prefix commands and auto-responses) ─────
client.on('messageCreate', async (message) => {
    try {
        if (message.author?.bot) return;

        // Check impersonations
        const imp = activeImpersonations.get(message.channelId);
        if (imp && message.author?.id === OWNER_ID) {
            try {
                await impersonateReply(message.channelId, message.content);
                await message.delete().catch(() => {});
            } catch (e) {
                console.error('⚠️ impersonate reply error:', e.message);
            }
            return;
        }

        // Auto-responses
        const lowerContent = message.content?.toLowerCase?.() || '';
        for (const [trigger, response] of autoResponses) {
            if (lowerContent.includes(trigger)) {
                await message.reply(response).catch(() => {});
                return;
            }
        }
    } catch (e) {
        console.error('⚠️ message handler error:', e.message);
    }
});

// ─── CLIENT ERROR HANDLERS ────────────────────────────────────────
client.on('error', err => {
    console.error('❌ Discord Client Error:', err.message);
});

client.on('shardError', err => {
    console.error('❌ Discord Shard Error:', err.message);
});

// ─── LOGIN ───────────────────────────────────────────────────────
try {
    client.login(process.env.TOKEN || '').catch(err => {
        console.error('❌ LOGIN FAILED:', err.message);
        process.exit(1);
    });
} catch (e) {
    console.error('❌ LOGIN ERROR:', e.message);
    process.exit(1);
}

module.exports = { client, saveData, loadData };
