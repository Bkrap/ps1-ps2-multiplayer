create a simple workflow for a ps1 multiplayer league platform (protoype game is tekken 3):

see leaderboard, league details, CTA to join league
prompt to register to participate
create room, join room
room can be created or joined private or public
if public then based on ELO (if player base is wide enough) merge those two to play
controllers must be assigned and first step to make sure it works before starting match
then screen share accept to record the in game
match is over, the recorded screen is sent to CMS via REST API into proper field for review
all public rooms are available for spectators to join
after review (if he did not particiapte as spectator live) admin notes the scores and scores are assigned to users
elo is caluclated automatically after score input