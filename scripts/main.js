import { world, system } from "@minecraft/server";

const lastChat = new Map();

// --- HELPER: Find player by partial name ---
function findTarget(name) {
    const players = world.getAllPlayers();
    return players.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
}

world.beforeEvents.chatSend.subscribe((ev) => {
    const player = ev.sender;
    const msg = ev.message;
    const now = Date.now();

    // 1. MUTE CHECK
    const isMuted = player.getDynamicProperty("isMuted");
    if (isMuted) {
        ev.cancel = true;
        system.run(() => player.sendMessage("§cYou are muted and cannot speak in chat."));
        return;
    }

    // 2. SPAM PROTECTION
    if (lastChat.has(player.id) && now - lastChat.get(player.id) < 1500) {
        ev.cancel = true;
        system.run(() => player.sendMessage("§cPlease wait before typing again."));
        return;
    }
    lastChat.set(player.id, now);

    // 3. COMMAND SYSTEM
    if (msg.startsWith(".")) {
        ev.cancel = true;
        const args = msg.slice(1).split(" ");
        const cmd = args[0].toLowerCase();
        system.run(() => handleCommand(player, cmd, args));
        return;
    }

    // 4. CHAT FORMATTING
    ev.cancel = true;
    let prefix = "§7[Member]§r ";
    let nameColor = player.hasTag("on_duty") ? "§a" : "§f";

    if (player.hasTag("rank:admin")) prefix = "§4[Admin]§r ";
    else if (player.hasTag("rank:mod")) prefix = "§b[Mod]§r ";

    system.run(() => {
        world.sendMessage(`${prefix}${nameColor}${player.name}§r: ${msg}`);
    });
});

function handleCommand(player, cmd, args) {
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");
    const isStaff = isAdmin || isMod;
    const onDuty = player.hasTag("on_duty");

    const validCommands = ["duty", "gm", "punish", "pardon", "sc", "tp", "view"];
    if (!validCommands.includes(cmd)) {
        player.sendMessage(`§cError: ".${cmd}" is not a command.`);
        return;
    }

    // --- REQUIRE DUTY FOR STAFF COMMANDS ---
    if (["gm", "punish", "pardon", "sc", "tp", "view"].includes(cmd) && !onDuty && isStaff) {
        player.sendMessage("§cYou must be .duty to use staff commands!");
        return;
    }

    switch (cmd) {
        case "duty":
            if (!isStaff) return;
            if (onDuty) {
                player.removeTag("on_duty");
                player.nameTag = player.name;
                player.sendMessage("§cDuty Off.");
            } else {
                player.addTag("on_duty");
                player.nameTag = `§a${player.name}`;
                player.sendMessage("§aDuty On!");
            }
            break;

        case "sc":
            const staffMsg = args.slice(1).join(" ");
            if (!staffMsg) return player.sendMessage("§cUsage: .sc [message]");
            world.getAllPlayers().filter(p => p.hasTag("rank:admin") || p.hasTag("rank:mod")).forEach(p => {
                p.sendMessage(`§e[STAFF] §7${player.name}: §f${staffMsg}`);
            });
            break;

        case "gm":
            if (!isAdmin) return;
            const modes = { "0": "survival", "1": "creative", "2": "adventure", "3": "spectator" };
            const selectedMode = modes[args[1]];
            if (!selectedMode) return player.sendMessage("§cUsage: .gm [0|1|2|3]");
            player.runCommand(`gamemode ${selectedMode}`);
            break;

        case "tp":
            const tpTarget = findTarget(args[1] || "");
            if (!tpTarget) return player.sendMessage("§cPlayer not found.");
            player.runCommand(`tp "${tpTarget.name}"`);
            break;

        case "punish":
            const target = findTarget(args[1] || "");
            const type = args[2];
            const reason = args.slice(3).join(" ") || "No reason provided";

            if (!target || !["warn", "kick", "ban", "mute"].includes(type)) {
                return player.sendMessage("§cUsage: .punish [name] [warn|kick|ban|mute] [reason]");
            }

            // Save punishment to player history
            let history = target.getDynamicProperty("history") || "";
            target.setDynamicProperty("history", history + `[${type.toUpperCase()}: ${reason}] `);

            if (type === "mute") {
                target.setDynamicProperty("isMuted", true);
                target.sendMessage("§cYou have been muted by staff.");
            } else if (type === "kick" || type === "ban") {
                player.runCommand(`kick "${target.name}" ${reason}`);
            }
            world.sendMessage(`§6[Staff] §f${target.name} §7punished: §f${type} §7for §f${reason}`);
            break;

        case "view":
            const viewTarget = findTarget(args[1] || "");
            if (!viewTarget) return player.sendMessage("§cPlayer not found.");
            const logs = viewTarget.getDynamicProperty("history") || "No prior punishments.";
            player.sendMessage(`§e--- History for ${viewTarget.name} --- \n§f${logs}`);
            break;

        case "pardon":
            if (!isAdmin) return;
            const pTarget = findTarget(args[1] || "");
            if (!pTarget) return player.sendMessage("§cPlayer not found.");
            pTarget.setDynamicProperty("history", "");
            pTarget.setDynamicProperty("isMuted", false);
            player.sendMessage(`§aCleared data for ${pTarget.name}.`);
            break;
    }
}
