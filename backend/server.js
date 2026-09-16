import express from "express";
import http from "http";
import { Server } from "socket.io";
import pg from "pg";

const { Pool } = pg;
const app = express();
const httpServer = http.createServer(app);

const frontendUrl = process.env.FRONTEND_URL || "*";

const io = new Server(httpServer, {
  cors: {
    origin: frontendUrl,
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Planowanie Online",
    status: "online"
  });
});

app.get("/health", async (_req, res) => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    return res.json({ status: "ok", database: "not-configured" });
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    res.status(503).json({ status: "error", database: "unavailable" });
  } finally {
    await pool.end();
  }
});

const rooms = new Map();

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = "";
    for (let i = 0; i < 5; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat
    })),
    phase: room.phase
  };
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("createRoom", ({ name }, callback) => {
    const playerName = String(name || "Gracz").trim().slice(0, 20) || "Gracz";
    const code = createRoomCode();

    const room = {
      code,
      hostId: socket.id,
      phase: "WAITING",
      players: [
        {
          id: socket.id,
          name: playerName,
          seat: 1
        }
      ]
    };

    rooms.set(code, room);
    socket.join(code);

    callback?.({ ok: true, room: publicRoomState(room) });
    io.to(code).emit("roomState", publicRoomState(room));
  });

  socket.on("joinRoom", ({ code, name }, callback) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const playerName = String(name || "Gracz").trim().slice(0, 20) || "Gracz";
    const room = rooms.get(roomCode);

    if (!room) {
      callback?.({ ok: false, error: "Pokój nie istnieje." });
      return;
    }

    if (room.players.length >= 4) {
      callback?.({ ok: false, error: "Pokój jest pełny." });
      return;
    }

    if (room.phase !== "WAITING") {
      callback?.({ ok: false, error: "Gra w tym pokoju już się rozpoczęła." });
      return;
    }

    const seat = room.players.length + 1;
    room.players.push({ id: socket.id, name: playerName, seat });
    socket.join(roomCode);

    callback?.({ ok: true, room: publicRoomState(room) });
    io.to(roomCode).emit("roomState", publicRoomState(room));
  });

  socket.on("startGame", (callback) => {
    const room = [...rooms.values()].find((candidate) =>
      candidate.players.some((player) => player.id === socket.id)
    );

    if (!room) {
      callback?.({ ok: false, error: "Nie jesteś w pokoju." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Tylko host może rozpocząć grę." });
      return;
    }

    if (room.players.length < 2) {
      callback?.({ ok: false, error: "Potrzeba co najmniej 2 graczy." });
      return;
    }

    room.phase = "DEALING";
    callback?.({ ok: true });
    io.to(room.code).emit("roomState", publicRoomState(room));
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex((player) => player.id === socket.id);

      if (playerIndex === -1) continue;

      room.players.splice(playerIndex, 1);

      if (room.players.length === 0) {
        rooms.delete(code);
        continue;
      }

      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }

      room.players.forEach((player, index) => {
        player.seat = index + 1;
      });

      io.to(code).emit("roomState", publicRoomState(room));
      break;
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

const port = Number(process.env.PORT) || 3000;

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Planowanie Online server listening on port ${port}`);
});
