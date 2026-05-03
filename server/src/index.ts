import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { loadDemoEhr } from "./fhir/loadDemoEhr.js";
import { CareThreadStore } from "./store.js";
import { registerApi } from "./api.js";

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const store = new CareThreadStore();
registerApi(app, store);

const server = createServer(app);
const wss = new WebSocketServer({ server });

const topics = new Map<string, Set<import("ws").WebSocket>>();

function subscribe(ws: import("ws").WebSocket, topic: string) {
  let set = topics.get(topic);
  if (!set) {
    set = new Set();
    topics.set(topic, set);
  }
  set.add(ws);
}

function unsubscribeAll(ws: import("ws").WebSocket) {
  for (const set of topics.values()) {
    set.delete(ws);
  }
}

function broadcast(topic: string, payload: unknown) {
  const set = topics.get(topic);
  if (!set?.size) return;
  const msg = JSON.stringify({ topic, payload, ts: Date.now() });
  for (const client of set) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/ws")) {
    ws.close();
    return;
  }
  const topic = url.searchParams.get("topic") ?? "alerts";
  const patientId = url.searchParams.get("patientId");
  const assetId = url.searchParams.get("assetId");

  if (topic === "vitals" && patientId) {
    subscribe(ws, `vitals:${patientId}`);
  } else if (topic === "occupancy") {
    subscribe(ws, "occupancy");
  } else if (topic === "assets" && assetId) {
    subscribe(ws, `assets:${assetId}`);
  } else {
    subscribe(ws, "alerts");
  }

  ws.on("close", () => unsubscribeAll(ws));
});

async function main() {
  const ehr = await loadDemoEhr();
  await store.init(ehr);

  setInterval(() => {
    store.tickVitals();
    for (const pr of store.patients.values()) {
      broadcast(`vitals:${pr.patientId}`, {
        patientId: pr.patientId,
        ...pr.vitals,
        cewsScore: pr.cewsScore,
        timestamp: pr.lastUpdated,
      });
    }
    const activeAlerts = [...store.alerts.values()].filter((a) => !a.acknowledged);
    if (activeAlerts.length) {
      broadcast("alerts", { alerts: activeAlerts });
    }
    for (const o of store.wardOccupancyBroadcast()) {
      broadcast("occupancy", {
        wardId: o.wardId,
        occupiedBeds: o.occupiedBeds,
        totalBeds: o.totalBeds,
        timestamp: new Date().toISOString(),
      });
    }
    for (const a of store.seed.assets) {
      broadcast(`assets:${a.deviceId}`, {
        deviceId: a.deviceId,
        assetHealthScore: a.assetHealthScore,
        errorCodeRate: a.failureProbability24h * 0.4,
        timestamp: new Date().toISOString(),
      });
    }
  }, 5000);

  server.listen(PORT, () => {
    console.log(`CareThread demo API http://localhost:${PORT}/api/v1`);
    console.log(`WebSocket ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
