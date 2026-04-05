import { world, system } from "@minecraft/server";

// --- CONFIGURATION ---
const CHAT_COOLDOWN = 1500; // 1.5 seconds in milliseconds
const lastChatTime = new Map();

world.beforeEvents.chatSend.subscribe((event) => {
    const { sender, message } = event;
    const now = Date.now();

    // 1. SPAM PROTECTION
    if (lastChatTime.has(sender.id)) {
        const diff = now - lastChatTime.get(sender.id);
        if (diff < CHAT_COOLDOWN) {
            event.cancel = true;
            system.run(() => sender.sendMessage("§cPlease don't spam!"));
            return;
        }
    }
    lastChatTime.set(sender.id, now);

    // 2. COMMAND SYSTEM (using "." instead of "/")
    if (message.startsWith(".")) {
        event.cancel = true; // Hide command from chat
        const args = message.slice(1).split(" ");
        const command = args[0].toLowerCase();

        system.run(() => {
            handleCommand(sender, command, args);
        });
        return;
    }

    // 3. CHAT RANKS & COLORS
    event.cancel = true; // Cancel original message to send formatted one
    let prefix = "§7[Member]§r ";
    let nameColor = "§f"; // Default white

    if (sender.hasTag("rank:admin")) prefix = "§4[Admin]§r ";
    else if (sender.hasTag("rank:mod")) prefix = "§b[Mod]§r ";

    if (sender.hasTag("on_duty")) nameColor = "§a"; // Green name if on duty

    world.sendMessage(`${prefix}${nameColor}${sender.name}§r: ${message}`);
});

// --- COMMAND HANDLER ---
function handleCommand(player, cmd, args) {
    // Permission Check
    const isStaff = player.hasTag("rank:admin") || player.hasTag("rank:mod");

    if (cmd === "duty" && isStaff) {
        if (player.hasTag("on_duty")) {
            player.removeTag("on_duty");
            player.nameTag = player.name; // Reset name tag
            player.sendMessage("§cShift ended. Name color reset.");
        } else {
            player.addTag("on_duty");
            player.nameTag = `§a${player.name}`; // Set in-game name to green
            player.sendMessage("§aShift started! Your name is now green.");
        }
    }

    if (cmd === "gm" && player.hasTag("rank:admin")) {
        const mode = args[1] === "1" ? "creative" : "survival";
        player.runCommandAsync(`gamemode ${mode}`);
        player.sendMessage(`§eGamemode set to ${mode}`);
    }

    if (cmd === "ban" && player.hasTag("rank:admin")) {
        const target = args[1];
        if (target) {
            player.runCommandAsync(`kick "${target}" Banned by staff.`);
            // Note: True 'Banning' in Bedrock usually requires a dedicated server script
            // For standard worlds, Kick is the primary tool.
        }
    }
}
