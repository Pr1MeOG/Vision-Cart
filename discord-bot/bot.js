const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const API = process.env.VISIONCART_API_URL;
const BOT_SECRET = process.env.DISCORD_BOT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const RECEIPT_ID_REGEX = /^VC-[A-Z2-9]{8}$/;

if (!API || !BOT_SECRET || !BOT_TOKEN) {
  console.error("❌ Missing required bot env vars: VISIONCART_API_URL, DISCORD_BOT_SECRET, DISCORD_BOT_TOKEN");
  process.exit(1);
}

const parseReceiptId = (raw) => raw.trim().toUpperCase();
const isValidReceiptId = (id) => RECEIPT_ID_REGEX.test(id);

// ─── Register slash commands ───────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("receipt")
    .setDescription("Look up a VisionCart receipt")
    .addStringOption(o => o.setName("id").setDescription("Receipt ID (e.g. VC-AB12CD34)").setRequired(true)),
  new SlashCommandBuilder()
    .setName("confirm")
    .setDescription("Confirm a payment receipt")
    .addStringOption(o => o.setName("id").setDescription("Receipt ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("reject")
    .setDescription("Reject a payment receipt")
    .addStringOption(o => o.setName("id").setDescription("Receipt ID").setRequired(true)),
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`✅ VisionCart Bot ready as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (e) { console.error("❌ Command register error:", e); }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === "receipt") {
    const id = parseReceiptId(interaction.options.getString("id"));
    if (!isValidReceiptId(id)) return interaction.reply({ content: "❌ Invalid receipt ID format.", ephemeral: true });
    await interaction.deferReply();
    try {
      const res = await fetch(`${API}/bot/receipt/${id}`, { headers: { "x-bot-secret": BOT_SECRET } });
      const data = await res.json();
      if (!res.ok) return interaction.editReply(`❌ ${data.message}`);
      const { receipt } = data;
      const statusEmoji = receipt.status === "confirmed" ? "✅" : receipt.status === "rejected" ? "❌" : "⏳";
      const embed = new EmbedBuilder()
        .setTitle(`🧾 Receipt ${receipt.receiptId}`)
        .setColor(receipt.status === "confirmed" ? 0x22c55e : receipt.status === "rejected" ? 0xef4444 : 0x9333ea)
        .addFields(
          { name: "Customer", value: `${receipt.user.name}\n${receipt.user.email}`, inline: true },
          { name: "Total", value: `₹${receipt.total.toLocaleString("en-IN")}`, inline: true },
          { name: "Status", value: `${statusEmoji} ${receipt.status.toUpperCase()}`, inline: true },
          { name: "Items", value: receipt.items.map(i => `• ${i.name} × ${i.qty} — ₹${(i.price * i.qty).toLocaleString("en-IN")}`).join("\n") },
          { name: "Created", value: new Date(receipt.createdAt).toLocaleString("en-IN") },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (e) { await interaction.editReply("❌ Error fetching receipt."); }
  }

  if (commandName === "confirm" || commandName === "reject") {
    const id = parseReceiptId(interaction.options.getString("id"));
    if (!isValidReceiptId(id)) return interaction.reply({ content: "❌ Invalid receipt ID format.", ephemeral: true });
    const status = commandName === "confirm" ? "confirmed" : "rejected";
    await interaction.deferReply();
    try {
      const res = await fetch(`${API}/bot/receipt/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-bot-secret": BOT_SECRET },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) return interaction.editReply(`❌ ${data.message}`);
      const emoji = status === "confirmed" ? "✅" : "❌";
      await interaction.editReply(`${emoji} Receipt **${id}** has been **${status}**! Total: ₹${data.receipt.total.toLocaleString("en-IN")}`);
    } catch (e) { await interaction.editReply("❌ Error updating receipt."); }
  }
});

client.login(BOT_TOKEN);
