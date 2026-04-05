import { world, system } from "@minecraft/server";

const lastChat = new Map();

function findTarget(name) {
    if (!name) return undefined;
    const players = world.getAllPlayers();
    return players.find(p => p.name.toLowerCase() === name.toLowerCase()) || 
           players.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
}

function getSettings() {
    const raw = world.getDynamicProperty("mod_settings");
    if (!raw) return { spam: true, joinMsg: true, autoBan: true, punish: true, ranks: true, gm: true, tp: true };
    try { return JSON.parse(raw); } catch { return { spam: true, joinMsg: true, autoBan: true, punish: true, ranks: true, gm: true, tp: true }; }
}

function saveSettings(obj) {
    world.setDynamicProperty("mod_settings", JSON.stringify(obj));
}

world.afterEvents.playerSpawn.subscribe((ev) => {
    const { player, initialSpawn } = ev;
    if (!initialSpawn) return;
    if (getSettings().joinMsg) world.sendMessage(`§7[§a+§7] §f${player.name} §7has joined!`);
    const banTime = world.getDynamicProperty(`ban_${player.name}`);
    if (banTime && Date.now() < banTime) {
        system.run(() => {
            const mins = Math.ceil((banTime - Date.now()) / 60000);
            player.runCommand(`kick "${player.name}" §cTemp-Banned. Time left: ${mins}m`);
        });
    }
});

world.afterEvents.playerLeave.subscribe((ev) => {
    if (getSettings().joinMsg) world.sendMessage(`§7[§c-§7] §f${ev.playerName} §7has left!`);
});

world.beforeEvents.chatSend.subscribe((ev) => {
    const player = ev.sender;
    const msg = ev.message;
    const settings = getSettings();

    if (player.getDynamicProperty("shadowMute")) {
        ev.cancel = true;
        system.run(() => player.sendMessage(`§f${player.name}: ${msg}`));
        return;
    }

    if (settings.spam && lastChat.has(player.id) && Date.now() - lastChat.get(player.id) < 1500) {
        ev.cancel = true;
        system.run(() => player.sendMessage("§cSlow down!"));
        return;
    }
    lastChat.set(player.id, Date.now());

    if (msg.startsWith(".")) {
        ev.cancel = true;
        system.run(() => handleCommand(player, msg.slice(1).split(" ")));
        return;
    }

    if (settings.ranks) {
        ev.cancel = true;
        let prefix = player.hasTag("rank:admin") ? "§4[Admin]§r " : (player.hasTag("rank:mod") ? "§b[Mod]§r " : "§7[Member]§r ");
        let nameColor = player.hasTag("on_duty") ? "§a" : "§f";
        system.run(() => world.sendMessage(`${prefix}${nameColor}${player.name}§r: ${msg}`));
    }
});

function handleCommand(player, args) {
    const cmd = args[0].toLowerCase();
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");
    const isStaff = isAdmin || isMod;
    const onDuty = player.hasTag("on_duty");
    const s = getSettings();

    const validCmds = ["duty", "gm", "punish", "pardon", "sc", "tp", "view", "invsee", "settings", "help"];
    if (!validCmds.includes(cmd)) return player.sendMessage(`§cError: ".${cmd}" is not a command.`);
    if (cmd !== "duty" && cmd !== "help" && cmd !== "settings" && isStaff && !onDuty) return player.sendMessage("§cYou must be .duty to use staff commands!");

    switch (cmd) {
        case "help":
            player.sendMessage("§b--- Command List ---");
            player.sendMessage("§b.duty §7- Toggle staff shift");
            player.sendMessage("§b.sc [msg] §7- Staff chat");
            player.sendMessage("§b.gm [0-3] §7- Change gamemode");
            player.sendMessage("§b.tp [player] §7- Teleport to player");
            player.sendMessage("§b.punish [player] [type] [reason] §7- Punish user");
            player.sendMessage("§b.view [player] §7- Check history");
            player.sendMessage("§b.pardon [player] §7- Clear all data");
            player.sendMessage("§b.invsee [player] §7- See inventory");
            player.sendMessage("§b.settings [key] §7- Toggle features");
            break;

        case "duty":
            if (!isStaff) return;
            if (onDuty) {
                player.removeTag("on_duty");
                player.nameTag = player.name;
                player.sendMessage("§bShift Ended.");
            } else {
                player.addTag("on_duty");
                player.nameTag = `§a${player.name}`;
                player.sendMessage("§bShift Started!");
            }
            break;

        case "sc":
            const scMsg = args.slice(1).join(" ");
            if (!scMsg) return player.sendMessage("§cUsage: .sc [msg]");
            world.getAllPlayers().filter(p => p.hasTag("rank:admin") || p.hasTag("rank:mod")).forEach(p => p.sendMessage(`§b[STAFF] §7${player.name}: §f${scMsg}`));
            break;

        case "tp":
            if (!s.tp) return player.sendMessage("§cTeleport command is disabled.");
            const tpT = findTarget(args[1]);
            if (!tpT) return player.sendMessage("§cPlayer not found.");
            player.runCommand(`tp "${player.name}" "${tpT.name}"`);
            break;

        case "gm":
            if (!isAdmin || !s.gm) return player.sendMessage("§cCommand disabled or no permission.");
            const modes = { "0": "survival", "1": "creative", "2": "adventure", "3": "spectator" };
            if (!modes[args[1]]) return player.sendMessage("§cUsage: .gm [0-3]");
            player.runCommand(`gamemode ${modes[args[1]]}`);
            break;

        case "punish":
            if (!s.punish) return player.sendMessage("§cPunishments are disabled.");
            const pTarget = findTarget(args[1]);
            const pType = args[2];
            const reason = args.slice(3).join(" ") || "No reason";
            if (!pTarget || !["warn", "kick", "ban", "mute", "shadowmute", "tempban"].includes(pType)) return player.sendMessage("§cUsage: .punish [name] [type] [reason]");
            let h = pTarget.getDynamicProperty("history") || "";
            pTarget.setDynamicProperty("history", h + `§b[${pType.toUpperCase()}: ${reason}] `);
            if (pType === "warn") {
                let w = (pTarget.getDynamicProperty("warns") || 0) + 1;
                pTarget.setDynamicProperty("warns", w);
                world.sendMessage(`§b[Staff] §f${pTarget.name} warned (${w}/8).`);
                if (w >= 8 && s.autoBan) {
                    world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + 31536000000);
                    player.runCommand(`kick "${pTarget.name}" §c8 Warnings reached.`);
                }
            } else if (pType === "tempban") {
                const time = parseInt(args[3]) || 60;
                world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + (time * 60000));
                player.runCommand(`kick "${pTarget.name}" §cTemp-banned: ${reason}`);
            } else if (pType === "shadowmute") {
                pTarget.setDynamicProperty("shadowMute", true);
            } else if (pType === "mute") {
                pTarget.setDynamicProperty("isMuted", true);
            }
            break;

        case "view":
            const vT = findTarget(args[1]);
            if (!vT) return player.sendMessage("§cPlayer not found.");
            player.sendMessage(`§bLog for ${vT.name}: §f${vT.getDynamicProperty("history") || "Clean"}`);
            break;

        case "pardon":
            if (!isAdmin) return;
            const parName = args[1];
            world.setDynamicProperty(`ban_${parName}`, 0);
            const parT = findTarget(parName);
            if (parT) {
                parT.setDynamicProperty("warns", 0);
                parT.setDynamicProperty("shadowMute", false);
                parT.setDynamicProperty("isMuted", false);
                parT.setDynamicProperty("history", "Clean");
            }
            player.sendMessage(`§bCleared all data for ${parName}`);
            break;

        case "settings":
            if (!isAdmin) return;
            let sets = getSettings();
            const key = args[1];
            if (key === "spam") sets.spam = !sets.spam;
            else if (key === "join") sets.joinMsg = !sets.joinMsg;
            else if (key === "punish") sets.punish = !sets.punish;
            else if (key === "ranks") sets.ranks = !sets.ranks;
            else if (key === "gm") sets.gm = !sets.gm;
            else if (key === "tp") sets.tp = !sets.tp;
            saveSettings(sets);
            player.sendMessage("§b--- Current Settings ---");
            player.sendMessage(`§bSpam: ${sets.spam ? "§aON" : "§cOFF"}`);
            player.sendMessage(`§bJoin/Leave: ${sets.joinMsg ? "§aON" : "§cOFF"}`);
            player.sendMessage(`§bPunishments: ${sets.punish ? "§aON" : "§cOFF"}`);
            player.sendMessage(`§bRanks: ${sets.ranks ? "§aON" : "§cOFF"}`);
            player.sendMessage(`§bGamemode: ${sets.gm ? "§aON" : "§cOFF"}`);
            player.sendMessage(`§bTeleport: ${sets.tp ? "§aON" : "§cOFF"}`);
            break;
    }
}
