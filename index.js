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
    WebhookClient,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// ─── CONFIG ──────────────────────────────────────────────
const PREFIX = '!';
const OWNER_ID = '1340069836096667859';
const DATA_FILE = path.join(__dirname, 'data.json');

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
const fnfGames = new Map();

// ─── IMPERSONATE STATE ───────────────────────────────────
const activeImpersonations = new Map();

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('📝 No data file, will create on save');
            return;
        }
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw?.warnings) {
            for (const [k, v] of Object.entries(raw.warnings)) {
                warnings.set(String(k), Number(v));
            }
        }
        if (raw?.xp) {
            for (const [k, v] of Object.entries(raw.xp)) {
                xp.set(String(k), Number(v));
            }
        }
        if (raw?.coins) {
            for (const [k, v] of Object.entries(raw.coins)) {
                coins.set(String(k), Number(v));
            }
        }
        if (raw?.weapons) {
            for (const [k, v] of Object.entries(raw.weapons)) {
                weapons.set(String(k), Array.isArray(v) ? v : []);
            }
        }
        if (raw?.staff) {
            for (const id of raw.staff) {
                staffSet.add(String(id));
            }
        }
        if (raw?.autoResponses) {
            for (const [k, v] of Object.entries(raw.autoResponses)) {
                autoResponses.set(String(k), String(v));
            }
        }
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
setInterval(saveData, 300000);

// ─── SHOP (HARDER TO GET LEGENDARY) ──────────────────────
const shop = [
    { name: 'Rusty Sword', damage: 25, price: 500, rarity: 'Common' },
    { name: 'Shadow Blade', damage: 80, price: 8000, rarity: 'Rare' },
    { name: 'Galaxy Hammer', damage: 150, price: 50000, rarity: 'Legendary' }
];

// ─── LEVEL SYSTEM ────────────────────────────────────────
function xpForLevel(n) {
    return Math.max(1, 5 * n * n + 50 * n + 100);
}

function getLevelInfo(totalXP) {
    let level = 0;
    let remaining = Math.max(0, Number(totalXP) || 0);
    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
    }
    return { level, xpInLevel: remaining, xpRequired: xpForLevel(level) };
}

function buildBar(current, max) {
    const percent = Math.max(0, Math.min(1, Number(current) / Number(max)));
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

// ─── WORDLE ──────────────────────────────────────────────
const wordleGames = new Map();
const WORDLE_WORDS = [
    'apple','brave','chess','drive','eight','flair','grace','heart','ivory','jewel',
    'knack','lemon','maple','noble','ocean','piano','quest','raven','solar','tiger',
    'ultra','vivid','wheat','xenon','yacht','zebra','adore','blaze','coral','daisy',
    'ember','flute','gleam','haste','inlet','joker','karma','lance','moose','nerve',
    'opera','prism','quail','reign','spine','torch','usher','vapor','waltz','xeric',
    'yield','zonal','amber','boost','crisp','delta','elbow','frost','globe','hover',
];

function evaluateGuess(word, guess) {
    const result = Array(5).fill('⬛');
    const wordArr = word.split('');
    const used = Array(5).fill(false);
    const gArr = guess.split('');
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
    new SlashCommandBuilder()
        .setName('fnf')
        .setDescription('Play Friday Night Funkin! (with timer)'),
    new SlashCommandBuilder()
        .setName('wordle')
        .setDescription('Play Wordle - Guess the 5-letter word')
        .addStringOption(o => o.setName('guess').setRequired(true).setMinLength(5).setMaxLength(5)),
    new SlashCommandBuilder()
        .setName('addxp')
        .setDescription('Add XP to user (staff)')
        .addUserOption(o => o.setName('user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('addcoins')
        .setDescription('Add coins to user (staff)')
        .addUserOption(o => o.setName('user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('(staff) Set mod-log channel')
        .addChannelOption(o => o.setName('channel').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('(staff) Set up welcome system')
        .addChannelOption(o => o.setName('channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addRoleOption(o => o.setName('role').setRequired(false)),
    new SlashCommandBuilder()
        .setName('addresponse')
        .setDescription('(owner) Add auto-response')
        .addStringOption(o => o.setName('trigger').setRequired(true))
        .addStringOption(o => o.setName('response').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removeresponse')
        .setDescription('(owner) Remove auto-response')
        .addStringOption(o => o.setName('trigger').setRequired(true)),
    new SlashCommandBuilder()
        .setName('listresponses')
        .setDescription('(owner) List all auto-responses'),
    new SlashCommandBuilder()
        .setName('impersonate')
        .setDescription('(staff) Impersonate a user with AI replies')
        .addUserOption(o => o.setName('user').setRequired(true)),
    new SlashCommandBuilder()
        .setName('stopimpersonate')
        .setDescription('(staff) Stop impersonating in this channel'),
];

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
        await rest.put(Routes.applicationCommands(client.user.id), { 
            body: slashCommands.map(cmd => cmd.toJSON()) 
        }).catch(e => {
            console.error('⚠️ Command registration error:', e?.message);
        });
        console.log('✅ Slash commands registered (v1.5)');

        for (const guild of client.guilds.cache.values()) {
            try {
                const channel = guild.systemChannel || guild.channels.cache
                    .filter(c => c.isTextBased && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages))
                    .first();
                if (channel) {
                    await channel.send('🤖 **Bot v1.5 Online!** All features restored + FNF with timer + harder economy!').catch(() => {});
                }
            } catch (e) {
                console.error('Announce error:', e?.message);
            }
        }
    } catch (e) {
        console.error('❌ Ready error:', e?.message);
    }
});

// ─── SLASH COMMAND HANDLER ───────────────────────────────
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('welcome_modal_')) {
                const guildId = interaction.customId.replace('welcome_modal_', '');
                const message = interaction.fields.getTextInputValue('welcome_msg');
                const imageUrl = interaction.fields.getTextInputValue('welcome_img').trim() || null;

                const cfg = welcomeConfig[guildId] || {};
                welcomeConfig[guildId] = { ...cfg, message, imageUrl };
                saveData();

                const preview = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Welcome system configured!')
                    .addFields(
                        { name: 'Channel', value: `<#${welcomeConfig[guildId].channelId}>`, inline: true },
                        { name: 'Role', value: welcomeConfig[guildId].roleId ? `<@&${welcomeConfig[guildId].roleId}>` : 'None', inline: true },
                        { name: 'Message', value: message }
                    );
                if (imageUrl) preview.setImage(imageUrl);
                return interaction.reply({ embeds: [preview], ephemeral: true });
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const userId = String(interaction.user?.id || '');
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
                    .setTitle('🤖 Bot v1.5 Commands')
                    .addFields(
                        { name: 'Economy', value: '`/bal` `/shop` `/buy` `/sell` `/leaderboard`', inline: true },
                        { name: 'Games', value: '`/fnf` `/wordle` `/bossfight`', inline: true },
                        { name: 'Levels', value: '`/rank` `/profile`', inline: true },
                        { name: 'Staff', value: '`/addxp` `/addcoins` `/logs` `/welcome` `/impersonate` `/stopimpersonate`', inline: true },
                        { name: 'Owner', value: '`/addresponse` `/removeresponse` `/listresponses`', inline: true },
                        { name: 'Prefix (!):', value: '`!daily` `!rob` `!fight` `!gamble` `!steal` `!fnf` `!ragebait` `!domain` `!hollow` `!infinity` `!unleash` `!bankai` `!gear5` `!sharingan` `!attackontitan`', inline: false }
                    );
                await interaction.reply({ embeds: [embed] });
                return;
            }

            // BAL
            if (interaction.commandName === 'bal') {
                const balance = Number(coins.get(userId)) || 0;
                await interaction.reply({ content: `💰 **${balance}** coins`, ephemeral: true });
                return;
            }

            // RANK
            if (interaction.commandName === 'rank') {
                const info = getLevelInfo(xp.get(userId));
                const bar = buildBar(info.xpInLevel, info.xpRequired);
                await interaction.reply({
                    content: `⭐ **Level ${info.level}**\n${bar}\n${Math.floor(info.xpInLevel)}/${info.xpRequired} XP`,
                    ephemeral: true
                });
                return;
            }

            // PROFILE
            if (interaction.commandName === 'profile') {
                const userCoins = Number(coins.get(userId)) || 0;
                const info = getLevelInfo(xp.get(userId));
                const inv = weapons.get(userId) || [];
                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle(`${interaction.user?.username || 'User'}'s Profile`)
                    .setThumbnail(interaction.user?.displayAvatarURL())
                    .addFields(
                        { name: 'Coins', value: `**${userCoins}**`, inline: true },
                        { name: 'Level', value: `**${info.level}**`, inline: true },
                        { name: 'Total XP', value: `**${Math.floor(info.totalXP || 0)}**`, inline: true },
                        { name: 'Weapons', value: inv.length ? inv.map(w => `• ${w?.name || 'Item'} (${w?.rarity || 'N/A'})`).join('\n') : 'Empty' }
                    );
                await interaction.reply({ embeds: [embed] });
                return;
            }

            // SHOP
            if (interaction.commandName === 'shop') {
                let text = '**🛍️ Shop:**\n\n';
                shop.forEach(i => {
                    text += `**${String(i.name)}** — 💰 ${Number(i.price)} — ⚔️ ${Number(i.damage)} — ${String(i.rarity)}\n`;
                });
                text += '\nUse `/buy <item>` to purchase!';
                await interaction.reply({ content: text, ephemeral: true });
                return;
            }

            // BUY
            if (interaction.commandName === 'buy') {
                const itemName = String(interaction.options?.getString('item') || '').toLowerCase();
                const item = shop.find(i => String(i.name).toLowerCase() === itemName);
                if (!item) {
                    await interaction.reply({ content: '❌ Item not found', ephemeral: true });
                    return;
                }

                const userCoins = Number(coins.get(userId)) || 0;
                if (userCoins < Number(item.price)) {
                    await interaction.reply({ content: `❌ Not enough coins (need ${item.price}, have ${userCoins})`, ephemeral: true });
                    return;
                }

                coins.set(userId, userCoins - Number(item.price));
                if (!weapons.has(userId)) weapons.set(userId, []);
                weapons.get(userId).push({ ...item });
                saveData();
                await interaction.reply({ content: `✅ Bought **${item.name}** for **${item.price}** coins!`, ephemeral: true });
                return;
            }

            // SELL
            if (interaction.commandName === 'sell') {
                const itemName = String(interaction.options?.getString('item') || '').toLowerCase();
                const inv = weapons.get(userId) || [];
                const index = inv.findIndex(i => String(i?.name || '').toLowerCase() === itemName);
                if (index === -1) {
                    await interaction.reply({ content: '❌ You don\'t have that item', ephemeral: true });
                    return;
                }

                const item = inv.splice(index, 1)[0];
                const sellPrice = Math.max(1, Math.floor((Number(item?.price) || 100) * 0.6));
                coins.set(userId, (Number(coins.get(userId)) || 0) + sellPrice);
                saveData();
                await interaction.reply({ content: `💰 Sold **${item?.name || 'Item'}** for **${sellPrice}** coins!`, ephemeral: true });
                return;
            }

            // BOSSFIGHT
            if (interaction.commandName === 'bossfight') {
                if (!boss) {
                    boss = { name: '👹 Shadow Demon', health: 3000, maxHealth: 3000 };
                }
                const inv = weapons.get(userId) || [];
                const best = [...inv].sort((a, b) => (Number(b?.damage) || 0) - (Number(a?.damage) || 0))[0] || { damage: 20 };
                const damage = Math.max(1, Number(best.damage) + Math.floor(Math.random() * 50));

                boss.health = Math.max(0, boss.health - damage);
                coins.set(userId, (Number(coins.get(userId)) || 0) + Math.floor(damage / 2));
                saveData();

                if (boss.health <= 0) {
                    const reward = Math.floor(damage * 2);
                    coins.set(userId, (Number(coins.get(userId)) || 0) + reward);
                    xp.set(userId, (Number(xp.get(userId)) || 0) + reward);
                    saveData();
                    boss = null;
                    await interaction.reply({ content: `🎊 **Boss defeated!** Earned **${reward}** coins & XP!` });
                    return;
                }
                const bar = buildBar(boss.health, boss.maxHealth);
                await interaction.reply({ content: `⚔️ Dealt **${damage}** damage!\n${boss.name} HP: ${bar} ${boss.health}/${boss.maxHealth}` });
                return;
            }

            // LEADERBOARD
            if (interaction.commandName === 'leaderboard') {
                const top = [...coins.entries()]
                    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
                    .slice(0, 5)
                    .map(([id, amt], i) => `**#${i + 1}** <@${id}> — 💰 **${amt}**`)
                    .join('\n');
                await interaction.reply({ content: top || 'No players yet' });
                return;
            }

            // FNF WITH TIMER
            if (interaction.commandName === 'fnf') {
                const chart = generateFNFChart('easy');
                const game = { score: 0, streak: 0, notes: chart, current: 0, startTime: Date.now() };
                fnfGames.set(userId, game);

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('fnf_left').setLabel('⬅️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_down').setLabel('⬇️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_up').setLabel('⬆️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fnf_right').setLabel('➡️').setStyle(ButtonStyle.Primary)
                );

                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle('🎵 Friday Night Funkin\' (v1.5 - Timed!)')
                    .setDescription(`**Current Note:** ${chart[0]}\n⏱️ **30 second timer**\n\n**Score:** ${game.score}\n**Streak:** ${game.streak}`)
                    .setFooter({ text: `Note 1/${chart.length}` });

                const msg = await interaction.reply({ embeds: [embed], components: [buttons], fetchReply: true });

                const collector = msg.createMessageComponentCollector({ time: 30000 });
                let hitThisNote = false;

                collector.on('collect', async btn => {
                    if (btn.user.id !== userId) {
                        await btn.reply({ content: 'This is not your game!', ephemeral: true }).catch(() => {});
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
                            coins.set(userId, (Number(coins.get(userId)) || 0) + game.score);
                            xp.set(userId, (Number(xp.get(userId)) || 0) + game.score);
                            saveData();
                            fnfGames.delete(userId);
                            collector.stop();

                            const winEmbed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('🎊 Perfect Song Complete!')
                                .addFields(
                                    { name: 'Final Score', value: `**${game.score}**`, inline: true },
                                    { name: 'Coins', value: `**+${game.score}**`, inline: true },
                                    { name: 'XP', value: `**+${game.score}**`, inline: true }
                                );
                            await msg.edit({ embeds: [winEmbed], components: [] }).catch(() => {});
                            return;
                        }

                        hitThisNote = false;
                        const elapsed = Math.floor((Date.now() - game.startTime) / 1000);
                        const updatedEmbed = new EmbedBuilder()
                            .setColor(0xff00ff)
                            .setTitle('🎵 Friday Night Funkin\' (v1.5)')
                            .setDescription(`**Current Note:** ${chart[game.current]}\n⏱️ **${30 - elapsed}s left**\n\n**Score:** ${game.score}\n**Streak:** ${game.streak}`)
                            .setFooter({ text: `Note ${game.current + 1}/${chart.length}` });
                        await msg.edit({ embeds: [updatedEmbed] }).catch(() => {});
                    } else {
                        game.streak = 0;
                    }

                    await btn.deferUpdate().catch(() => {});
                });

                collector.on('end', async () => {
                    if (fnfGames.has(userId)) {
                        const finalScore = fnfGames.get(userId)?.score || 0;
                        fnfGames.delete(userId);
                        const finalEmbed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('💔 Time\'s Up!')
                            .setDescription(`Final Score: **${finalScore}**`);
                        await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
                    }
                });
                return;
            }

            // WORDLE
            if (interaction.commandName === 'wordle') {
                const guess = String(interaction.options.getString('guess')).toLowerCase();
                const channelId = String(interaction.channelId);
                
                if (!wordleGames.has(channelId)) {
                    const word = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
                    wordleGames.set(channelId, { word, guesses: [], maxGuesses: 6 });
                }

                const game = wordleGames.get(channelId);
                if (guess.length !== 5) {
                    await interaction.reply({ content: '❌ Must be exactly 5 letters', ephemeral: true });
                    return;
                }

                const result = evaluateGuess(game.word, guess);
                game.guesses.push({ guess, result });

                let board = '';
                for (const { guess: g, result: r } of game.guesses) {
                    board += r.join('') + '  ' + g.toUpperCase().split('').join(' ') + '\n';
                }

                const embed = new EmbedBuilder()
                    .setTitle('🟩 Wordle')
                    .setDescription(board)
                    .setColor(guess === game.word ? 0x57F287 : 0x7289DA);

                if (guess === game.word) {
                    embed.setFooter({ text: `🎉 Solved in ${game.guesses.length} guess${game.guesses.length === 1 ? '' : 'es'}!` });
                    coins.set(userId, (Number(coins.get(userId)) || 0) + 500);
                    xp.set(userId, (Number(xp.get(userId)) || 0) + 250);
                    saveData();
                    wordleGames.delete(channelId);
                } else if (game.guesses.length >= game.maxGuesses) {
                    embed.setFooter({ text: `The word was: ${game.word.toUpperCase()}` });
                    wordleGames.delete(channelId);
                } else {
                    embed.setFooter({ text: `${game.maxGuesses - game.guesses.length} guesses left` });
                }

                await interaction.reply({ embeds: [embed] });
                return;
            }

            // LOGS
            if (interaction.commandName === 'logs') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const channel = interaction.options.getChannel('channel');
                logsConfig[interaction.guildId] = channel.id;
                saveData();
                await interaction.reply({ content: `✅ Mod logs set to <#${channel.id}>`, ephemeral: true });
                return;
            }

            // WELCOME
            if (interaction.commandName === 'welcome') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const channel = interaction.options.getChannel('channel');
                const role = interaction.options.getRole('role');
                
                welcomeConfig[interaction.guildId] = { channelId: channel.id, roleId: role?.id || null };

                const modal = new ModalBuilder()
                    .setCustomId(`welcome_modal_${interaction.guildId}`)
                    .setTitle('Welcome Message Setup')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('welcome_msg')
                                .setLabel('Welcome Message')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Welcome to the server!')
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('welcome_img')
                                .setLabel('Image URL (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                        )
                    );

                await interaction.showModal(modal);
                return;
            }

            // ADDRESPONSE
            if (interaction.commandName === 'addresponse') {
                if (!isOwner) {
                    await interaction.reply({ content: '❌ Owner only', ephemeral: true });
                    return;
                }
                const trigger = String(interaction.options.getString('trigger')).toLowerCase();
                const response = String(interaction.options.getString('response'));
                autoResponses.set(trigger, response);
                saveData();
                await interaction.reply({ content: `✅ Added auto-response: \`${trigger}\` → \`${response}\``, ephemeral: true });
                return;
            }

            // REMOVERESPONSE
            if (interaction.commandName === 'removeresponse') {
                if (!isOwner) {
                    await interaction.reply({ content: '❌ Owner only', ephemeral: true });
                    return;
                }
                const trigger = String(interaction.options.getString('trigger')).toLowerCase();
                if (autoResponses.delete(trigger)) {
                    saveData();
                    await interaction.reply({ content: `✅ Removed auto-response: \`${trigger}\``, ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Not found', ephemeral: true });
                }
                return;
            }

            // LISTRESPONSES
            if (interaction.commandName === 'listresponses') {
                if (!isOwner) {
                    await interaction.reply({ content: '❌ Owner only', ephemeral: true });
                    return;
                }
                if (!autoResponses.size) {
                    await interaction.reply({ content: 'No auto-responses yet', ephemeral: true });
                    return;
                }
                let text = '**Auto-Responses:**\n';
                for (const [k, v] of autoResponses) {
                    text += `\`${k}\` → \`${v}\`\n`;
                }
                await interaction.reply({ content: text, ephemeral: true });
                return;
            }

            // IMPERSONATE
            if (interaction.commandName === 'impersonate') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const target = interaction.options.getUser('user');
                const channelId = String(interaction.channelId);
                
                try {
                    const webhook = await interaction.channel.createWebhook({
                        name: target.username,
                        avatar: target.displayAvatarURL()
                    });
                    
                    activeImpersonations.set(channelId, {
                        userId: target.id,
                        username: target.username,
                        avatarUrl: target.displayAvatarURL(),
                        webhookId: webhook.id,
                        webhookToken: webhook.token
                    });

                    await interaction.reply({ content: `✅ Now impersonating **${target.username}** in this channel!`, ephemeral: true });
                } catch (e) {
                    await interaction.reply({ content: `❌ Error: ${e?.message}`, ephemeral: true });
                }
                return;
            }

            // STOPIMPERSONATE
            if (interaction.commandName === 'stopimpersonate') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const channelId = String(interaction.channelId);
                const imp = activeImpersonations.get(channelId);
                if (!imp) {
                    await interaction.reply({ content: '❌ Not impersonating anyone here', ephemeral: true });
                    return;
                }
                activeImpersonations.delete(channelId);
                await interaction.reply({ content: `✅ Stopped impersonating`, ephemeral: true });
                return;
            }

            // ADDXP
            if (interaction.commandName === 'addxp') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const target = interaction.options.getUser('user');
                const amount = interaction.options.getInteger('amount');
                const tid = String(target.id);
                xp.set(tid, (Number(xp.get(tid)) || 0) + amount);
                saveData();
                await interaction.reply({ content: `✅ Added **${amount}** XP to <@${tid}>`, ephemeral: true });
                return;
            }

            // ADDCOINS
            if (interaction.commandName === 'addcoins') {
                if (!isStaff) {
                    await interaction.reply({ content: '❌ Staff only', ephemeral: true });
                    return;
                }
                const target = interaction.options.getUser('user');
                const amount = interaction.options.getInteger('amount');
                const tid = String(target.id);
                coins.set(tid, (Number(coins.get(tid)) || 0) + amount);
                saveData();
                await interaction.reply({ content: `✅ Added **${amount}** coins to <@${tid}>`, ephemeral: true });
                return;
            }

        } catch (cmdErr) {
            console.error('❌ Command error:', cmdErr?.message);
            try {
                if (!interaction.replied) {
                    await interaction.reply({ content: '❌ Command failed', ephemeral: true });
                }
            } catch (e) {
                console.error('Failed to reply:', e?.message);
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
        // Auto-responses
        if (!message.author.bot) {
            const content = message.content.toLowerCase();
            for (const [trigger, response] of autoResponses) {
                if (content.includes(trigger)) {
                    try {
                        await message.reply(response);
                    } catch (e) {
                        console.error('Auto-response error:', e?.message);
                    }
                }
            }
        }

        // Impersonate
        const imp = activeImpersonations.get(String(message.channelId));
        if (imp && message.author.id === OWNER_ID) {
            try {
                const wh = new WebhookClient({ id: imp.webhookId, token: imp.webhookToken });
                await wh.send({ content: message.content, username: imp.username, avatarURL: imp.avatarUrl });
                await message.delete();
                return;
            } catch (e) {
                console.error('Webhook error:', e?.message);
            }
        }

        if (!message.content.startsWith(PREFIX) || message.author.bot) return;

        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();
        const userId = String(message.author.id);

        try {
            // !help
            if (cmd === 'help') {
                const embed = new EmbedBuilder()
                    .setColor(0x00ff88)
                    .setTitle('📖 Bot v1.5 Help')
                    .addFields(
                        { name: 'Economy', value: '`!daily` `!rob` `!gamble` `!steal`', inline: true },
                        { name: 'Games', value: '`!fnf` `!fight`', inline: true },
                        { name: 'Anime', value: '`!domain` `!hollow` `!infinity` `!unleash` `!bankai` `!gear5` `!sharingan` `!attackontitan`', inline: true },
                        { name: 'Fun', value: '`!ragebait`', inline: true }
                    );
                return message.reply({ embeds: [embed] });
            }

            // !daily
            if (cmd === 'daily') {
                const lastDaily = cooldowns.get(`daily_${userId}`);
                const now = Date.now();
                if (lastDaily && now - lastDaily < 86400000) {
                    const timeLeft = Math.ceil((86400000 - (now - lastDaily)) / 3600000);
                    return message.reply(`⏰ Daily already claimed! Come back in **${timeLeft}h**.`);
                }

                const reward = Math.floor(Math.random() * 500) + 200;
                coins.set(userId, (Number(coins.get(userId)) || 0) + reward);
                xp.set(userId, (Number(xp.get(userId)) || 0) + 50);
                cooldowns.set(`daily_${userId}`, now);
                saveData();

                return message.reply(`💰 **+${reward}** coins and **+50 XP**!`);
            }

            // !rob
            if (cmd === 'rob') {
                const target = message.mentions.first();
                if (!target) return message.reply('❌ Mention someone to rob!');

                const tid = String(target.id);
                const targetCoins = Number(coins.get(tid)) || 0;
                if (targetCoins < 100) return message.reply('❌ Target has less than 100 coins!');

                const stolen = Math.floor(Math.random() * targetCoins * 0.5);
                coins.set(tid, targetCoins - stolen);
                coins.set(userId, (Number(coins.get(userId)) || 0) + stolen);
                saveData();

                return message.reply(`💰 Robbed **${target.username}** for **${stolen}** coins!`);
            }

            // !gamble
            if (cmd === 'gamble') {
                const amount = parseInt(args[0]) || 100;
                const userCoins = Number(coins.get(userId)) || 0;
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
                const wid = String(winner.id);

                coins.set(wid, (Number(coins.get(wid)) || 0) + 100);
                xp.set(wid, (Number(xp.get(wid)) || 0) + 50);
                saveData();

                return message.reply(`⚔️ **${message.author.username}** (${p1Dmg}) vs **${target.username}** (${p2Dmg})\n🏆 ${winner.username} wins **100 coins** & **50 XP**!`);
            }

            // !steal
            if (cmd === 'steal') {
                const target = message.mentions.first();
                if (!target) return message.reply('❌ Mention someone!');

                const tid = String(target.id);
                const inv = weapons.get(tid) || [];
                if (!inv.length) return message.reply('❌ They have no weapons!');

                const stolen = inv.splice(Math.floor(Math.random() * inv.length), 1)[0];
                if (!weapons.has(userId)) weapons.set(userId, []);
                weapons.get(userId).push(stolen);
                saveData();

                return message.reply(`🗡️ Stole **${stolen?.name || 'weapon'}** from **${target.username}**!`);
            }

            // !fnf (prefix version)
            if (cmd === 'fnf') {
                const chart = generateFNFChart('hard');
                const game = { score: 0, streak: 0, notes: chart, current: 0, startTime: Date.now() };
                fnfGames.set(userId, game);

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`fnf_p_left_${userId}`).setLabel('⬅️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_down_${userId}`).setLabel('⬇️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_up_${userId}`).setLabel('⬆️').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`fnf_p_right_${userId}`).setLabel('➡️').setStyle(ButtonStyle.Primary)
                );

                const embed = new EmbedBuilder()
                    .setColor(0xff00ff)
                    .setTitle('🎵 FNF Rhythm Battle (Hard - 60s)')
                    .setDescription(`**Current:** ${chart[0]}\n⏱️ **60 second timer**\n**Score:** 0 | **Streak:** 0`)
                    .setFooter({ text: `Note 1/${chart.length}` });

                const msg = await message.reply({ embeds: [embed], components: [buttons] });

                const collector = msg.createMessageComponentCollector({ time: 60000 });
                let hitThisNote = false;

                collector.on('collect', async btn => {
                    if (btn.user.id !== userId) {
                        await btn.reply({ content: 'Not your game!', ephemeral: true }).catch(() => {});
                        return;
                    }

                    const noteMap = { 
                        [`fnf_p_left_${userId}`]: '⬅️', 
                        [`fnf_p_down_${userId}`]: '⬇️', 
                        [`fnf_p_up_${userId}`]: '⬆️', 
                        [`fnf_p_right_${userId}`]: '➡️' 
                    };
                    const playerNote = noteMap[btn.customId];
                    const expected = chart[game.current];

                    if (playerNote === expected && !hitThisNote) {
                        hitThisNote = true;
                        game.score += 100;
                        game.streak++;
                        game.current++;

                        if (game.current >= chart.length) {
                            coins.set(userId, (Number(coins.get(userId)) || 0) + game.score);
                            xp.set(userId, (Number(xp.get(userId)) || 0) + game.score);
                            saveData();
                            fnfGames.delete(userId);
                            collector.stop();

                            const win = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('🎊 Perfect!')
                                .setDescription(`**Score:** ${game.score}\n**Coins:** +${game.score}\n**XP:** +${game.score}`);
                            await msg.edit({ embeds: [win], components: [] }).catch(() => {});
                            return;
                        }

                        hitThisNote = false;
                        const elapsed = Math.floor((Date.now() - game.startTime) / 1000);
                        const upd = new EmbedBuilder()
                            .setColor(0xff00ff)
                            .setTitle('🎵 FNF Rhythm Battle')
                            .setDescription(`**Current:** ${chart[game.current]}\n⏱️ **${60 - elapsed}s**\n**Score:** ${game.score} | **Streak:** ${game.streak}`)
                            .setFooter({ text: `Note ${game.current + 1}/${chart.length}` });
                        await msg.edit({ embeds: [upd] }).catch(() => {});
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
                            .setTitle('💔 Time\'s Up!')
                            .setDescription(`Final Score: ${game.score}`);
                        await msg.edit({ embeds: [end], components: [] }).catch(() => {});
                    }
                });
                return;
            }

            // ANIME COMMANDS
            const animeResponses = {
                'domain': '**Infinity Domain!** 🌌 A cursed technique that warps space! (-10 health for enemies)',
                'hollow': '**Hollow Mask Activated!** 💀 Your power multiplies tenfold!',
                'infinity': '**Infinity Triggered!** ♾️ No one can touch you now...',
                'unleash': '**Beast Unleashed!** 🔥 Raw power overflowing!',
                'bankai': '**BANKAI!!!!** ⚔️ True power revealed!',
                'gear5': '**GEAR 5 ACTIVATED!** 🎪 Nika has arrived! Cartoon physics engaged!',
                'sharingan': '**Sharingan Activated!** 👁️ You can see all movements now!',
                'attackontitan': '**Colossal Titan Transformation!** 🗻 Titan power awakened!'
            };

            for (const [aCmd, response] of Object.entries(animeResponses)) {
                if (cmd === aCmd) {
                    xp.set(userId, (Number(xp.get(userId)) || 0) + 25);
                    saveData();
                    return message.reply(response);
                }
            }

            // !ragebait
            if (cmd === 'ragebait') {
                const bait = [
                    '**RAGEBAIT SUCCESSFUL!** 🎣 Everyone is arguing in the chat now lmaooo',
                    'he says he wants to be the very best, like no one ever was 💀',
                    'watching anime is for losers (this is ragebait dont mad)',
                    'pineapple belongs on pizza 🍕',
                    'minecraft java edition is outdated',
                    'fortnite is better than any other game',
                    'discord is overrated'
                ];
                coins.set(userId, (Number(coins.get(userId)) || 0) + 50);
                saveData();
                return message.reply(bait[Math.floor(Math.random() * bait.length)]);
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

// Handle welcome messages
client.on('guildMemberAdd', async member => {
    try {
        const guildId = String(member.guild.id);
        const config = welcomeConfig[guildId];
        if (!config) return;

        const channel = await member.guild.channels.fetch(config.channelId);
        if (!channel) return;

        if (config.roleId) {
            try {
                await member.roles.add(config.roleId);
            } catch (e) {
                console.error('Role add error:', e?.message);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Welcome!')
            .setDescription(config.message)
            .setThumbnail(member.user.displayAvatarURL());
        if (config.imageUrl) embed.setImage(config.imageUrl);

        await channel.send({ content: `Welcome <@${member.id}>!`, embeds: [embed] });
    } catch (e) {
        console.error('Welcome error:', e?.message);
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
