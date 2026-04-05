import { world, system } from "@minecraft/server";

// --- CONFIGURATION ---
const CHAT_COOLDOWN = 1500; 
const lastChatTime = new Map();

// Using beforeEvents allows us to cancel the message (important for commands and ranks)
// If this still says undefined, double check that "Beta APIs" is ON in world settings.
world.beforeEvents.chatSend.subscribe((event) => {
    const sender = event.sender;
    const message = event.message;
    const now = Date.now();

    // 1. SPAM PROTECTION
    if (lastChatTime.has(sender.id)) {
        const diff = now - lastChatTime.get(sender.id);
        if (diff < CHAT_COOLDOWN) {
            event.cancel = true;
            // Use system.run to send messages from within a 'before' event
            system.run(() => {
                sender.sendMessage("§cPlease don't spam!");
            });
            return;
        }
    }
    lastChatTime.set(sender.id, now);

    // 2. COMMAND SYSTEM (using ".")
    if (message.startsWith(".")) {
        event.cancel = true; 
        const args = message.slice(1).split(" ");
        const command = args[0].toLowerCase();

        system.run(() => {
            handleCommand(sender, command, args);
        });
        return;
    }

    // 3. CHAT RANKS & COLORS
    event.cancel = true; 
    let prefix = "§7[Member]§r ";
    let nameColor = "§f"; 

    if (sender.hasTag("rank:admin")) prefix = "§4[Admin]§r ";
    else if (sender.hasTag("rank:mod")) prefix = "§b[Mod]§r ";

    if (sender.hasTag("on_duty")) nameColor = "§a"; 

    // Broadcast the formatted message
    system.run(() => {
        world.sendMessage(`${prefix}${nameColor}${sender.name}§r: ${message}`);
    });
});

function handleCommand(player, cmd, args) {
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");
    const isStaff = isAdmin || isMod;

    if (cmd === "duty" && isStaff) {
        if (player.hasTag("on_duty")) {
            player.removeTag("on_duty");
            player.nameTag = player.name; 
            player.sendMessage("§cShift ended.");
        } else {
            player.addTag("on_duty");
            player.nameTag = `§a${player.name}`; 
            player.sendMessage("§aShift started!");
        }
    }

    if (cmd === "gm" && isAdmin) {
        const mode = args[1] === "1" ? "creative" : "survival";
        player.runCommandAsync(`gamemode ${mode}`);
    }

    if (cmd === "kick" && isAdmin) {
        const target = args[1];
        if (target) {
            player.runCommandAsync(`kick "${target}"`);
        }
    }
}
