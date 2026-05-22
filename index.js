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
    EmbedBuilder,
    PermissionFlagsBits
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
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ===== DATA =====
const FILE = './data.json';
let data = { coins:{}, xp:{}, inventory:{} };

function load(){
    if (fs.existsSync(FILE)) {
        try { data = JSON.parse(fs.readFileSync(FILE)); }
        catch { console.log('⚠️ data corrupted, resetting'); }
    }
}
function save(){
    fs.writeFileSync(FILE, JSON.stringify(data,null,2));
}
load();
setInterval(save, 300000);

// ===== HELPERS =====
function coins(id){ return data.coins[id] || 0; }
function addCoins(id, amt){ data.coins[id] = coins(id)+amt; }

function addXP(id){ data.xp[id] = (data.xp[id]||0)+10; }

function xpForLevel(l){ return 5*l*l+50*l+100; }
function getLevel(x=0){
    let l=0;
    while(x>=xpForLevel(l)){ x-=xpForLevel(l); l++; }
    return {l,x,req:xpForLevel(l)};
}
function bar(c,m){
    const f=Math.round((c/m)*10);
    return '█'.repeat(f)+'░'.repeat(10-f);
}

// ===== SHOP =====
const shop = [
    {name:"Rusty Sword", dmg:25, price:500},
    {name:"Shadow Blade", dmg:80, price:5000},
    {name:"Galaxy Hammer", dmg:150, price:25000}
];

// ===== BOSS =====
let boss = null;
function spawnBoss(){
    boss = {
        name:"👹 Shadow Demon",
        hp: 3000,
        max:3000
    };
}

// ===== WORDLE =====
let wordle = null;
const WORDS = ['apple','grape','tiger','chair','zebra'];

function startWordle(){
    wordle = {
        word: WORDS[Math.floor(Math.random()*WORDS.length)],
        tries:[]
    };
}

// ===== COOLDOWNS =====
const dailyCooldown = new Map();

// ===== COMMANDS =====
const commands = [

new SlashCommandBuilder().setName('ping').setDescription('pong'),

new SlashCommandBuilder().setName('bal').setDescription('coins'),

new SlashCommandBuilder().setName('rank').setDescription('level'),

new SlashCommandBuilder().setName('leaderboard').setDescription('top coins'),

new SlashCommandBuilder().setName('daily').setDescription('daily coins'),

new SlashCommandBuilder().setName('shop').setDescription('view shop'),

new SlashCommandBuilder()
.setName('buy')
.setDescription('buy weapon')
.addStringOption(o=>o.setName('item').setRequired(true)),

new SlashCommandBuilder().setName('inventory').setDescription('your items'),

new SlashCommandBuilder().setName('boss').setDescription('fight boss'),

new SlashCommandBuilder()
.setName('wordle')
.setDescription('guess word')
.addStringOption(o=>o.setName('guess').setRequired(true)),

new SlashCommandBuilder()
.setName('ai')
.setDescription('ask AI')
.addStringOption(o=>o.setName('prompt').setRequired(true)),

new SlashCommandBuilder()
.setName('kick')
.setDescription('kick user')
.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
.addUserOption(o=>o.setName('user').setRequired(true)),

new SlashCommandBuilder()
.setName('ban')
.setDescription('ban user')
.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
.addUserOption(o=>o.setName('user').setRequired(true))

].map(c=>c.toJSON());

// ===== READY =====
client.once('clientReady', async ()=>{
    console.log(`✅ ${client.user.tag}`);

    client.user.setPresence({
        status:'online',
        activities:[{name:'ULTIMATE BOT 😤', type:ActivityType.Playing}]
    });

    const rest = new REST({version:'10'}).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id),{body:commands});

    spawnBoss();
    startWordle();
});

// ===== XP =====
client.on('messageCreate', msg=>{
    if(msg.author.bot) return;
    addXP(msg.author.id);
});

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async i=>{
    if(!i.isChatInputCommand()) return;

    const id = i.user.id;

    // PING
    if(i.commandName==='ping') return i.reply('🏓 pong');

    // BAL
    if(i.commandName==='bal') return i.reply(`💰 ${coins(id)}`);

    // DAILY (cooldown)
    if(i.commandName==='daily'){
        const now = Date.now();
        if(dailyCooldown.get(id) && now - dailyCooldown.get(id) < 86400000)
            return i.reply('⏳ come back tomorrow');

        dailyCooldown.set(id, now);
        addCoins(id, 500);
        return i.reply('💸 +500 coins');
    }

    // LEADERBOARD
    if(i.commandName==='leaderboard'){
        const top = Object.entries(data.coins)
            .sort((a,b)=>b[1]-a[1])
            .slice(0,5)
            .map((u,i)=>`#${i+1} <@${u[0]}> - 💰${u[1]}`)
            .join('\n');

        return i.reply(top || 'no data');
    }

    // RANK
    if(i.commandName==='rank'){
        const info = getLevel(data.xp[id]||0);

        const embed = new EmbedBuilder()
        .setTitle(`⭐ ${i.user.username}`)
        .setDescription(
            `**Progress:**\n${bar(info.x,info.req)}\n\n` +
            `Level: ${info.l}`
        );

        return i.reply({embeds:[embed]});
    }

    // SHOP
    if(i.commandName==='shop'){
        const list = shop.map(s=>`${s.name} — ⚔️${s.dmg} — 💰${s.price}`).join('\n');
        return i.reply(list);
    }

    // BUY
    if(i.commandName==='buy'){
        const item = shop.find(x=>x.name.toLowerCase()===i.options.getString('item').toLowerCase());
        if(!item) return i.reply('❌ not found');

        if(coins(id) < item.price)
            return i.reply('❌ not enough coins');

        addCoins(id, -item.price);

        if(!data.inventory[id]) data.inventory[id] = [];
        data.inventory[id].push(item);

        return i.reply(`🛒 bought ${item.name}`);
    }

    // INVENTORY
    if(i.commandName==='inventory'){
        const inv = data.inventory[id] || [];
        if(!inv.length) return i.reply('empty');

        return i.reply(inv.map(i=>`${i.name} ⚔️${i.dmg}`).join('\n'));
    }

    // BOSS
    if(i.commandName==='boss'){
        const inv = data.inventory[id] || [];
        const best = inv.sort((a,b)=>b.dmg-a.dmg)[0];

        const dmg = (best?.dmg || 20) + Math.floor(Math.random()*50);

        boss.hp -= dmg;
        addCoins(id, dmg);

        if(boss.hp<=0){
            spawnBoss();
            return i.reply(`💀 boss defeated`);
        }

        return i.reply(`⚔️ ${dmg} dmg\nHP: ${boss.hp}/${boss.max}`);
    }

    // WORDLE
    if(i.commandName==='wordle'){
        const g = i.options.getString('guess');

        wordle.tries.push(g);

        if(g===wordle.word){
            startWordle();
            return i.reply('🟩 WIN');
        }

        return i.reply(`❌ wrong (${wordle.tries.length}/6)`);
    }

    // AI (SAFE LIMIT)
    if(i.commandName==='ai'){
        const prompt = i.options.getString('prompt');

        const res = await openai.chat.completions.create({
            model:"gpt-4o-mini",
            messages:[{role:"user", content:prompt}]
        });

        return i.reply(res.choices[0].message.content.slice(0,2000));
    }

    // KICK
    if(i.commandName==='kick'){
        const user = i.options.getUser('user');
        const member = i.guild.members.cache.get(user.id);

        if(member){
            await member.kick();
            return i.reply(`👢 kicked ${user.tag}`);
        }
    }

    // BAN
    if(i.commandName==='ban'){
        const user = i.options.getUser('user');
        const member = i.guild.members.cache.get(user.id);

        if(member){
            await member.ban();
            return i.reply(`🔨 banned ${user.tag}`);
        }
    }

});

// ===== LOGIN =====
client.login(process.env.TOKEN);
