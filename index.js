const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!DISCORD_TOKEN || !CLIENT_ID || !OPENROUTER_API_KEY) {
  console.error(
    'Missing required environment variables. Check your .env file has DISCORD_TOKEN, CLIENT_ID, and OPENROUTER_API_KEY.'
  );
  process.exit(1);
}

// ---- Slash command definition ----
const commands = [
  new SlashCommandBuilder()
    .setName('script')
    .setDescription('Generate an efficient Luau (Roblox) script')
    .addStringOption((option) =>
      option
        .setName('request')
        .setDescription('Describe what you want the script to do')
        .setRequired(true)
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// ---- OpenRouter API call (free tier) ----
// Model can be swapped by changing OPENROUTER_MODEL in .env.
// Good free options for code: "qwen/qwen3-coder:free", "deepseek/deepseek-r1-distill:free"
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3-coder:free';

const SYSTEM_PROMPT = `You are an expert Roblox Luau engineer. When given a request, write clean, efficient, idiomatic Luau code following current Roblox best practices:
- Use proper services via game:GetService()
- Prefer efficient patterns (avoid unnecessary loops, avoid polling with wait() when events/signals are better, use task.wait()/task.spawn() instead of deprecated wait()/spawn())
- Add brief comments only where the logic isn't obvious
- Keep variable names clear
- If the request is ambiguous, make a reasonable assumption and briefly note it after the code
- Output the code in a single Luau code block. Keep any explanation after the code block short (2-4 sentences max).`;

async function generateLuauScript(userRequest) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userRequest },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message?.content;
  return message || 'No response generated.';
}

// ---- Discord client ----
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'script') return;

  const userRequest = interaction.options.getString('request');
  await interaction.deferReply();

  try {
    const rawResult = await generateLuauScript(userRequest);

    // Extract the code block if present, otherwise send full response
    const codeMatch = rawResult.match(/```(?:lua|luau)?\n?([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : rawResult.trim();
    const explanation = codeMatch
      ? rawResult.replace(codeMatch[0], '').trim()
      : '';

    const discordMessageLimit = 1900; // leave headroom for formatting

    if (code.length <= discordMessageLimit) {
      const embed = new EmbedBuilder()
        .setColor(0x00b0f4)
        .setTitle('Generated Luau Script')
        .setDescription(`\`\`\`lua\n${code}\n\`\`\``)
        .setFooter({ text: `Requested by ${interaction.user.username}` });

      if (explanation) {
        embed.addFields({ name: 'Notes', value: explanation.slice(0, 1024) });
      }

      await interaction.editReply({ embeds: [embed] });
    } else {
      // Too long for an embed/message — send as a file attachment instead
      const buffer = Buffer.from(code, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: 'script.lua' });

      await interaction.editReply({
        content: `Here's your script (too long to inline)${
          explanation ? `\n\n${explanation.slice(0, 1500)}` : ''
        }`,
        files: [attachment],
      });
    }
  } catch (error) {
    console.error('Generation error:', error);
    await interaction.editReply(
      'Something went wrong generating that script. Check the bot logs, or try rephrasing your request.'
    );
  }
});

registerCommands();
client.login(DISCORD_TOKEN);
