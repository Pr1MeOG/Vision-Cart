const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const API = process.env.VISIONCART_API_URL;
const BOT_SECRET = process.env.DISCORD_BOT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const STAFF_ROLE_ID = process.env.DISCORD_STAFF_ROLE_ID;
const RECEIPT_ID_REGEX = /^VC-[A-Z2-9]{8}$/;
const STORE_TOPIC_REGEX = /\b(visioncart|order|receipt|payment|upi|cart|checkout|product|stock|delivery|download|login|account|discord|support|refund|admin|staff|ticket|coupon|category)\b/i;

if (!API || !BOT_SECRET || !BOT_TOKEN) {
  console.error("❌ Missing required bot env vars: VISIONCART_API_URL, DISCORD_BOT_SECRET, DISCORD_BOT_TOKEN");
  process.exit(1);
}

const parseReceiptId = (raw) => raw.trim().toUpperCase();
const isValidReceiptId = (id) => RECEIPT_ID_REGEX.test(id);
const isStoreQuestion = (text = "") => STORE_TOPIC_REGEX.test(text);
const canManageReceipts = (interaction) => !STAFF_ROLE_ID || interaction.member?.roles?.cache?.has(STAFF_ROLE_ID);

function storeSupportReply(question = "") {
  const q = question.toLowerCase();
  if (!isStoreQuestion(question)) {
    return "I can only help with VisionCart store questions: orders, receipts, payments, cart, products, account/login, coupons, and support tickets.";
  }
  if (q.includes("receipt")) return "For receipt help, use `/receipt id:VC-XXXXXXXX`. If payment is pending, share the receipt ID with staff so they can confirm or reject it.";
  if (q.includes("payment") || q.includes("upi") || q.includes("checkout")) return "For payment issues, complete UPI checkout, then use the generated receipt ID. If the status does not update, send the receipt ID to support.";
  if (q.includes("order") || q.includes("delivery") || q.includes("download")) return "For order or delivery issues, check your VisionCart order page first. If an item is missing, share your order/receipt ID with support.";
  if (q.includes("login") || q.includes("account")) return "For account issues, try email login or Google/Discord login. If your account email changed, ask staff to verify the order email.";
  if (q.includes("product") || q.includes("stock") || q.includes("cart")) return "For product/cart issues, refresh the catalog and retry. Stock can change during checkout, so remove unavailable items and add an available product.";
  if (q.includes("coupon")) return "For coupon issues, confirm the code is active and not expired. Staff can verify the coupon from the VisionCart admin panel.";
  return "I can help with VisionCart store support. Share whether this is about an order, payment, receipt, product, cart, coupon, or account login.";
}

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
  new SlashCommandBuilder()
    .setName("storehelp")
    .setDescription("Show VisionCart store support topics"),
  new SlashCommandBuilder()
    .setName("support")
    .setDescription("Ask the VisionCart store support bot a store-only question")
    .addStringOption(o => o.setName("question").setDescription("VisionCart store question").setRequired(true)),
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`✅ VisionCart Bot ready as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(client.user.id, GUILD_ID)
      : Routes.applicationCommands(client.user.id);
    await rest.put(route, { body: commands });
    console.log("✅ Slash commands registered");
  } catch (e) { console.error("❌ Command register error:", e); }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (GUILD_ID && interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: "This bot only supports the official VisionCart store server.", ephemeral: true });
  }
  const { commandName } = interaction;

  if (commandName === "storehelp") {
    return interaction.reply({
      content: [
        "**VisionCart Support Bot**",
        "I can help with: orders, receipts, UPI payments, checkout, cart, product stock, account/login, coupons, and Discord support.",
        "Use `/support question:<your VisionCart store question>` or `/receipt id:VC-XXXXXXXX`."
      ].join("\n"),
      ephemeral: true
    });
  }

  if (commandName === "support") {
    const question = interaction.options.getString("question");
    return interaction.reply({ content: storeSupportReply(question), ephemeral: true });
  }

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
    if (!canManageReceipts(interaction)) {
      return interaction.reply({ content: "Only VisionCart staff can confirm or reject receipts.", ephemeral: true });
    }
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
