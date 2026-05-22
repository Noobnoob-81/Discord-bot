require('dotenv').config();
const fs = require('fs');
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
let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ===== DATA =====
const FILE = './data.json';
let data = { coins: {}, xp: {}, inventory: {} };

function loadData() {
    if (fs.existsSync(FILE)) {
        try {
            const loaded = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
            data.coins = loaded.coins || {};
            data.xp = loaded.xp || {};
            data.inventory = loaded.inventory || {};
            console.log('✅ Data loaded successfully');
        } catch (err) {
            console.error('❌ Failed to load data:', err.message);
        }
    }
}

function saveData() {
    try {
        fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Failed to save data:', err.message);
    }
}

loadData();
setInterval(saveData, 300000);

process.on('SIGINT', () => {
    console.log('💾 Saving data before shutdown...');
    saveData();
    process.exit(0);
});

// ===== HELPERS =====
const coins = (id) => data.coins[id] || 0;

const addCoins = (id, amount) => {
    data.coins[id] = Math.max(0, coins(id) + amount);
};

const addXP = (id) => data.xp[id] = (data.xp[id] || 0) + 10;

function xpForLevel(l) {
    return 5 * l * l + 50 * l + 100;
}

function getLevel(xp = 0) {
    let level = 0;
    let remaining = xp;
    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
    }
    return { level, xp: remaining, req: xpForLevel(level) };
}

function progressBar(current, max) {
    if (!max) return '██████████';
    const filled = Math.round((current / max) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ===== COOLDOWNS =====
const cooldowns = { daily: new Map(), ai: new Map(), boss: new Map() };
const xpCooldown = new Map();

// ===== SHOP =====
const shop = [
    { name: "Rusty Sword", dmg: 25, price: 500 },
    { name: "Shadow Blade", dmg: 80, price: 5000 },
    { name: "Galaxy Hammer", dmg: 150, price: 25000 }
];

// ===== BOSS & WORDLE =====
const bosses = new Map();
const wordles = new Map();

function spawnBoss(guildId) {
    bosses.set(guildId, { name: "🌌 Cosmic God", hp: 6000, max: 6000, rage: false });
}

function startWordle(guildId) {
    const WORDS = ['apple', 'tiger', 'zebra', 'ghost', 'flame', 'storm', 'light'];
    wordles.set(guildId, {
        word: WORDS[Math.floor(Math.random() * WORDS.length)],
        tries: []
    });
}

// ===== COMMANDS =====
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('pong'),
    new SlashCommandBuilder().setName('bal').setDescription('Check your coins'),
    new SlashCommandBuilder().setName('daily').setDescription('Claim daily reward'),
    new SlashCommandBuilder().setName('rank').setDescription('Check your level'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Top players by coins'),
    new SlashCommandBuilder().setName('shop').setDescription('View the shop'),
    new SlashCommandBuilder().setName('buy').setDescription('Buy an item').addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('Sell an item').addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),
    new SlashCommandBuilder().setName('inventory').setDescription('View your inventory'),
    new SlashCommandBuilder().setName('boss').setDescription('Fight the boss'),
    new SlashCommandBuilder().setName('wordle').setDescription('Guess the word').addStringOption(o => o.setName('guess').setDescription('Your 5-letter guess').setRequired(true)),
    new SlashCommandBuilder().setName('ai').setDescription('Ask the AI something').addStringOption(o => o.setName('prompt').setDescription('Your question').setRequired(true)),
    new SlashCommandBuilder().setName('ticketpanel').setDescription('Create ticket panel'),
    new SlashCommandBuilder().setName('applypanel').setDescription('Create mod application panel')
].map(c => c.toJSON());

// ===== READY =====
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);

    client.user.setPresence({ status: 'online', activities: [{ name: 'ULTIMATE BOT 😈', type: ActivityType.Playing }] });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    client.guilds.cache.forEach(guild => {
        if (!bosses.has(guild.id)) spawnBoss(guild.id);
        if (!wordles.has(guild.id)) startWordle(guild.id);
    });

    console.log('🚀 All systems initialized!');
});

// ===== XP SYSTEM =====
client.on('messageCreate', msg => {
    if (msg.author.bot) return;

    const now = Date.now();
    if (xpCooldown.has(msg.author.id) && now - xpCooldown.get(msg.author.id) < 60000) return;

    xpCooldown.set(msg.author.id, now);

    const before = data.xp[msg.author.id] || 0;
    addXP(msg.author.id);
    const after = data.xp[msg.author.id];

    if (getLevel(after).level > getLevel(before).level) {
        addCoins(msg.author.id, 500);
        msg.channel.send(`🎉 ${msg.author} leveled up! +500 coins`);
    }
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const { user, guild, commandName, member } = interaction;
    const id = user.id;
    const guildId = guild?.id;

    if (interaction.isChatInputCommand()) {

        if (commandName === 'ping') return interaction.reply('🏓 pong');

        if (commandName === 'bal') {
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('💰 Balance')
                .setDescription(`**${coins(id)}** coins`);
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'daily') {
            const last = cooldowns.daily.get(id);
            if (last && Date.now() - last < 86400000) return interaction.reply({ content: '⏳ You already claimed today!', ephemeral: true });
            cooldowns.daily.set(id, Date.now());
            addCoins(id, 500);
            saveData(); // Auto-save after economy action
            return interaction.reply('💸 **+500 coins** added!');
        }

        if (commandName === 'rank') {
            const info = getLevel(data.xp[id] || 0);
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`Level ${info.level}`)
                .setDescription(progressBar(info.xp, info.req));
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'leaderboard') {
            const top = Object.entries(data.coins)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([uid, amount], i) => `**#\( {i + 1}** <@ \){uid}> — 💰 **${amount}**`)
                .join('\n');
            return interaction.reply(top || 'No players yet.');
        }

        if (commandName === 'shop') {
            return interaction.reply(shop.map(s => `**${s.name}** — ⚔️ ${s.dmg} DMG — 💰 ${s.price}`).join('\n'));
        }

        if (commandName === 'buy') {
            const itemName = interaction.options.getString('item').toLowerCase();
            const item = shop.find(i => i.name.toLowerCase() === itemName);
            if (!item) return interaction.reply({ content: '❌ Item not found!', ephemeral: true });
            if (coins(id) < item.price) return interaction.reply({ content: '❌ Not enough coins!', ephemeral: true });

            addCoins(id, -item.price);
            if (!data.inventory[id]) data.inventory[id] = [];
            data.inventory[id].push({ ...item }); // Deep copy to prevent reference issues
            saveData(); // Auto-save
            return interaction.reply(`🛒 Bought **${item.name}**!`);
        }

        if (commandName === 'sell') {
            const itemName = interaction.options.getString('item').toLowerCase();
            const inv = data.inventory[id] || [];
            const index = inv.findIndex(i => i.name.toLowerCase() === itemName);
            if (index === -1) return interaction.reply({ content: '❌ You don\'t own that item!', ephemeral: true });

            const item = inv.splice(index, 1)[0];
            const sellPrice = Math.floor(item.price * 0.6);
            addCoins(id, sellPrice);
            saveData(); // Auto-save
            return interaction.reply(`💰 Sold **\( {item.name}** for ** \){sellPrice}** coins!`);
        }

        if (commandName === 'inventory') {
            const inv = data.inventory[id] || [];
            return interaction.reply(inv.length ? `**Inventory:**\n${inv.map(i => `• \( {i.name} (⚔️ \){i.dmg})`).join('\n')}` : 'Empty.');
        }

        if (commandName === 'boss') {
            if (!guildId) return interaction.reply('Server only.');
            const last = cooldowns.boss.get(id);
            if (last && Date.now() - last < 30000) return interaction.reply({ content: '⏳ 30s cooldown!', ephemeral: true });
            cooldowns.boss.set(id, Date.now());

            let boss = bosses.get(guildId) || (spawnBoss(guildId), bosses.get(guildId));
            const inv = data.inventory[id] || [];
            const bestWeapon = [...inv].sort((a, b) => b.dmg - a.dmg)[0];
            let damage = (bestWeapon?.dmg || 20) + Math.floor(Math.random() * 51);

            if (boss.hp < boss.max / 2 && !boss.rage) {
                boss.rage = true;
                damage = Math.floor(damage * 0.6);
            }

            boss.hp -= damage;
            addCoins(id, Math.floor(damage / 2));
            saveData(); // Auto-save after boss reward

            if (boss.hp <= 0) {
                spawnBoss(guildId);
                return interaction.reply(`🎊 **Boss defeated!** +${Math.floor(damage / 2)} coins`);
            }
            return interaction.reply(`⚔️ **${damage}** damage!\n**Boss HP:** \( {boss.hp}/ \){boss.max}`);
        }

        if (commandName === 'wordle') {
            if (!guildId) return interaction.reply('Server only.');
            const guess = interaction.options.getString('guess').toLowerCase().trim();
            if (guess.length !== 5) return interaction.reply({ content: '❌ Must be 5 letters!', ephemeral: true });

            let game = wordles.get(guildId) || (startWordle(guildId), wordles.get(guildId));
            game.tries.push(guess);

            if (guess === game.word) {
                startWordle(guildId);
                return interaction.reply('🟩 **You won!**');
            }
            if (game.tries.length >= 6) {
                startWordle(guildId);
                return interaction.reply(`❌ Game over! Word was **${game.word}**`);
            }
            return interaction.reply(`❌ Wrong! (${game.tries.length}/6)`);
        }

        if (commandName === 'ai') {
            if (!openai) return interaction.reply('❌ AI not available.');
            const prompt = interaction.options.getString('prompt');
            if (prompt.length > 500) return interaction.reply({ content: '❌ Prompt too long! (max 500 chars)', ephemeral: true });

            const last = cooldowns.ai.get(id);
            if (last && Date.now() - last < 10000) return interaction.reply({ content: '⏳ 10s cooldown!', ephemeral: true });
            cooldowns.ai.set(id, Date.now());

            await interaction.deferReply();
            try {
                const res = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 500
                });
                const content = res?.choices?.[0]?.message?.content?.trim();
                await interaction.editReply(content ? content.slice(0, 1990) : '❌ No response.');
            } catch {
                await interaction.editReply('❌ AI error.');
            }
        }

        if (['ticketpanel', 'applypanel'].includes(commandName)) {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Administrator only!', ephemeral: true });
            }
        }

        if (commandName === 'ticketpanel') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary)
            );
            return interaction.reply({ content: 'Click to open a ticket:', components: [row] });
        }

        if (commandName === 'applypanel') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('apply').setLabel('📋 Apply for Mod').setStyle(ButtonStyle.Success)
            );
            return interaction.reply({ content: 'Click to apply:', components: [row] });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'ticket') {
            const ticketName = `ticket-${user.id}`;
            const existing = guild.channels.cache.find(c => c.name === ticketName);
            if (existing) return interaction.reply({ content: '❌ You already have an open ticket!', ephemeral: true });

            try {
                const channel = await guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ]
                });
                await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
            } catch {
                await interaction.reply({ content: '❌ Failed to create ticket.', ephemeral: true });
            }
        }

        if (interaction.customId === 'apply') {
            await interaction.reply({
                content: '📋 **Mod Application**\nWhy should you be moderator?',
                ephemeral: true
            });
        }
    }
});

// ===== LOGIN =====
client.login(process.env.TOKEN).catch(err => console.error('❌ Login failed:', err.message));
