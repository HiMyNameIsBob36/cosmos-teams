import { world, system } from "@minecraft/server";

// --- Persistence & State ---
const combatTimers = new Map(); // player.name -> tick timestamp
const tpRequests = new Map();   // targetName -> requesterName
let inviteCounter = 1000;

function getTeams() {
    const raw = world.getDynamicProperty("cosmos_teams");
    return raw ? JSON.parse(raw) : {};
}

function saveTeams(teams) {
    world.setDynamicProperty("cosmos_teams", JSON.stringify(teams));
}

// --- Sound Helpers ---
function playSound(player, sound, pitch = 1) {
    player.runCommandAsync(`playsound ${sound} @s ~ ~ ~ 1 ${pitch}`);
}

// --- Combat Logic ---
world.afterEvents.entityHitEntity.subscribe((ev) => {
    if (ev.damagingEntity.typeId === "minecraft:player") {
        const player = ev.damagingEntity;
        if (!combatTimers.has(player.name)) {
            player.sendMessage("§c§l! §r§7You are now in combat. Commands disabled.");
        }
        combatTimers.set(player.name, system.currentTick + (15 * 20));
    }
});

world.afterEvents.entityDie.subscribe((ev) => {
    if (ev.deadEntity.typeId === "minecraft:player") {
        combatTimers.delete(ev.deadEntity.name);
    }
});

// --- Main Helper Functions ---
function findMemberInTeam(team, inputName) {
    if (!inputName) return null;
    return team.members.find(m => m.toLowerCase().includes(inputName.toLowerCase()));
}

function sendFullHelp(player) {
    player.sendMessage("§l§s--- Cosmos Teams V2 ---");
    player.sendMessage("§s.team §7- Commands list");
    player.sendMessage("§s.team info {user} §7- Teammate stats/coords");
    player.sendMessage("§s.team create {name} §7- Start a team");
    player.sendMessage("§s.team request {team} §7- Ask to join");
    player.sendMessage("§s.team invites §7- View requests with IDs");
    player.sendMessage("§s.team accept/decline {id} §7- Handle requests");
    player.sendMessage("§s.team tp {user} §7- Send TP request");
    player.sendMessage("§s.team tp accept §7- Accept incoming TP");
    player.sendMessage("§s.team h (set) §7- Home management (3s delay)");
    player.sendMessage("§s.team kick {user} §7- Remove member (works offline)");
}

// --- Command Interceptor ---
world.beforeEvents.chatSend.subscribe((data) => {
    const { sender, message } = data;
    const teams = getTeams();
    const myTeamName = Object.keys(teams).find(n => teams[n].members.includes(sender.name));

    // Team Chat Logic
    if (sender.hasTag("teamChat") && !message.startsWith(".")) {
        data.cancel = true;
        if (!myTeamName) {
            sender.removeTag("teamChat");
            return;
        }
        const teamMembers = teams[myTeamName].members;
        world.getAllPlayers().filter(p => teamMembers.includes(p.name)).forEach(p => {
            p.sendMessage(`§7[§l§sTEAM§r§7] <§f${sender.name}> ${message}`);
        });
        return;
    }

    if (!message.startsWith(".team")) return;
    data.cancel = true;

    const args = message.split(" ");
    let cmd = args[1]?.toLowerCase();

    // Command Aliases
    if (cmd === "h") cmd = "home";

    system.run(() => {
        // Combat Check
        if (combatTimers.has(sender.name)) {
            const expiry = combatTimers.get(sender.name);
            if (system.currentTick < expiry) {
                playSound(sender, "note.bass", 0.5);
                return sender.sendMessage("§c§l! §r§fYou cannot use commands while in combat!");
            } else {
                combatTimers.delete(sender.name);
            }
        }

        const team = teams[myTeamName];

        switch (cmd) {
            case "create":
                if (myTeamName) return sender.sendMessage("§cAlready in a team.");
                const name = args[2];
                if (!name) return sender.sendMessage("§cUsage: .team create {name}");
                teams[name] = { 
                    owner: sender.name, 
                    managers: [sender.name], 
                    members: [sender.name], 
                    requests: [], // Format: { id: 1234, name: "player" }
                    home: null 
                };
                saveTeams(teams);
                sender.sendMessage(`§a§l+§r§f Team '${name}' created!`);
                break;

            case "request":
                if (myTeamName) return sender.sendMessage("§cLeave your team first.");
                const targetT = teams[args[2]];
                if (!targetT) return sender.sendMessage("§cTeam not found.");
                const reqId = Math.floor(1000 + Math.random() * 9000);
                targetT.requests.push({ id: reqId, name: sender.name });
                saveTeams(teams);
                sender.sendMessage(`§a§l+§r§f Request sent! (ID: ${reqId})`);
                break;

            case "invites":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                sender.sendMessage("§l§s--- Pending Requests ---");
                team.requests.forEach(r => sender.sendMessage(`§fID: §s${r.id} §f- Name: §7${r.name}`));
                if (team.requests.length === 0) sender.sendMessage("§7No pending invites.");
                break;

            case "accept":
            case "decline":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                const idArg = parseInt(args[2]);
                const reqIdx = team.requests.findIndex(r => r.id === idArg);
                if (reqIdx === -1) return sender.sendMessage("§cInvalid Request ID.");
                
                const request = team.requests[reqIdx];
                if (cmd === "accept") {
                    team.members.push(request.name);
                    sender.sendMessage(`§aAccepted ${request.name}`);
                } else {
                    sender.sendMessage(`§cDeclined ${request.name}`);
                }
                team.requests.splice(reqIdx, 1);
                saveTeams(teams);
                break;

            case "info":
                if (!team) return sender.sendMessage("§cYou have no team.");
                const infoName = findMemberInTeam(team, args[2]);
                const infoPlayer = world.getAllPlayers().find(p => p.name === infoName);
                if (!infoPlayer) return sender.sendMessage("§cTeammate is offline.");
                
                const loc = infoPlayer.location;
                sender.sendMessage(`§s§l--- ${infoName} Info ---`);
                sender.sendMessage(`§fHP: §a${Math.round(infoPlayer.getComponent("health").currentValue)}`);
                sender.sendMessage(`§fPos: §7${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)}`);
                break;

            case "tp":
                if (!team) return sender.sendMessage("§cYou have no team.");
                if (args[2] === "accept") {
                    const requesterName = tpRequests.get(sender.name);
                    if (!requesterName) return sender.sendMessage("§cNo pending TP requests.");
                    const reqPlayer = world.getAllPlayers().find(p => p.name === requesterName);
                    if (reqPlayer) {
                        reqPlayer.teleport(sender.location);
                        playSound(reqPlayer, "mob.enderman.portal");
                        reqPlayer.sendMessage("§aTP Request accepted!");
                    }
                    tpRequests.delete(sender.name);
                    return;
                }
                const tpTargetName = findMemberInTeam(team, args[2]);
                const pTarget = world.getAllPlayers().find(p => p.name === tpTargetName);
                if (pTarget) {
                    tpRequests.set(pTarget.name, sender.name);
                    pTarget.sendMessage(`§s${sender.name} §frequests to TP to you. Type §s.team tp accept`);
                    sender.sendMessage(`§7TP request sent to ${tpTargetName}.`);
                } else sender.sendMessage("§cPlayer not online.");
                break;

            case "home":
                if (!team) return sender.sendMessage("§cNo team.");
                if (args[2] === "set") {
                    if (team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                    team.home = { x: sender.location.x, y: sender.location.y, z: sender.location.z, dimension: sender.dimension.id };
                    saveTeams(teams);
                    sender.sendMessage("§aHome set!");
                } else {
                    if (!team.home) return sender.sendMessage("§cHome not set.");
                    sender.sendMessage("§7Teleporting in §s3s§7... Don't move!");
                    system.runTimeout(() => {
                        sender.teleport({ x: team.home.x, y: team.home.y, z: team.home.z });
                        playSound(sender, "mob.enderman.portal");
                    }, 60); // 60 ticks = 3 seconds
                }
                break;

            case "kick":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                const kickName = team.members.find(m => m.toLowerCase() === args[2]?.toLowerCase());
                if (!kickName) return sender.sendMessage("§cMember not found in team.");
                if (kickName === team.owner) return sender.sendMessage("§cCannot kick the owner.");
                
                team.members = team.members.filter(m => m !== kickName);
                team.managers = team.managers.filter(m => m !== kickName);
                saveTeams(teams);
                sender.sendMessage(`§cKicked ${kickName} from the team.`);
                break;

            default:
                sendFullHelp(sender);
                break;
        }
    });
});
