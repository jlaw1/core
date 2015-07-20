var config = require('./config');
var steam = require("steam");
var dota2 = require("dota2");
var utility = require("./utility");
var async = require('async');
var convert64To32 = utility.convert64to32;
var express = require('express');
var app = express();
var users = config.STEAM_USER.split(",");
var passes = config.STEAM_PASS.split(",");
var steamObj = {};
var accountToIdx = {};
var replayRequests = 0;
var launch = new Date();
var a = [];
var port = config.PORT;
var server = app.listen(port, function() {
    var host = server.address().address;
    console.log('[RETRIEVER] listening at http://%s:%s', host, port);
});
//create array of numbers from 0 to n
var count = 0;
while (a.length < users.length) a.push(a.length + 0);
async.each(a, function(i, cb) {
    var dotaReady = false;
    var relationshipReady = false;
    var client = new steam.SteamClient();
    client.Dota2 = new dota2.Dota2Client(client, true);
    var user = users[i];
    var pass = passes[i];
    var logOnDetails = {
        "account_name": user,
        "password": pass
    };
    client.connect();
    client.on('connected', function() {
        var steamUser = new steam.SteamUser(client);
        console.log("[STEAM] Trying to log on with %s,%s", user, pass);
        steamUser.logOn(logOnDetails);
    });
    client.on("logOnResponse", function onSteamLogOn() {
        console.log("[STEAM] Logged on %s", client.steamID);
        var steamFriends = new steam.SteamFriends(client);
        steamFriends.setPersonaName("[YASP] " + client.steamID);
        steamObj[client.steamID] = client;
        client.replays = 0;
        client.profiles = 0;
        client.Dota2.launch();
        steamFriends.on("relationships", function() {
            //console.log(Steam.EFriendRelationship);
            console.log("searching for pending friend requests...");
            //friends is a object with key steam id and value relationship
            //console.log(Steam.friends);
            for (var prop in client.friends) {
                //iterate through friends and accept requests/populate hash
                var steamID = prop;
                var relationship = client.friends[prop];
                //friends that came in while offline
                if (relationship === client.EFriendRelationship.PendingInvitee) {
                    client.addFriend(steamID);
                    console.log(steamID + " was added as a friend");
                }
                accountToIdx[convert64To32(steamID)] = client.steamID;
            }
            console.log("finished searching");
        });
        steamFriends.once("relationships", function() {
            //console.log("relationships obtained");
            relationshipReady = true;
            allDone();
        });
        steamFriends.on("friend", function(steamID, relationship) {
            //immediately accept incoming friend requests
            if (relationship === client.EFriendRelationship.PendingInvitee) {
                console.log("friend request received");
                client.addFriend(steamID);
                console.log("friend request accepted");
                accountToIdx[convert64To32(steamID)] = client.steamID;
            }
            if (relationship === client.EFriendRelationship.None) {
                delete accountToIdx[convert64To32(steamID)];
            }
        });
    });
    client.on('error', function onSteamError(e) {
        //reset
        process.exit(1);
    });
    client.on('loggedOff', function() {
        //reset
        process.exit(1);
    });
    client.Dota2.once("ready", function() {
        //console.log("Dota 2 ready");
        dotaReady = true;
        allDone();
    });

    function allDone() {
        if (dotaReady && relationshipReady) {
            count += 1;
            console.log("acct %s ready, %s/%s", i, count, users.length);
            cb();
        }
    }
}, function() {
    //start listening
    app.get('/', function(req, res, next) {
        //console.log(process.memoryUsage());
        if (config.RETRIEVER_SECRET && config.RETRIEVER_SECRET !== req.query.key) {
            //reject request if doesnt have key
            return next("invalid key");
        }
        res.locals.to = setTimeout(function() {
            next("retriever timeout");
        }, 25000);
        var r = Object.keys(steamObj)[Math.floor((Math.random() * users.length))];
        if (req.query.match_id) {
            getGCReplayUrl(r, req.query.match_id, function(err, data) {
                res.locals.data = data;
                return next(err);
            });
        }
        else if (req.query.account_id) {
            var idx = accountToIdx[req.query.account_id] || r;
            getPlayerProfile(idx, req.query.account_id, function(err, data) {
                res.locals.data = data;
                return next(err);
            });
        }
        else {
            res.locals.data = genStats();
            return next();
        }
    });
    app.use(function(req, res) {
        clearTimeout(res.locals.to);
        res.json(res.locals.data);
    });
    app.use(function(err, req, res, next) {
        return res.status(500).json({
            error: err
        });
    });
});

function genStats() {
    var stats = {};
    for (var key in steamObj) {
        stats[key] = {
            steamID: key,
            replays: steamObj[key].replays,
            profiles: steamObj[key].profiles,
            friends: Object.keys(steamObj[key].friends).length
        };
    }
    var data = {
        replayRequests: replayRequests,
        uptime: (new Date() - launch) / 1000,
        accounts: stats,
        accountToIdx: accountToIdx
    };
    return data;
}

function getPlayerProfile(idx, account_id, cb) {
    account_id = Number(account_id);
    var Dota2 = steamObj[idx].Dota2;
    console.log("requesting player profile %s", account_id);
    steamObj[idx].profiles += 1;
    Dota2.profileRequest(account_id, false, function(accountId, profileData) {
        console.log(accountId, profileData);
        var error = profileData.result === 1 ? null : profileData.result;
        cb(error, profileData.gameAccountClient);
    });
}

function getGCReplayUrl(idx, match_id, cb) {
    match_id = Number(match_id);
    var Dota2 = steamObj[idx].Dota2;
    console.log("[DOTA] requesting replay %s, numusers: %s", match_id, users.length);
    replayRequests += 1;
    if (replayRequests >= 500) {
        selfDestruct();
    }
    steamObj[idx].replays += 1;
    Dota2.matchDetailsRequest(match_id, function(err, data) {
        cb(err, data);
    });
}

function selfDestruct() {
    process.exit(0);
}