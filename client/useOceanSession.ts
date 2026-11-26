import { useCallback, useEffect, useRef, useState } from "react";
import { OceanFishingGame, type OceanAction } from "../src/ocean-game.js";
import { freshOceanState, type OceanState } from "./types.js";

type OceanMessage = {
  type: "ocean";
  state: OceanState;
  serverNow: number;
  controllers: number;
  displays: number;
};

export function useOceanSession() {
  const demoMode = __EXHIBITION_MODE__ || new URLSearchParams(location.search).get("demo") === "1";
  const controllerId = demoMode ? null : new URLSearchParams(location.search).get("controller");
  const isPhone = Boolean(controllerId);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | undefined>(undefined);
  const closingRef = useRef(false);
  const gameRef = useRef<OceanFishingGame | null>(null);
  const demoReelingRef = useRef(false);
  const [state, setState] = useState<OceanState>(freshOceanState);
  const [online, setOnline] = useState(false);
  const [controllerCount, setControllerCount] = useState(0);
  const [displayConnected, setDisplayConnected] = useState(true);
  const [roomId, setRoomId] = useState(controllerId ?? "");
  const [pairingUrl, setPairingUrl] = useState("");

  const send = useCallback((input: Record<string, unknown>) => {
    if (demoMode) {
      if (input.action === "reel") {
        demoReelingRef.current = input.held === true;
        return true;
      }
      const game = gameRef.current;
      if (!game) return false;
      const action = input as unknown as OceanAction;
      if (!game.action(action, Date.now())) return false;
      setState(game.snapshot());
      return true;
    }

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(input));
    return true;
  }, [demoMode]);

  useEffect(() => {
    let retries = 0;
    closingRef.current = false;

    if (demoMode) {
      const game = new OceanFishingGame();
      gameRef.current = game;
      demoReelingRef.current = false;
      setState(game.snapshot());
      setOnline(true);
      setControllerCount(0);
      setDisplayConnected(true);
      setRoomId("");
      setPairingUrl("");

      let previousFrame = performance.now();
      const timer = window.setInterval(() => {
        const currentFrame = performance.now();
        const delta = Math.min((currentFrame - previousFrame) / 1000, 0.1);
        previousFrame = currentFrame;
        if (game.state.phase === "idle" || game.state.phase === "caught" || game.state.phase === "escaped") return;
        game.step(delta, demoReelingRef.current, Date.now());
        setState(game.snapshot());
      }, 50);

      return () => {
        window.clearInterval(timer);
        gameRef.current = null;
        demoReelingRef.current = false;
        setOnline(false);
      };
    }

    const connect = async () => {
      try {
        let id = controllerId;
        if (!id) {
          const response = await fetch("/api/ocean-sessions", { method: "POST" });
          if (!response.ok) throw new Error("room");
          const payload = await response.json() as { id: string; controllerUrl?: string };
          id = payload.id;
          setPairingUrl(payload.controllerUrl ?? `${location.origin}/?controller=${id}`);
        } else {
          setPairingUrl("");
        }
        if (!/^sea_[a-f0-9]{32}$/.test(id)) throw new Error("link");
        setRoomId(id);
        const url = new URL("/ocean-ws", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("room", id);
        url.searchParams.set("role", isPhone ? "controller" : "display");
        const socket = new WebSocket(url);
        socketRef.current = socket;
        socket.addEventListener("open", () => { retries = 0; setOnline(true); });
        socket.addEventListener("message", event => {
          try {
            const message = JSON.parse(event.data) as OceanMessage;
            if (message.type !== "ocean") return;
            setState(message.state);
            setControllerCount(message.controllers);
            setDisplayConnected(message.displays > 0);
          } catch { /* malformed server input is ignored by the client */ }
        });
        socket.addEventListener("close", () => {
          setOnline(false);
          if (closingRef.current) return;
          if (!isPhone) { setRoomId(""); setPairingUrl(""); }
          if (retries++ < 4) retryRef.current = window.setTimeout(connect, 1000 + retries * 500);
        });
        socket.addEventListener("error", () => setOnline(false));
      } catch {
        setOnline(false);
        if (retries++ < 4) retryRef.current = window.setTimeout(connect, 1000 + retries * 500);
      }
    };
    void connect();
    return () => {
      closingRef.current = true;
      window.clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, [controllerId, demoMode, isPhone]);

  return { controllerId, isPhone, demoMode, state, online, controllerCount, displayConnected, roomId, pairingUrl, send };
}

