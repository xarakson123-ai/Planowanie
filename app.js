const SERVER_URL = "https://planowanie-server.onrender.com";
const socket = io(SERVER_URL);
let game = null;

const $ = (id) => document.getElementById(id);
const lobby = $("lobby"), room = $("room");
const message = $("message");
function showMessage(text, error = false) { message.textContent = text || ""; message.className = `message${error ? " error" : ""}`; }
function esc(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function cardText(c) { return `${c.rank}${{hearts:"♥",diamonds:"♦",clubs:"♣",spades:"♠"}[c.suit]}`; }
function cardClass(c) { return ["hearts","diamonds"].includes(c.suit) ? "card red" : "card"; }

$("createRoomButton").onclick = () => {
  const name=$("playerName").value.trim() || "Gracz";
  socket.emit("createRoom", {name}, (r) => r.ok ? showGame() : showMessage(r.error,true));
};
$("joinRoomButton").onclick = () => {
  const name=$("playerName").value.trim() || "Gracz", code=$("roomCode").value.trim().toUpperCase();
  socket.emit("joinRoom", {name,code}, (r) => r.ok ? showGame() : showMessage(r.error,true));
};
$("startGameButton").onclick = () => socket.emit("startGame", r => { if(!r.ok) showMessage(r.error,true); });
$("copyRoomButton").onclick = async () => { await navigator.clipboard.writeText(game.code); $("copyRoomButton").textContent="Skopiowano!"; setTimeout(()=>$("copyRoomButton").textContent="Kopiuj kod",1200); };

socket.on("connect", () => showMessage("Połączono z serwerem."));
socket.on("connect_error", () => showMessage("Nie można połączyć z serwerem.", true));
socket.on("gameState", (state) => { game=state; render(); });

function showGame(){ lobby.classList.add("hidden"); room.classList.remove("hidden"); showMessage(""); }
function render(){ if(!game)return; showGame(); if(game.phase==="WAITING") renderLobby(); else renderBoard(); }
function renderLobby(){
  $("roomCodeLabel").textContent=game.code; $("phaseLabel").textContent=`Oczekiwanie na graczy (${game.players.length}/4)`;
  $("players").innerHTML=game.players.map(p=>`<div class="player-row"><span class="seat">${p.seat}</span><strong>${esc(p.name)}</strong>${p.id===game.hostId?'<span class="host">HOST</span>':''}</div>`).join("");
  $("startGameButton").classList.toggle("hidden", game.hostId!==game.myId);
}
function renderBoard(){
  room.innerHTML=`<div class="game"><header><div><h1>Planowanie Online</h1><span>Pokój ${game.code} · Runda ${game.round}/7</span></div><div class="phase">${phaseText()}</div></header><div class="players board-players">${game.players.map(p=>playerBox(p)).join("")}</div><div class="table" id="table"></div><div class="hand" id="hand"></div><div id="actions"></div><div id="notice" class="notice"></div></div>`;
  $("table").innerHTML=game.table.length?game.table.map(x=>`<div class="played"><small>${esc(game.players.find(p=>p.id===x.playerId)?.name||"")}</small><div class="${cardClass(x.card)}">${cardText(x.card)}</div></div>`).join(""): '<div class="empty-table">Stół jest pusty</div>';
  $("hand").innerHTML=game.myHand.map(c=>`<button class="${cardClass(c)} ${game.currentPlayerId===game.myId&&game.phase==='PLAYING'?'playable':''}" data-card="${c.id}">${cardText(c)}</button>`).join("");
  document.querySelectorAll("[data-card]").forEach(b=>b.onclick=()=>socket.emit("playCard",{cardId:b.dataset.card},r=>{if(!r.ok)$("notice").textContent=r.error;}));
  renderActions();
}
function phaseText(){return {BIDDING:"Deklaracje",PLAYING:"Rozgrywka",ROUND_RESULT:"Wynik rundy",GAME_RESULT:"Koniec gry"}[game.phase]||game.phase;}
function playerBox(p){return `<div class="player-card ${p.id===game.currentPlayerId?'active':''}"><b>${esc(p.name)}</b><span>${p.id===game.myId?'Ty · ':''}Deklaracja: ${p.bid??'—'} · Lewy: ${p.tricksWon}</span><strong>${p.totalScore} pkt</strong></div>`}
function renderActions(){
  const a=$("actions");
  if(game.phase==="BIDDING"){
    const me=game.players.find(p=>p.id===game.myId); if(me.bid===null && game.currentPlayerId===game.myId) a.innerHTML=`<div class="bid"><b>Twoja deklaracja:</b>${Array.from({length:game.round+1},(_,i)=>`<button data-bid="${i}">${i}</button>`).join("")}</div>`; else a.innerHTML=`<p class="center">${me.bid!==null?`Zadeklarowano: <b>${me.bid}</b>`:`Czekaj na swoją kolej...`}</p>`;
    document.querySelectorAll("[data-bid]").forEach(b=>b.onclick=()=>socket.emit("submitBid",{bid:Number(b.dataset.bid)},r=>{if(!r.ok)$("notice").textContent=r.error;}));
  } else if(game.phase==="ROUND_RESULT"){
    a.innerHTML=`<div class="result"><h2>Runda ${game.round} zakończona</h2>${scoreTable(game.roundScores)}${game.hostId===game.myId?'<button id="nextRound">Następna runda</button>':''}</div>`;
    $("nextRound")?.addEventListener("click",()=>socket.emit("nextRound"));
  } else if(game.phase==="GAME_RESULT") a.innerHTML=`<div class="result"><h2>🏆 Koniec gry</h2>${scoreTable(game.history.flatMap(h=>h.scores))}<h3>Wyniki końcowe</h3>${game.final.map((p,i)=>`<p>${i+1}. <b>${esc(p.name)}</b> — ${p.totalScore} pkt</p>`).join("")}</div>`;
}
function scoreTable(scores){return `<table><tr><th>Gracz</th><th>Deklaracja</th><th>Lewy</th><th>Runda</th><th>Suma</th></tr>${scores.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.bid}</td><td>${s.tricksWon}</td><td>${s.score}</td><td>${s.totalScore}</td></tr>`).join("")}</table>`}
