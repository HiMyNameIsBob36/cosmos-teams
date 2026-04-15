import { world, system, Player } from "@minecraft/server";

// --- Data Management ---
function getTeams() {
    const raw = world.getDynamicProperty("cosmos_teams");
    return raw ? JSON.parse(raw) : {};
}

function saveTeams(teams) {
    world.setDynamicProperty("cosmos_teams", JSON.stringify(teams));
}

// --- Helper: Fuzzy Name Search ---
function findMember(team, inputName) {
    return team.members.find(m => m.toLowerCase().includes(inputName.toLowerCase()));
}

// --- Join Message ---
world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn) {
        ev.player.sendMessage("§b[Cosmos] §fNever used Cosmos Teams before? Type §e.team§f in chat!");
    }
});

// --- Chat Command Handler ---
world.beforeEvents.chatSend.subscribe((data) => {
    const { sender, message } = data;
    
    // Team Chat Logic
    const teams = getTeams();
    const myTeamName = Object.keys(teams).find(n => teams[n].members.includes(sender.name));
    
    if (sender.hasTag("teamChat") && !message.startsWith(".")) {
        data.cancel = true;
        if (!myTeamName) {
            sender.removeTag("teamChat");
            sender.sendMessage("§cYou aren't in a team. Team chat disabled.");
            return;
        }
        const team = teams[myTeamName];
        world.getAllPlayers().filter(p => team.members.includes(p.name)).forEach(p => {
            p.sendMessage(`§b[Team Chat] §7${sender.name}: §f${message}`);
        });
        return;
    }

    if (!message.startsWith(".team")) return;
    data.cancel = true;

    const args = message.split(" ");
    const cmd = args[1];

    system.run(() => {
        handleCommand(sender, args, cmd, teams, myTeamName);
    });
});

function handleCommand(player, args, cmd, teams, myTeamName) {
    const team = teams[myTeamName];

    switch (cmd) {
        case "create":
            if (myTeamName) return player.sendMessage("§cYou are already in a team!");
            const newName = args[2];
            if (!newName) return player.sendMessage("§cUsage: .team create <name>");
            teams[newName] = { owner: player.name, managers: [player.name], members: [player.name], requests: [], home: null, settings: { tp: true, homes: true } };
            saveTeams(teams);
            player.sendMessage(`§aTeam '${newName}' created!`);
            break;

        case "list":
            player.sendMessage("§b--- Active Teams ---");
            Object.keys(teams).forEach(n => player.sendMessage(`§e${n} §7(${teams[n].members.length} members)`));
            break;

        case "request":
            if (myTeamName) return player.sendMessage("§cLeave your team first.");
            const targetTeam = teams[args[2]];
            if (!targetTeam) return player.sendMessage("§cTeam not found.");
            if (!targetTeam.requests.includes(player.name)) {
                targetTeam.requests.push(player.name);
                saveTeams(teams);
                player.sendMessage("§aRequest sent!");
            }
            break;

        case "accept":
            if (!team || !team.managers.includes(player.name)) return player.sendMessage("§cManager only.");
            const userToJoin = findMember({members: team.requests}, args[2]);
            if (userToJoin) {
                team.members.push(userToJoin);
                team.requests = team.requests.filter(r => r !== userToJoin);
                saveTeams(teams);
                player.sendMessage(`§aAccepted ${userToJoin}.`);
            }
            break;

        case "home":
            if (!team) return player.sendMessage("§cNo team.");
            if (args[2] === "set") {
                if (team.owner !== player.name) return player.sendMessage("§cOwner only.");
                team.home = { x: player.location.x, y: player.location.y, z: player.location.z };
                saveTeams(teams);
                player.sendMessage("§aTeam home set!");
            } else {
                if (!team.home) return player.sendMessage("§cNo home set.");
                player.teleport(team.home);
                player.sendMessage("§aTeleported home.");
            }
            break;

        case "tp":
            if (!team) return player.sendMessage("§cNo team.");
            const targetName = findMember(team, args[2]);
            const targetPlayer = world.getAllPlayers().find(p => p.name === targetName);
            if (targetPlayer) {
                player.teleport(targetPlayer.location);
                player.sendMessage(`§aTeleported to ${targetName}.`);
            }
            break;

        case "chat":
            if (player.hasTag("teamChat")) {
                player.removeTag("teamChat");
                player.sendMessage("§eTeam chat toggled OFF.");
            } else {
                player.addTag("teamChat");
                player.sendMessage("§bTeam chat toggled ON.");
            }
            break;

        case "leave":
            if (!team) return;
            if (team.owner === player.name) {
                player.sendMessage("§cUse '.team disband' if you want to delete the team.");
            } else {
                team.members = team.members.filter(m => m !== player.name);
                team.managers = team.managers.filter(m => m !== player.name);
                saveTeams(teams);
                player.sendMessage("§eLeft team.");
            }
            break;

        case "disband":
            if (!team || team.owner !== player.name) return player.sendMessage("§cOwner only.");
            delete teams[myTeamName];
            saveTeams(teams);
            player.sendMessage("§4Team disbanded.");
            break;

        default:
            player.sendMessage("§l§bCosmos Teams Help");
            player.sendMessage("§e.team create <name> §7- Start a team");
            player.sendMessage("§e.team request <team> §7- Join a team");
            player.sendMessage("§e.team home (set) §7- Team TP");
            player.sendMessage("§e.team chat §7- Toggle team messages");
            player.sendMessage("§7Note: You can only be in 1 team at a time.");
            break;
    }
}
