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
setInterval(saveData, 5 * 60 * 1000); // auto-save every 5 min

// ─── OPENAI CLIENT (Replit AI proxy) ─────────────────────────────
const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

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
    const result  = Array(5).fill('⬛');
    const wordArr = word.split('');
    const used    = Array(5).fill(false);
    const gArr    = guess.split('');
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
    const embed = new EmbedBuilder().setTitle('🟩 Wordle').setColor(finished === 'win' ? 0x57F287 : finished === 'lose' ? 0xFF4444 : 0x7289DA);
    let board = '';
    for (const { guess, result } of game.guesses) {
        board += result.join('') + '  ' + guess.toUpperCase().split('').join(' ') + '\n';
    }
    embed.setDescription(board || '');
    embed.addFields({ name: `Guess ${game.guesses.length}/${game.maxGuesses}`, value: lastResult ? lastResult.join('') + ' — **' + lastGuess.toUpperCase() + '**' : 'Game started! Use `/wordle guess:<word>`' });
    if (finished === 'win')  embed.setFooter({ text: `🎉 Solved in ${game.guesses.length} guess${game.guesses.length === 1 ? '' : 'es'}!` });
    if (finished === 'lose') embed.setFooter({ text: `The word was: ${game.word.toUpperCase()}` });
    return embed;
}

// ─── IMPERSONATE STATE ───────────────────────────────────────────
// channelId → { userId, username, avatarUrl, webhookId, webhookToken }
const activeImpersonations = new Map();

async function impersonateReply(channelId, text) {
    const imp = activeImpersonations.get(channelId);
    if (!imp) return;
    try {
        const wh = new (require('discord.js').WebhookClient)({ id: imp.webhookId, token: imp.webhookToken });
        await wh.send({ content: text, username: imp.username, avatarURL: imp.avatarUrl });
        wh.destroy();
    } catch (e) { console.error('webhook send fail:', e.message); }
}

// ─── CONSTANTS ───────────────────────────────────────────────────
const PREFIX   = process.env.PREFIX;
const OWNER_ID = '1340069836096667859';
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
            if (Math.random() < 0.3) {
                addCoins(attackerId, -50);
                saveData();
                await channel.send(`👹 **Shadow Demon** strikes back! <@${attackerId}> loses 50 coins 💸`);
            }
        }
    },
    {
        name: 'Cosmic God', emoji: '🌌', maxHealth: 6000, rewardMult: 6,
        description: '6000 HP. Enters RAGE at 50% HP — all damage is halved.',
        onHit: async (channel, attackerId, bossRef) => {
            if (!bossRef.raging && bossRef.health <= bossRef.maxHealth / 2) {
                bossRef.raging = true;
                await channel.send(`🌌 **Cosmic God** enters **RAGE MODE** — all damage is now halved! 😱`);
            }
        }
    }
];

// ─── ARCANE LEVEL SYSTEM ─────────────────────────────────────────
// Mirrors Arcane/MEE6: XP to reach next level = 5*N^2 + 50*N + 100
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
    console.log(`${client.user.tag} is online fr`);

    client.user.setPresence({
        status: 'online',
        activities: [{ name: '!help | /start', type: ActivityType.Watching }]
    });

    for (const guild of client.guilds.cache.values()) {
        const channel =
            guild.systemChannel ||
            guild.channels.cache
                .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'))
                .first();
        if (channel) channel.send('Hi Guysssss I am Online and ready to work (:').catch(() => {});
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log('slash commands registered');
    } catch (e) { console.error('slash reg failed:', e.message); }
});

// ─── INTERACTION HANDLER (commands + modals) ─────────────────────
client.on('interactionCreate', async (interaction) => {
    const isOwner = interaction.user.id === OWNER_ID;
    const isStaff = staffSet.has(interaction.user.id);
    const isMod   = isOwner || isStaff;

    // ── modal submissions ──
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('welcome_modal_')) {
            const guildId = interaction.customId.replace('welcome_modal_', '');
            const message  = interaction.fields.getTextInputValue('welcome_msg');
            const imageUrl = interaction.fields.getTextInputValue('welcome_img').trim() || null;

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
            return interaction.reply({ embeds: [preview], ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'ping') return interaction.reply('pong fr');

    if (commandName === 'help') {
        return interaction.reply(
            '**Slash commands:** `/ping` `/bal` `/rank` `/shop` `/coinflip` `/8ball` `/bossstatus` `/leaderboard` `/warnings` `/start`\n\n' +
            '**Prefix commands:** `!guess` `!daily` `!rob` `!fight` `!bossfight` `!buy` `!level`\n' +
            '**Anime:** `!domain` `!hollow` `!infinity` `!unleash` `!bankai` `!gear5` `!sharingan` `!attackontitan`\n' +
            '**Fun:** `!ragebait successful` / `!ragebait`\n' +
            '**Fake (members):** `?ban` `?kick` `?mute` `?hack` `?nuke`'
        );
    }

    if (commandName === 'bal')
        return interaction.reply(`${coins.get(interaction.user.id) || 0} coins`);

    if (commandName === 'rank') {
        const info = getLevelInfo(xp.get(interaction.user.id));
        const bar = buildHpBar(info.xpInLevel, info.xpRequired);
        const embed = new EmbedBuilder()
            .setColor(0x7289DA)
            .setTitle(`⭐ ${interaction.user.username}'s Rank`)
            .addFields(
                { name: 'Level', value: `**${info.level}**`, inline: true },
                { name: 'Total XP', value: `**${info.totalXP}**`, inline: true },
                { name: 'XP to next level', value: `**${info.xpInLevel} / ${info.xpRequired}**`, inline: true }
            )
            .setDescription(`Progress: ${bar}`)
            .setThumbnail(interaction.user.displayAvatarURL());
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'shop') {
        let text = '**Shop:**\n';
        shop.forEach((item, i) => { text += `${i + 1}. **${item.name}** — ${item.price} coins (${item.damage} dmg)\n`; });
        return interaction.reply(text);
    }

    if (commandName === 'coinflip') return interaction.reply(Math.random() < 0.5 ? 'heads' : 'tails');

    if (commandName === '8ball') {
        const replies = ['yes', 'no', 'maybe', 'ask later'];
        return interaction.reply(replies[Math.floor(Math.random() * replies.length)]);
    }

    if (commandName === 'bossstatus') {
        if (!boss) return interaction.reply('no boss active right now');
        const bar = buildHpBar(boss.health, boss.maxHealth);
        return interaction.reply(`${boss.emoji} **${boss.name}** HP: ${bar} ${boss.health}/${boss.maxHealth}${boss.raging ? ' 🔥 RAGING' : ''}`);
    }

    if (commandName === 'leaderboard') {
        const sorted = [...coins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (!sorted.length) return interaction.reply('nobody has coins yet');
        let text = '**Leaderboard:**\n';
        sorted.forEach((u, i) => { text += `${i + 1}. <@${u[0]}> — ${u[1]}\n`; });
        return interaction.reply(text);
    }

    if (commandName === 'warnings')
        return interaction.reply(`${warnings.get(interaction.user.id) || 0} warnings`);

    if (commandName === 'start') {
        const ms = Date.now() - startTime;
        const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
        return interaction.reply(`✅ **Bot is online!**\nUptime: ${h}h ${m}m ${s}s\nPing: ${client.ws.ping}ms`);
    }

    // ── owner-only slash commands ──
    if (commandName === 'addstaff') {
        if (!isOwner) return interaction.reply({ content: 'owner only', ephemeral: true });
        const user = interaction.options.getUser('user');
        if (user.id === OWNER_ID) return interaction.reply({ content: "that's you lol", ephemeral: true });
        staffSet.add(user.id);
        saveData();
        return interaction.reply({ content: `✅ **${user.tag}** is now staff 🛡️`, ephemeral: true });
    }

    if (commandName === 'removestaff') {
        if (!isOwner) return interaction.reply({ content: 'owner only', ephemeral: true });
        const user = interaction.options.getUser('user');
        staffSet.delete(user.id);
        saveData();
        return interaction.reply({ content: `🗑️ Removed staff from **${user.tag}**`, ephemeral: true });
    }

    if (commandName === 'liststaff') {
        if (!isOwner) return interaction.reply({ content: 'owner only', ephemeral: true });
        if (!staffSet.size) return interaction.reply({ content: 'no staff yet', ephemeral: true });
        const list = [...staffSet].map(id => `<@${id}>`).join('\n');
        return interaction.reply({ content: `**Staff members:**\n${list}`, ephemeral: true });
    }

    if (commandName === 'addresponse') {
        if (!isOwner) return interaction.reply({ content: 'owner only', ephemeral: true });
        const trigger = interaction.options.getString('trigger').toL
