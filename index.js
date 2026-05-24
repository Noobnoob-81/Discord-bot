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
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

// ─── CONFIG ──────────────────────────────────────────────
const PREFIX = '!';
const OWNER_ID = '1340069836096667859';
const DATA_FILE = path.join(__dirname, 'data.json');

// ─── CRASH PREVENTION: TRY-CATCH FOR ALL ASYNC OPS ─────
// ─── DATA STORAGE ─────────────────────────────────────────
const warnings = new Map();
const xp = new Map();
const coins = new Map();
const weapons = new Map();
const staffSet = new Set();
const autoResponses = new Map();
let welcomeConfig = {};
let logsConfig = {};
let boss = null;

// ─── FNF GAME STATE ──────────────────────────────────────
const fnfGames = new Map(); // userId → { score, streak, notes: [], current: 0 }

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('📝 No data file, will create on save');
            return;
        }
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw?.warnings) for (const [k, v] of Object.entries(raw.warnings)) warnings.set(k, v);
        if (raw?.xp) for (const [k, v] of Object.entries(raw.xp)) xp.set(k, v);
        if (raw?.coins) for (const [k, v] of Object.entries(raw.coins)) coins.set(k, v);
        if (raw?.weapons) for (const [k, v] of Object.entries(raw.weapons)) weapons.set(k, v);
        if (raw?.staff) for (const id of raw.staff) staffSet.add(id);
        if (raw?.autoResponses) for (const [k, v] of Object.entries(raw.autoResponses)) autoResponses.set(k, v);
        if (raw?.welcomeConfig) welcomeConfig = raw.welcomeConfig;
        if (raw?.logsConfig) logsConfig = raw.logsConfig;
        console.log('✅ Data loaded');
    } catch (e) {
        console.error('❌ Load error:', e?.message);
    }
}

function saveData() {
    try {
        const data = {
            warnings: Object.fromEntries(warnings),
            xp: Object.fromEntries(xp),
            coins: Object.fromEntries(coins),
            weapons: Object.fromEntries(weapons),
            staff: [...staffSet],
            autoResponses: Object.fromEntries(autoResponses),
            welcomeConfig,
            logsConfig
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Save error:', e?.message);
    }
}

loadData();
setInterval(saveData, 300000); // Auto-save every 5 min

// ─── SHOP ────────────────────────────────────────────────
const shop = [
    { name: 'Rusty Sword', damage: 25, price: 500, rarity: 'Common' },
    { name: 'Shadow Blade', damage: 80, price: 5000, rarity: 'Rare' },
    { name: 'Galaxy Hammer', damage: 150, price: 25000, rarity: 'Legendary' }
];

// ─── LEVEL SYSTEM ────────────────────────────────────────
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

function buildBar(current, max) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ─── FNF RHYTHM GAME ─────────────────────────────────────
const FNF_NOTES = ['⬅️', '⬇️', '⬆️', '➡️'];

function generateFNFChart(difficulty = 'easy') {
    const count = difficulty === 'easy' ? 5 : difficulty === 'hard' ? 15 : 10;
    const chart = [];
    for (let i = 0; i < count; i++) {
        chart.push(FNF_NOTES[Math.floor(Math.random() * 4)]);
    }
    return chart;
}

function evaluateFNFHit(playerNote, correctNote) {
    if (playerNote === correctNote) return { rating: 'Perfect!', points: 100 };
    if (FNF_NOTES.indexOf(playerNote) !== -1) return { rating: 'Good!', points: 50 };
    return { rating: 'Missed!', points: 0 };
}

// ─── SLASH COMMANDS ──────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder().setName('help').setDescription('List all commands'),
    new SlashCommandBuilder().setName('bal').setDescription('Check your coins'),
    new SlashCommandBuilder().setName('rank').setDescription('Check your level'),
    new SlashCommandBuilder().setName('profile').setDescription('View your profile'),
    new SlashCommandBuilder().setName('shop').setDescription('View the shop'),
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy an item')
        .addStringOption(o => o.setName('item').setRequired(true).setDescription('Item name')),
    new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell an item')
        .addStringOption(o => o.setName('item').setRequired(true).setDescription('Item name')),
    new SlashCommandBuilder().setName('bossfight').setDescription('Fight the boss'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Top 5 richest players'),
    new SlashCommandBuilder().setName('fnf').setDescription('Play Friday Night Funkin!'),
    new SlashCommandBuilder()
        .setName('addxp')
        .setDescription('Add XP to user (staff)')
        .addUserOption(o => o.setName('user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder()
        .setName('addcoins')
        .setDescription('Add coins to user (staff)')
        .addUserOption(o => o.setName('user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setRequired(true)),
].map(c => c.toJSON());

// ─── CLIENT SETUP ────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const startTime = Date.now();

client.once('ready', async () => {
    try {
        console.log(`✅ Bot online as ${client.user?.tag}`);

        if (!process.env.TOKEN) {
            console.error('❌ TOKEN not set');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands }).catch(e => {
            console.error('⚠️ Command registration error:', e?.message);
        });
        console.log('✅ Slash commands registered');

        // Announce online
        for (const guild of client.guilds.cache.values()) {
            const channel = guild.systemChannel || guild.channels.cache
                .filter(c => c.isTextBased())
                .first();
            if (channel) {
                try {
                    await channel.send('🤖 **Bot Online!** Type `!help` or `/help`').catch(() => {});
                } catch (e) {
                    console.error('Announce error:', e?.message);
                }
            }
        }
    } catch (e) {
        console.error('❌ Ready error:', e?.message);
    }
});

// ─── SLASH COMMAND HANDLER ───────────────────────────────
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        const userId = interaction.user?.id;
        if (!userId) return;

        const isOwner = userId === OWNER_ID;
        const isStaff = staffSet.has(userId) || isOwner;

        try {
            // PING
            if (interaction.commandName === 'ping') {
                await interaction.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });
                return;
            }

            // HELP
            if (interaction.commandName === 'help') {
                const embed = new EmbedBuilder()
                    .setColor(0x00ff88)
                    .setTitle('🤖 Bot Commands')
                    .setDescription('**Slash Commands:**\n`/ping` `/bal` `/rank` `/profile` `/shop` `/buy` `/sell` `/bossfight` `/leaderboard` `/fnf` `/addxp` `/addcoins`\n\n**Prefix Commands (use !):**\n`!daily` `!rob` `!fight` `!steal` `!gamble` `!fnf`');
                await interaction.reply({ embeds: [embed] });
                return;
            }

            // BAL
            if (interaction.commandName === 'bal') {
                const balance = coins.get(userId) || 0;
                await interaction.reply({ content: `💰 **${balance}** coins`, ephemeral: true });
                return;
            }

            // RANK
            if (interaction.commandName === 'rank') {
                const info = getLevelInfo(xp.get(userId));
                const bar = buildBar(info.xpInLevel, info.xpRequired);
                await interaction.reply({
                    content: `**Level ${info.level}**\n${bar} (${info.xpInLevel}/${info.xpRequired})`,
                    ephemeral: true
                });
                return;
            }

            // PROFILE
            if (interaction.commandName === 'profile') {
                const userCoins = coins.get(userId) || 0;
                const info = getLevelInfo(xp.get(userId));
                const inv = weapons.get(userId) || [];
                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle(`${interaction.user?.username}'s Profile`)
                    .setThumbnail(interaction.user?.displayAvatarURL())
                    .addFields(
                        { name: 'Coins', value: `**${userCoins}**`, inline: true },
                        { name: 'Level', value: `**${info.level}**`, inline: true },
                        { name: 'Inventory', value: inv.length ? inv.map(w => `• ${w?.name} (${w?.rarity})`).join('\n') : 'Empty' }
                    );
                await interaction.reply({ embeds: [embed] });
                return;
            }

            // SHOP
            if (interaction.commandName === 'shop') {
                let text = '**🛍️ Shop:**\n\n';
                shop.forEach(i => {
                    text += `**${i.name}** — 💰 ${i.price} — ⚔️ ${i.damage} — ${i.rarity}\n`;
                });
                text += '\nUse `/buy <item>` to purchase!';
                await interaction.reply({ content: text, ephemeral: true });
                return;
            }

            // BUY
            if (interaction.commandName === 'buy') {
                const itemName = interaction.options?.getString('item')?.toLowerCase() || '';
                const item = shop.find(i => i.name.toLowerCase() === itemName);
                if (!item) {
                    await interaction.reply({ content: '❌ Item not found', ephemeral: true });
                    return;
                }

                const userCoins = coins.get(userId) || 0;
                if (userCoins < item.price) {
                    await interaction.reply({ content: `❌ Not enough coins (need ${item.price}, have ${userCoins})`, ephemeral: true });
                    return;
                }

                coins.set(userId, userCoins - item.price);
                if (!weapons.has(userId)) weapons.set(userId, []);
                weapons.get(userId).push({ ...item });
                saveData();
                await interaction.reply({ content: `✅ Bought **${item.name}** for **${item.price}** coins!`, ephemeral: true });
                return;
            }

            // SELL
            if (interaction.commandName === 'sell') {
                const itemName = interaction.options?.getString('item')?.toLowerCase() || '';
                const inv = weapons.get(userId) || [];
                const index = inv.findIndex(i => i?.name?.toLowerCase() === itemName);
                if (index === -1) {
                    await interaction.reply({ content: '❌ You don\'t have that item', ephemeral: true });
                    return;
                }

                const item = inv.splice(index, 1)[0];
                const sellPrice = Math.max(1, Math.floor(item.price * 0.6));
                coins.set(userId, (coins.get(userId) || 0) + sellPrice);
                saveData();
                await interaction.reply({ content: `💰 Sold **${item.name}** for **${sellPrice}** coins!`, ephemeral: true });
                return;
            }

            // BOSSFIGHT
            if (interaction.commandName === 'bossfight') {
                if (!boss) {
                    boss = { name: '👹 Shadow Demon', health: 3000, maxHealth: 3000 };
                }
                const inv = weapons.get(userId) || [];
                const best = inv.sort((a, b) => (b?.damage || 0) - (a?.damage || 0))[0] || { damage: 20 };
                const damage = Math.max(1, best.damage + Math.floor(Math.random() * 50));

                boss.health -= damage;
                coins.set(userId, (coins.get(userId) || 0) + Math.floor(damage / 2));
                saveData();

                if (boss.health <= 0) {
                    const reward = Math.floor(damage * 2);
                    coins.set(userId, (coins.get(userId) || 0) + reward);
                    saveData();
                    boss = null;
                    await interaction.reply({ content: `🎊 **Boss defeated!** Earned **${reward}** coins!` });
                    return;
                }
                const bar = buildBar(boss.health, boss.maxHealth);
                await interaction.reply({ content: `⚔️ Dealt **${damage}** damage!\n${boss.name} HP: ${bar} ${boss.health}/${boss.maxHealth}` });
                return;
            }

            // LEADERBOARD
            if (interaction.commandName === 'leaderboard') {
                const top = [...coins.entries()]
                    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                    .slice(0, 5)
                    .map(([id, amt], i) => `**#${i + 1}** <@${id}> — 💰 **${amt}**`)
                    .join('\n');
                await interaction.reply({ content: top || 'No players yet' });
                return;
            }

            // FNF SLASH COMMAND
            if (interaction.commandName === 'fnf') {
                const chart = generateFNFChart('easy');
                const game = { score: 0, streak: 0, notes: chart, current: 0 };
                fnfGames.set(userId, game);

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('fnf_left').setLabel('⬅️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_down').setLabel('⬇️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_up').setLabel('⬆️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_right').setLabel('➡️').setStyle(ButtonStyle.Primary)
                );

                const nextNote = chart[0];
                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle('🎵 Friday Night Funkin\'')
                    .setDescription(`**Current Note:** ${nextNote}\n\n**Score:** ${game.score}\n**Streak:** ${game.streak}`)
                    .setFooter({ text: `Note 1/${chart.length}` });

                const msg = await interaction.reply({ embeds: [embed], components: [buttons], fetchReply: true });

                const collector = msg.createMessageComponentCollector({ time: 30000 });
                let hitThisNote = false;

                collector.on('collect', async btn => {
                    if (btn.user.id !== userId) {
                        await btn.reply({ content: 'This is not your game!', ephemeral: true });
                        return;
                    }

                    const noteMap = { fnf_left: '⬅️', fnf_down: '⬇️', fnf_up: '⬆️', fnf_right: '➡️' };
                    const playerNote = noteMap[btn.customId];
                    const expected = chart[game.current];

                    if (playerNote === expected && !hitThisNote) {
                        hitThisNote = true;
                        game.score += 100;
                        game.streak++;
                        game.current++;

                        if (game.current >= chart.length) {
                            coins.set(userId, (coins.get(userId) || 0) + game.score);
                            xp.set(userId, (xp.get(userId) || 0) + game.score);
                            saveData();
                            fnfGames.delete(userId);
                            collector.stop();

                            const winEmbed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('🎊 Song Complete!')
                                .addFields(
                                    { name: 'Final Score', value: `**${game.score}**`, inline: true },
                                    { name: 'Coins Earned', value: `**${game.score}**`, inline: true },
                                    { name: 'XP Earned', value: `**${game.score}**`, inline: true }
                                );
                            await msg.edit({ embeds: [winEmbed], components: [] });
                            return;
                        }

                        hitThisNote = false;
                        const updatedEmbed = new EmbedBuilder()
                            .setColor(0xff00ff)
                            .setTitle('🎵 Friday Night Funkin\'')
                            .setDescription(`**Current Note:** ${chart[game.current]}\n\n**Score:** ${game.score}\n**Streak:** ${game.streak}`)
                            .setFooter({ text: `Note ${game.current + 1}/${chart.length}` });
                        await msg.edit({ embeds: [updatedEmbed] });
                    } else {
                        game.streak = 0;
                        coins.set(userId, Math.max(0, (coins.get(userId) || 0) - 50));
                        saveData();
                    }

                    await btn.deferUpdate().catch(() => {});
                });

                collector.on('end', async () => {
                    if (fnfGames.has(userId)) {
                        fnfGames.delete(userId);
                        const finalEmbed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('💔 Game Over!')
                            .setDescription(`Final Score: **${game.score}**`);
                        await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
                    }
                });
                return;
            }

            // ADDXP
            if (interaction.commandName === 'addxp') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const target = interaction.options?.getUser('user');
                const amount = interaction.options?.getInteger('amount');
                if (!target || !amount) return;

                xp.set(target.id, (xp.get(target.id) || 0) + amount);
                saveData();
                await interaction.reply({ content: `✅ Added **${amount}** XP to <@${target.id}>`, ephemeral: true });
                return;
            }

            // ADDCOINS
            if (interaction.commandName === 'addcoins') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const target = interaction.options?.getUser('user');
                const amount = interaction.options?.getInteger('amount');
                if (!target || !amount) return;

                coins.set(target.id, (coins.get(target.id) || 0) + amount);
                saveData();
                await interaction.reply({ content: `✅ Added **${amount}** coins to <@${target.id}>`, ephemeral: true });
                return;
            }

        } catch (cmdErr) {
            console.error('❌ Command error:', cmdErr?.message);
            try {
                if (!interaction.replied) {
                    await interaction.reply({ content: '❌ Command failed', ephemeral: true });
                }
            } catch (e) {
                console.error('Failed to send error:', e?.message);
            }
        }

    } catch (mainErr) {
        console.error('❌ Interaction error:', mainErr?.message);
    }
});

// ─── PREFIX COMMANDS ─────────────────────────────────────
const cooldowns = new Map();

client.on('messageCreate', async message => {
    try {
        if (!message.content.startsWith(PREFIX) || message.author.bot) return;

        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();
        const userId = message.author.id;
        const isOwner = userId === OWNER_ID;
        const isStaff = staffSet.has(userId) || isOwner;

        try {
            // !help
            if (cmd === 'help') {
                const embed = new EmbedBuilder()
                    .setColor(0x00ff88)
                    .setTitle('📖 Bot Help')
                    .addFields(
                        { name: 'Economy', value: '`!daily` `!rob` `!gamble`', inline: true },
                        { name: 'Games', value: '`!fnf` `!fight` `!steal`', inline: true },
                        { name: 'Info', value: '`!bal` `!rank` `!profile`', inline: true }
                    );
                return message.reply({ embeds: [embed] });
            }

            // !daily
            if (cmd === 'daily') {
                const lastDaily = cooldowns.get(`daily_${userId}`);
                const now = Date.now();
                if (lastDaily && now - lastDaily < 86400000) {
                    return message.reply('⏰ Daily already claimed! Come back tomorrow.');
                }

                const reward = Math.floor(Math.random() * 500) + 200;
                coins.set(userId, (coins.get(userId) || 0) + reward);
                xp.set(userId, (xp.get(userId) || 0) + 50);
                cooldowns.set(`daily_${userId}`, now);
                saveData();

                return message.reply(`💰 **+${reward}** coins and **+50 XP**!`);
            }

            // !rob
            if (cmd === 'rob') {
                const target = message.mentions.first();
                if (!target) return message.reply('❌ Mention someone to rob!');

                const targetCoins = coins.get(target.id) || 0;
                if (targetCoins < 100) return message.reply('❌ Target has less than 100 coins!');

                const stolen = Math.floor(Math.random() * targetCoins * 0.5);
                coins.set(target.id, targetCoins - stolen);
                coins.set(userId, (coins.get(userId) || 0) + stolen);
                saveData();

                return message.reply(`💰 Robbed **${target.username}** for **${stolen}** coins!`);
            }

            // !gamble
            if (cmd === 'gamble') {
                const amount = parseInt(args[0]) || 100;
                const userCoins = coins.get(userId) || 0;
                if (userCoins < amount) return message.reply('❌ Not enough coins!');

                const won = Math.random() > 0.5;
                if (won) {
                    coins.set(userId, userCoins + amount);
                    saveData();
                    return message.reply(`🎰 You won! **+${amount}** coins!`);
                } else {
                    coins.set(userId, userCoins - amount);
                    saveData();
                    return message.reply(`🎰 You lost! **-${amount}** coins!`);
                }
            }

            // !fight
            if (cmd === 'fight') {
                const target = message.mentions.first();
                if (!target) return message.reply('❌ Mention someone to fight!');

                const p1Dmg = Math.floor(Math.random() * 50) + 10;
                const p2Dmg = Math.floor(Math.random() * 50) + 10;
                const winner = p1Dmg > p2Dmg ? message.author : target;

                coins.set(winner.id, (coins.get(winner.id) || 0) + 100);
                saveData();

                return message.reply(`⚔️ **${message.author.username}** (${p1Dmg}) vs **${target.username}** (${p2Dmg})\n🏆 ${winner.username} wins **100 coins**!`);
            }

            // !steal
            if (cmd === 'steal') {
                const target = message.mentions.first();
                if (!target) return message.reply('❌ Mention someone!');

                const inv = weapons.get(target.id) || [];
                if (!inv.length) return message.reply('❌ They have no weapons!');

                const stolen = inv.splice(Math.floor(Math.random() * inv.length), 1)[0];
                if (!weapons.has(userId)) weapons.set(userId, []);
                weapons.get(userId).push(stolen);
                saveData();

                return message.reply(`🗡️ Stole **${stolen.name}** from **${target.username}**!`);
            }

            // !fnf
            if (cmd === 'fnf') {
                const chart = generateFNFChart('hard');
                const game = { score: 0, streak: 0, notes: chart, current: 0 };
                fnfGames.set(userId, game);

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`fnf_p_left_${userId}`).setLabel('⬅️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_down_${userId}`).setLabel('⬇️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_up_${userId}`).setLabel('⬆️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_right_${userId}`).setLabel('➡️').setStyle(ButtonStyle.Primary)
                );

                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle('🎵 FNF Rhythm Battle')
                    .setDescription(`**Current:** ${chart[0]}\n**Score:** 0 | **Streak:** 0`)
                    .setFooter({ text: 'Note 1/' + chart.length });

                const msg = await message.reply({ embeds: [embed], components: [buttons] });

                const collector = msg.createMessageComponentCollector({ time: 60000 });
                let hitThisNote = false;

                collector.on('collect', async btn => {
                    if (btn.user.id !== userId) {
                        await btn.reply({ content: 'Not your game!', ephemeral: true });
                        return;
                    }

                    const noteMap = { [`fnf_p_left_${userId}`]: '⬅️', [`fnf_p_down_${userId}`]: '⬇️', [`fnf_p_up_${userId}`]: '⬆️', [`fnf_p_right_${userId}`]: '➡️' };
                    const playerNote = noteMap[btn.customId];
                    const expected = chart[game.current];

                    if (playerNote === expected && !hitThisNote) {
                        hitThisNote = true;
                        game.score += 100;
                        game.streak++;
                        game.current++;

                        if (game.current >= chart.length) {
                            coins.set(userId, (coins.get(userId) || 0) + game.score);
                            xp.set(userId, (xp.get(userId) || 0) + game.score);
                            saveData();
                            fnfGames.delete(userId);
                            collector.stop();

                            const win = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('🎊 Perfect!')
                                .setDescription(`**Score:** ${game.score}\n**Coins:** +${game.score}\n**XP:** +${game.score}`);
                            await msg.edit({ embeds: [win], components: [] });
                            return;
                        }

                        hitThisNote = false;
                        const upd = new EmbedBuilder()
                            .setColor(0xff00ff)
                            .setTitle('🎵 FNF Rhythm Battle')
                            .setDescription(`**Current:** ${chart[game.current]}\n**Score:** ${game.score} | **Streak:** ${game.streak}`)
                            .setFooter({ text: `Note ${game.current + 1}/${chart.length}` });
                        await msg.edit({ embeds: [upd] });
                    } else {
                        game.streak = 0;
                    }

                    await btn.deferUpdate().catch(() => {});
                });

                collector.on('end', async () => {
                    if (fnfGames.has(userId)) {
                        fnfGames.delete(userId);
                        const end = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('💔 Failed')
                            .setDescription(`Final Score: ${game.score}`);
                        await msg.edit({ embeds: [end], components: [] }).catch(() => {});
                    }
                });
                return;
            }

        } catch (err) {
            console.error('❌ Prefix command error:', err?.message);
            try {
                message.reply('❌ Command failed').catch(() => {});
            } catch (e) {
                console.error('Failed to reply:', e?.message);
            }
        }

    } catch (msgErr) {
        console.error('❌ Message error:', msgErr?.message);
    }
});

// ─── ERROR HANDLERS ──────────────────────────────────────
process.on('unhandledRejection', err => {
    console.error('⚠️ Unhandled Rejection:', err?.message || err);
});

process.on('uncaughtException', err => {
    console.error('⚠️ Uncaught Exception:', err?.message || err);
});

client.on('error', err => {
    console.error('⚠️ Client error:', err?.message || err);
});

client.on('warn', warn => {
    console.warn('⚠️ Warning:', warn);
});

// ─── LOGIN ───────────────────────────────────────────────
if (!process.env.TOKEN) {
    console.error('❌ ERROR: TOKEN not in .env!');
    process.exit(1);
}

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ Login failed:', err?.message);
    process.exit(1);
});
