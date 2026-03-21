// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import {
  MousePointer2,
  MapPinned,
  PencilLine,
  Type,
  Trash2,
  Upload,
  Save,
  Download,
  X,
  ZoomIn,
  ZoomOut,
  Move,
  Image as ImageIcon,
  FileJson,
  Volume2,
  VolumeX,
} from "lucide-react";

type Point = { x: number; y: number };
type LineStyle = "solid" | "arrow" | "dashed";
type Mode = "select" | "marker" | "line" | "label";

type Token = {
  id: number;
  name: string;
  x: number;
  y: number;
  color: string;
  note: string;
  sizeScale?: number;
};

type LineItem = {
  id: number;
  name: string;
  color: string;
  points: Point[];
  style: LineStyle;
  sizeScale?: number;
};

type LabelItem = {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
};

type SelectedItem =
  | { type: "token"; id: number }
  | { type: "line"; id: number }
  | { type: "label"; id: number }
  | null;

type DraggingState =
  | { type: "token"; id: number }
  | { type: "label"; id: number }
  | null;

type ArrowHead = {
  tip: Point;
  left: Point;
  right: Point;
};

const DEFAULT_BG = "/new-sandiego-map.png";
const BGM_SRC = "/bgm.mp3";

const NATURAL_WIDTH = 1365;
const NATURAL_HEIGHT = 768;
const STORAGE_KEY = "yesterday-tactical-map-state-v1";
const MOBILE_BREAKPOINT = 900;

const COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#f43f5e",
  "#06b6d4",
  "#eab308",
  "#ffffff",
];

function clampZoom(value: number) {
  return Math.max(0.5, Math.min(3.5, value));
}

function clampMarkerScale(value: number) {
  return Math.max(0.35, Math.min(1.4, value));
}

function clampLineScale(value: number) {
  return Math.max(0.35, Math.min(1.6, value));
}

function makePath(points: Point[]) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function getContrastingTextColor(bg: string) {
  return bg.toLowerCase() === "#ffffff" ? "#111111" : "#ffffff";
}

function getArrowHead(start: Point, end: Point, size = 7): ArrowHead | null {
  if (start.x === end.x && start.y === end.y) return null;

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return {
    tip: end,
    left: {
      x: end.x - size * Math.cos(angle - Math.PI / 6),
      y: end.y - size * Math.sin(angle - Math.PI / 6),
    },
    right: {
      x: end.x - size * Math.cos(angle + Math.PI / 6),
      y: end.y - size * Math.sin(angle + Math.PI / 6),
    },
  };
}

function getRepeatedArrowHeads(points: Point[], spacing = 30, size = 7) {
  const arrows: ArrowHead[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < spacing * 0.75) continue;

    const ux = dx / length;
    const uy = dy / length;
    const count = Math.max(1, Math.floor(length / spacing));

    for (let j = 1; j <= count; j += 1) {
      const dist = Math.min(j * spacing, length - 2);
      if (dist <= 5) continue;

      const tip = { x: start.x + ux * dist, y: start.y + uy * dist };
      const tail = {
        x: tip.x - ux * size * 1.8,
        y: tip.y - uy * size * 1.8,
      };
      const arrow = getArrowHead(tail, tip, size);
      if (arrow) arrows.push(arrow);
    }
  }

  return arrows;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderArrowMarkers(
  points: Point[],
  color: string,
  keyPrefix: string,
  sizeScale = 1
) {
  const spacing = 24 * sizeScale;
  const arrowSize = 10 * sizeScale;
  const stroke = Math.max(1.2, 2.4 * sizeScale);

  return getRepeatedArrowHeads(points, spacing, arrowSize).map((arrow, index) => (
    <g key={`${keyPrefix}-${index}`}>
      <line
        x1={arrow.left.x}
        y1={arrow.left.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <line
        x1={arrow.right.x}
        y1={arrow.right.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </g>
  ));
}

function buttonStyle(active = false): React.CSSProperties {
  return {
    border: `1px solid ${active ? "#ffffff" : "#3f3f46"}`,
    borderRadius: 16,
    padding: "10px 12px",
    background: active ? "#ffffff" : "#27272a",
    color: active ? "#111111" : "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#09090b",
    color: "#ffffff",
    border: "1px solid #3f3f46",
    borderRadius: 12,
    padding: "10px 12px",
    boxSizing: "border-box",
  };
}

function sectionStyle(): React.CSSProperties {
  return {
    border: "1px solid #27272a",
    borderRadius: 18,
    background: "#09090b",
    padding: 12,
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid #27272a",
    borderRadius: 24,
    background: "#000000",
    boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
  };
}

function getTouchDistance(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchCenter(t1: Touch, t2: Touch) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

export default function App() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mapCaptureRef = useRef<HTMLDivElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const didSetInitialViewRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const touchModeRef = useRef<"none" | "pan" | "pinch">("none");
  const touchStartRef = useRef({
    distance: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    centerX: 0,
    centerY: 0,
    mapX: 0,
    mapY: 0,
  });

  const [title, setTitle] = useState("예스터데이 전술지도");
  const [background, setBackground] = useState(DEFAULT_BG);
  const [mode, setMode] = useState<Mode>("select");
  const [toolColor, setToolColor] = useState("#ef4444");
  const [newTokenName, setNewTokenName] = useState("캐릭터");
  const [newLabelText, setNewLabelText] = useState("메모");
  const [newLineName, setNewLineName] = useState("전선");
  const [lineStyle, setLineStyle] = useState<LineStyle>("solid");
  const [notes, setNotes] = useState("전술 기록 메모");

  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const [tokens, setTokens] = useState<Token[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [draftLine, setDraftLine] = useState<Point[]>([]);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [dragging, setDragging] = useState<DraggingState>(null);
  const [suppressClick, setSuppressClick] = useState(false);

  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [bgmStarted, setBgmStarted] = useState(false);

  const totalScale = baseScale * zoom;
  const isMobileLayout =
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      setTitle(data.title || "예스터데이 전술지도");
      setBackground(data.background || DEFAULT_BG);

      setTokens(
        Array.isArray(data.tokens)
          ? data.tokens.map((token: Token) => ({
              ...token,
              sizeScale: clampMarkerScale(token.sizeScale ?? 1),
            }))
          : []
      );

      setLines(
        Array.isArray(data.lines)
          ? data.lines.map((line: LineItem) => ({
              ...line,
              sizeScale: clampLineScale(line.sizeScale ?? 1),
            }))
          : []
      );

      setLabels(Array.isArray(data.labels) ? data.labels : []);
      setNotes(data.notes || "전술 기록 메모");
    } catch (error) {
      console.error("로컬 저장 상태 복원 실패", error);
    }
  }, []);

  useEffect(() => {
    const payload = { title, background, tokens, lines, labels, notes };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("로컬 저장 실패", error);
    }
  }, [title, background, tokens, lines, labels, notes]);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      setDragging(null);
      setIsPanning(false);
      window.setTimeout(() => setSuppressClick(false), 0);
    };

    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, []);

  useEffect(() => {
    const audio = new Audio(BGM_SRC);
    audio.loop = true;
    audio.volume = 0.45;
    audioRef.current = audio;

    const unlockAndPlay = async () => {
      if (!bgmEnabled || bgmStarted || !audioRef.current) return;
      try {
        await audioRef.current.play();
        setBgmStarted(true);
      } catch {
        //
      }
    };

    window.addEventListener("pointerdown", unlockAndPlay, { passive: true });
    window.addEventListener("keydown", unlockAndPlay);

    return () => {
      window.removeEventListener("pointerdown", unlockAndPlay);
      window.removeEventListener("keydown", unlockAndPlay);

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [bgmEnabled, bgmStarted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!bgmEnabled) {
      audio.pause();
      return;
    }

    if (bgmStarted) {
      audio.play().catch(() => {});
    }
  }, [bgmEnabled, bgmStarted]);

  const selectedObject = useMemo(() => {
    if (!selected) return null;
    if (selected.type === "token") {
      return tokens.find((item) => item.id === selected.id) ?? null;
    }
    if (selected.type === "line") {
      return lines.find((item) => item.id === selected.id) ?? null;
    }
    return labels.find((item) => item.id === selected.id) ?? null;
  }, [selected, tokens, lines, labels]);

  const updateBaseScale = () => {
    const frame = frameRef.current;
    if (!frame) return;

    const fitted = Math.min(
      frame.clientWidth / NATURAL_WIDTH,
      frame.clientHeight / NATURAL_HEIGHT
    );

    setBaseScale(fitted || 1);
  };

  const clampPanForScale = (nextPanX: number, nextPanY: number, nextZoom = zoom) => {
    const frame = frameRef.current;
    if (!frame) return { x: nextPanX, y: nextPanY };

    const nextTotalScale = baseScale * nextZoom;
    const scaledWidth = NATURAL_WIDTH * nextTotalScale;
    const scaledHeight = NATURAL_HEIGHT * nextTotalScale;

    let minPanX = frame.clientWidth - scaledWidth;
    let minPanY = frame.clientHeight - scaledHeight;

    if (minPanX > 0) minPanX = (frame.clientWidth - scaledWidth) / 2;
    if (minPanY > 0) minPanY = (frame.clientHeight - scaledHeight) / 2;

    const maxPanX = minPanX > 0 ? minPanX : 0;
    const maxPanY = minPanY > 0 ? minPanY : 0;

    const x = Math.min(maxPanX, Math.max(minPanX, nextPanX));
    const y = Math.min(maxPanY, Math.max(minPanY, nextPanY));

    return { x, y };
  };

  const fitWholeMap = (nextZoom = 1) => {
    const frame = frameRef.current;
    if (!frame) return;

    const nextTotalScale = baseScale * nextZoom;
    const scaledWidth = NATURAL_WIDTH * nextTotalScale;
    const scaledHeight = NATURAL_HEIGHT * nextTotalScale;

    const centeredPan = {
      x: (frame.clientWidth - scaledWidth) / 2,
      y: (frame.clientHeight - scaledHeight) / 2,
    };

    setZoom(nextZoom);
    setPan(centeredPan);
  };

  const applyInitialView = () => {
    fitWholeMap(1);
  };

  useEffect(() => {
    const run = () => {
      updateBaseScale();
    };

    run();
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, []);

  useEffect(() => {
    if (!frameRef.current) return;
    if (baseScale <= 0) return;

    if (!didSetInitialViewRef.current) {
      didSetInitialViewRef.current = true;
      requestAnimationFrame(() => {
        applyInitialView();
      });
      return;
    }

    setPan((prev) => clampPanForScale(prev.x, prev.y, zoom));
  }, [baseScale]);

  const getMapPoint = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };

    const rect = viewport.getBoundingClientRect();
    const localX = (clientX - rect.left - pan.x) / totalScale;
    const localY = (clientY - rect.top - pan.y) / totalScale;

    return {
      x: Math.max(0, Math.min(NATURAL_WIDTH, localX)),
      y: Math.max(0, Math.min(NATURAL_HEIGHT, localY)),
    };
  };

  const zoomAtClientPoint = (nextZoomRaw: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const nextZoom = clampZoom(nextZoomRaw);
    const rect = viewport.getBoundingClientRect();

    const mapX = (clientX - rect.left - pan.x) / totalScale;
    const mapY = (clientY - rect.top - pan.y) / totalScale;

    const nextTotalScale = baseScale * nextZoom;
    const nextPanX = clientX - rect.left - mapX * nextTotalScale;
    const nextPanY = clientY - rect.top - mapY * nextTotalScale;

    const clamped = clampPanForScale(nextPanX, nextPanY, nextZoom);
    setZoom(nextZoom);
    setPan(clamped);
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick) {
      setSuppressClick(false);
      return;
    }

    if (isPanning) return;
    const point = getMapPoint(e.clientX, e.clientY);

    if (mode === "marker") {
      const next: Token = {
        id: Date.now(),
        name: newTokenName || "캐릭터",
        x: point.x,
        y: point.y,
        color: toolColor,
        note: "",
        sizeScale: clampMarkerScale(1 / zoom),
      };
      setTokens((prev) => [...prev, next]);
      setSelected({ type: "token", id: next.id });
      return;
    }

    if (mode === "label") {
      const next: LabelItem = {
        id: Date.now(),
        text: newLabelText || "메모",
        x: point.x,
        y: point.y,
        color: toolColor,
      };
      setLabels((prev) => [...prev, next]);
      setSelected({ type: "label", id: next.id });
      return;
    }

    if (mode === "line") {
      setDraftLine((prev) => [...prev, point]);
      return;
    }

    setSelected(null);
  };

  const startTokenDrag = (e: React.MouseEvent, token: Token) => {
    e.stopPropagation();
    setSelected({ type: "token", id: token.id });
    setDragging({ type: "token", id: token.id });
    setSuppressClick(true);
  };

  const startLabelDrag = (e: React.MouseEvent, label: LabelItem) => {
    e.stopPropagation();
    setSelected({ type: "label", id: label.id });
    setDragging({ type: "label", id: label.id });
    setSuppressClick(true);
  };

  const startPan = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== "select" || dragging) return;

    const target = e.target as HTMLElement;
    const clickedToken = Boolean(target.closest("[data-map-token='true']"));
    const clickedLabel = Boolean(target.closest("[data-map-label='true']"));
    const clickedLine = Boolean(target.closest("[data-map-line='true']"));

    if (clickedToken || clickedLabel || clickedLine) return;

    setIsPanning(true);
    setSuppressClick(true);
    setPanStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      const next = clampPanForScale(e.clientX - panStart.x, e.clientY - panStart.y, zoom);
      setPan(next);
      return;
    }

    if (!dragging) return;
    const point = getMapPoint(e.clientX, e.clientY);

    if (dragging.type === "token") {
      setTokens((prev) =>
        prev.map((item) =>
          item.id === dragging.id ? { ...item, x: point.x, y: point.y } : item
        )
      );
      return;
    }

    setLabels((prev) =>
      prev.map((item) =>
        item.id === dragging.id ? { ...item, x: point.x, y: point.y } : item
      )
    );
  };

  const endPointerAction = () => {
    setDragging(null);
    setIsPanning(false);
    window.setTimeout(() => setSuppressClick(false), 0);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0012;
    zoomAtClientPoint(zoom + delta, e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const center = getTouchCenter(t1, t2);
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const mapX = (center.x - rect.left - pan.x) / totalScale;
      const mapY = (center.y - rect.top - pan.y) / totalScale;

      touchModeRef.current = "pinch";
      touchStartRef.current = {
        distance: getTouchDistance(t1, t2),
        zoom,
        panX: pan.x,
        panY: pan.y,
        centerX: center.x,
        centerY: center.y,
        mapX,
        mapY,
      };
      return;
    }

    if (e.touches.length === 1 && mode === "select") {
      const t = e.touches[0];
      touchModeRef.current = "pan";
      setIsPanning(true);
      setSuppressClick(true);
      setPanStart({
        x: t.clientX - pan.x,
        y: t.clientY - pan.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchModeRef.current === "pinch" && e.touches.length === 2) {
      e.preventDefault();

      const [t1, t2] = [e.touches[0], e.touches[1]];
      const currentDistance = getTouchDistance(t1, t2);
      const center = getTouchCenter(t1, t2);

      const ratio = currentDistance / Math.max(1, touchStartRef.current.distance);
      const nextZoom = clampZoom(touchStartRef.current.zoom * ratio);
      const nextTotalScale = baseScale * nextZoom;

      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const nextPanX = center.x - rect.left - touchStartRef.current.mapX * nextTotalScale;
      const nextPanY = center.y - rect.top - touchStartRef.current.mapY * nextTotalScale;

      const clamped = clampPanForScale(nextPanX, nextPanY, nextZoom);
      setZoom(nextZoom);
      setPan(clamped);
      return;
    }

    if (touchModeRef.current === "pan" && e.touches.length === 1 && mode === "select") {
      e.preventDefault();
      const t = e.touches[0];
      const next = clampPanForScale(t.clientX - panStart.x, t.clientY - panStart.y, zoom);
      setPan(next);
    }
  };

  const handleTouchEnd = () => {
    if (touchModeRef.current !== "none") {
      touchModeRef.current = "none";
      setIsPanning(false);
      window.setTimeout(() => setSuppressClick(false), 0);
    }
  };

  const completeLine = () => {
    if (draftLine.length < 2) return;

    const next: LineItem = {
      id: Date.now(),
      name: newLineName || "전선",
      color: toolColor,
      points: draftLine,
      style: lineStyle,
      sizeScale: clampLineScale(1 / zoom),
    };

    setLines((prev) => [...prev, next]);
    setSelected({ type: "line", id: next.id });
    setDraftLine([]);
  };

  const cancelDraftLine = () => setDraftLine([]);

  const deleteSelected = () => {
    if (!selected) return;

    if (selected.type === "token") {
      setTokens((prev) => prev.filter((item) => item.id !== selected.id));
    } else if (selected.type === "line") {
      setLines((prev) => prev.filter((item) => item.id !== selected.id));
    } else {
      setLabels((prev) => prev.filter((item) => item.id !== selected.id));
    }

    setSelected(null);
  };

  const exportJson = () => {
    downloadText(
      `${title.replace(/\s+/g, "_") || "map"}.json`,
      JSON.stringify({ title, background, tokens, lines, labels, notes }, null, 2)
    );
  };

  const exportJpg = async () => {
    if (!mapCaptureRef.current) return;

    try {
      const dataUrl = await htmlToImage.toJpeg(mapCaptureRef.current, {
        quality: 0.95,
        backgroundColor: "#000000",
        pixelRatio: 2,
      });

      const link = document.createElement("a");
      link.download = `${title.replace(/\s+/g, "_") || "map"}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("JPG 저장 실패", error);
      alert("JPG 저장에 실패했어요.");
    }
  };

  const importBackground = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setBackground(String(reader.result || DEFAULT_BG));
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        setTitle(data.title || "예스터데이 전술지도");
        setBackground(data.background || DEFAULT_BG);

        setTokens(
          Array.isArray(data.tokens)
            ? data.tokens.map((token: Token) => ({
                ...token,
                sizeScale: clampMarkerScale(token.sizeScale ?? 1),
              }))
            : []
        );

        setLines(
          Array.isArray(data.lines)
            ? data.lines.map((line: LineItem) => ({
                ...line,
                sizeScale: clampLineScale(line.sizeScale ?? 1),
              }))
            : []
        );

        setLabels(Array.isArray(data.labels) ? data.labels : []);
        setNotes(data.notes || "전술 기록 메모");
        setDraftLine([]);
        setSelected(null);

        requestAnimationFrame(() => {
          applyInitialView();
        });
      } catch {
        alert("JSON 불러오기에 실패했어요.");
      }
    };

    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const renameSelected = (value: string) => {
    if (!selected) return;

    if (selected.type === "token") {
      setTokens((prev) =>
        prev.map((item) => (item.id === selected.id ? { ...item, name: value } : item))
      );
      return;
    }

    if (selected.type === "line") {
      setLines((prev) =>
        prev.map((item) => (item.id === selected.id ? { ...item, name: value } : item))
      );
      return;
    }

    setLabels((prev) =>
      prev.map((item) => (item.id === selected.id ? { ...item, text: value } : item))
    );
  };

  const recolorSelected = (value: string) => {
    if (!selected) return;

    if (selected.type === "token") {
      setTokens((prev) =>
        prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item))
      );
      return;
    }

    if (selected.type === "line") {
      setLines((prev) =>
        prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item))
      );
      return;
    }

    setLabels((prev) =>
      prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item))
    );
  };

  const updateSelectedNote = (value: string) => {
    if (!selected || selected.type !== "token") return;

    setTokens((prev) =>
      prev.map((item) => (item.id === selected.id ? { ...item, note: value } : item))
    );
  };

  const resetView = () => {
    applyInitialView();
  };

  const changeZoomByButton = (delta: number) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    zoomAtClientPoint(zoom + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const toggleBgm = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (bgmEnabled) {
      setBgmEnabled(false);
      audio.pause();
      return;
    }

    setBgmEnabled(true);

    try {
      await audio.play();
      setBgmStarted(true);
    } catch (error) {
      console.error("배경음악 재생 실패", error);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: isMobileLayout ? "1fr" : "360px 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={cardStyle()}>
          <div
            style={{
              padding: 20,
              borderBottom: "1px solid #27272a",
              fontWeight: 700,
              fontSize: 24,
            }}
          >
            예스터데이 전술지도
          </div>

          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <div style={{ marginBottom: 8 }}>지도 제목</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle()} />
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>도구 선택</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button style={buttonStyle(mode === "select")} onClick={() => setMode("select")}>
                  <MousePointer2 size={16} />
                  선택/이동
                </button>
                <button style={buttonStyle(mode === "marker")} onClick={() => setMode("marker")}>
                  <MapPinned size={16} />
                  마커 찍기
                </button>
                <button style={buttonStyle(mode === "line")} onClick={() => setMode("line")}>
                  <PencilLine size={16} />
                  선 잇기
                </button>
                <button style={buttonStyle(mode === "label")} onClick={() => setMode("label")}>
                  <Type size={16} />
                  텍스트
                </button>
              </div>
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>기본 이름</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="새 마커 이름"
                  style={inputStyle()}
                />
                <input
                  value={newLineName}
                  onChange={(e) => setNewLineName(e.target.value)}
                  placeholder="새 선 이름"
                  style={inputStyle()}
                />
                <input
                  value={newLabelText}
                  onChange={(e) => setNewLabelText(e.target.value)}
                  placeholder="새 텍스트 내용"
                  style={inputStyle()}
                />
              </div>
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>선 스타일</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <button style={buttonStyle(lineStyle === "solid")} onClick={() => setLineStyle("solid")}>
                  실선
                </button>
                <button style={buttonStyle(lineStyle === "arrow")} onClick={() => setLineStyle("arrow")}>
                  화살표선
                </button>
                <button style={buttonStyle(lineStyle === "dashed")} onClick={() => setLineStyle("dashed")}>
                  점선
                </button>
              </div>
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>기본 색상</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setToolColor(color)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      border: toolColor === color ? "2px solid #fff" : "2px solid #3f3f46",
                      background: color,
                      transform: toolColor === color ? "scale(1.1)" : "scale(1)",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>지도 보기</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <button style={buttonStyle(false)} onClick={() => changeZoomByButton(-0.2)}>
                  <ZoomOut size={16} />
                  축소
                </button>
                <button style={buttonStyle(false)} onClick={() => changeZoomByButton(0.2)}>
                  <ZoomIn size={16} />
                  확대
                </button>
                <button style={buttonStyle(false)} onClick={resetView}>
                  <Move size={16} />
                  초기화
                </button>
              </div>
              <div style={{ marginTop: 8 }}>배율: {zoom.toFixed(2)}x</div>
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>배경음악</div>
              <button style={buttonStyle(false)} onClick={toggleBgm}>
                {bgmEnabled ? <VolumeX size={16} /> : <Volume2 size={16} />}
                {bgmEnabled ? "배경음악 끄기" : "배경음악 켜기"}
              </button>
              <div style={{ marginTop: 8, fontSize: 13, color: "#a1a1aa" }}>
                모바일에서는 첫 터치 뒤에 재생될 수 있어.
              </div>
            </div>

            {mode === "line" && (
              <div style={sectionStyle()}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>선 작성 중</div>
                    <div style={{ fontSize: 13 }}>지도를 클릭해서 점을 계속 추가하세요.</div>
                  </div>
                  <div
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#27272a",
                    }}
                  >
                    {draftLine.length}점
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={buttonStyle(false)}
                    onClick={completeLine}
                    disabled={draftLine.length < 2}
                  >
                    <Save size={16} />
                    선 확정
                  </button>
                  <button style={buttonStyle(false)} onClick={cancelDraftLine}>
                    <X size={16} />
                    취소
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button style={buttonStyle(false)} onClick={() => bgInputRef.current?.click()}>
                <Upload size={16} />
                배경 업로드
              </button>
              <button style={buttonStyle(false)} onClick={() => jsonInputRef.current?.click()}>
                <Download size={16} />
                불러오기
              </button>
              <button style={buttonStyle(false)} onClick={exportJson}>
                <FileJson size={16} />
                JSON 저장
              </button>
              <button style={buttonStyle(false)} onClick={exportJpg}>
                <ImageIcon size={16} />
                JPG 저장
              </button>
            </div>

            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={importBackground}
            />
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={importJson}
            />

            <div style={sectionStyle()}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 700 }}>선택된 요소</div>
                {selected && (
                  <button style={buttonStyle(false)} onClick={deleteSelected}>
                    <Trash2 size={16} />
                    삭제
                  </button>
                )}
              </div>

              {!selected || !selectedObject ? (
                <div>선택된 요소가 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#27272a",
                      width: "fit-content",
                    }}
                  >
                    {selected.type}
                  </div>

                  <input
                    style={inputStyle()}
                    value={
                      selected.type === "label"
                        ? (selectedObject as LabelItem).text
                        : (selectedObject as Token | LineItem).name
                    }
                    onChange={(e) => renameSelected(e.target.value)}
                  />

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => recolorSelected(color)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          border: "1px solid #3f3f46",
                          background: color,
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>

                  {selected.type === "token" && (
                    <textarea
                      style={{ ...inputStyle(), minHeight: 90, resize: "vertical" }}
                      value={(selectedObject as Token).note}
                      onChange={(e) => updateSelectedNote(e.target.value)}
                      placeholder="캐릭터 설명, 상태, 세력, 장비 등"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={cardStyle()}>
          <div
            style={{
              padding: 20,
              borderBottom: "1px solid #27272a",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
              <div style={{ marginTop: 6 }}>
                선택 모드에서는 드래그 이동, 휠 줌, 모바일에서는 핀치 줌 가능
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>
                마커 {tokens.length}
              </div>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>
                선 {lines.length}
              </div>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>
                텍스트 {labels.length}
              </div>
            </div>
          </div>

          <div style={{ padding: 16 }}>
            <div
              ref={mapCaptureRef}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: `${NATURAL_WIDTH} / ${NATURAL_HEIGHT}`,
                minHeight: isMobileLayout ? "58vh" : "70vh",
                maxHeight: "80vh",
                overflow: "hidden",
                borderRadius: 24,
                border: "1px solid #27272a",
                background: "#000",
                margin: "0 auto",
              }}
            >
              <div
                ref={frameRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  ref={viewportRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    cursor: isPanning ? "grabbing" : mode === "select" ? "grab" : "crosshair",
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                  onClick={handleMapClick}
                  onMouseMove={handleMouseMove}
                  onMouseUp={endPointerAction}
                  onMouseDown={startPan}
                  onWheel={handleWheel}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: NATURAL_WIDTH,
                      height: NATURAL_HEIGHT,
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${totalScale})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <img
                      src={background}
                      alt="역극 지도"
                      draggable={false}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "fill",
                        pointerEvents: "none",
                      }}
                    />

                    <svg
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                      }}
                      viewBox={`0 0 ${NATURAL_WIDTH} ${NATURAL_HEIGHT}`}
                    >
                      {lines.map((line) => {
                        const linePath = makePath(line.points);
                        const lineScale = clampLineScale(line.sizeScale ?? 1);
                        const baseStroke = line.style === "arrow" ? 3.5 : 5;
                        const strokeWidth = Math.max(1.4, baseStroke * lineScale);
                        const hitWidth = Math.max(12, 18 * lineScale);
                        const dashArray =
                          line.style === "dashed"
                            ? `${10 * lineScale} ${8 * lineScale}`
                            : undefined;

                        return (
                          <g
                            key={line.id}
                            data-map-line="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected({ type: "line", id: line.id });
                            }}
                          >
                            <path
                              d={linePath}
                              fill="none"
                              stroke={line.color}
                              strokeWidth={strokeWidth}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeDasharray={dashArray}
                            />
                            {line.style === "arrow"
                              ? renderArrowMarkers(
                                  line.points,
                                  line.color,
                                  `${line.id}-arrow`,
                                  lineScale
                                )
                              : null}
                            <path d={linePath} fill="none" stroke="transparent" strokeWidth={hitWidth} />
                          </g>
                        );
                      })}

                      {draftLine.length >= 2 ? (
                        <>
                          <path
                            d={makePath(draftLine)}
                            fill="none"
                            stroke={toolColor}
                            strokeWidth={Math.max(
                              1.4,
                              (lineStyle === "arrow" ? 3.5 : 4) * clampLineScale(1 / zoom)
                            )}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={
                              lineStyle === "dashed"
                                ? `${10 * clampLineScale(1 / zoom)} ${8 * clampLineScale(1 / zoom)}`
                                : undefined
                            }
                          />
                          {lineStyle === "arrow"
                            ? renderArrowMarkers(
                                draftLine,
                                toolColor,
                                "draft-arrow",
                                clampLineScale(1 / zoom)
                              )
                            : null}
                        </>
                      ) : null}

                      {draftLine.map((point, index) => (
                        <circle key={index} cx={point.x} cy={point.y} r={5} fill={toolColor} />
                      ))}
                    </svg>

                    {labels.map((label) => {
                      const isSelectedLabel =
                        selected?.type === "label" && selected.id === label.id;

                      return (
                        <div
                          key={label.id}
                          data-map-label="true"
                          style={{
                            position: "absolute",
                            left: label.x,
                            top: label.y,
                            transform: "translate(-50%, -50%)",
                            color: "#ffffff",
                            background: "rgba(10,10,10,0.6)",
                            padding: "4px 8px",
                            borderRadius: 8,
                            fontSize: 14,
                            fontWeight: 700,
                            boxShadow: isSelectedLabel ? "0 0 0 2px #fff" : undefined,
                            cursor: "move",
                          }}
                          onMouseDown={(e) => startLabelDrag(e, label)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected({ type: "label", id: label.id });
                          }}
                        >
                          {label.text}
                        </div>
                      );
                    })}

                    {tokens.map((token) => {
                      const isSelectedToken =
                        selected?.type === "token" && selected.id === token.id;
                      const markerScale = clampMarkerScale(token.sizeScale ?? 1);

                      return (
                        <div
                          key={token.id}
                          data-map-token="true"
                          style={{
                            position: "absolute",
                            left: token.x,
                            top: token.y,
                            transform: "translate(-50%, -100%)",
                          }}
                          onMouseDown={(e) => startTokenDrag(e, token)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected({ type: "token", id: token.id });
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 4 * markerScale,
                              cursor: "move",
                              position: "relative",
                            }}
                          >
                            <div
                              style={{
                                borderRadius: 999,
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelectedToken ? "#ffffff" : "#09090b"
                                }`,
                                padding: `${4 * markerScale}px ${12 * markerScale}px`,
                                fontSize: 12 * markerScale,
                                fontWeight: 700,
                                background: token.color,
                                color: getContrastingTextColor(token.color),
                                boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
                                whiteSpace: "nowrap",
                                lineHeight: 1.1,
                              }}
                            >
                              {token.name}
                            </div>

                            <div
                              style={{
                                width: 16 * markerScale,
                                height: 16 * markerScale,
                                transform: "rotate(45deg)",
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelectedToken ? "#ffffff" : "#09090b"
                                }`,
                                background: token.color,
                              }}
                            />

                            {isSelectedToken && mode === "select" && (
                              <div
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "absolute",
                                  left: `${48 * markerScale}px`,
                                  top: `${8 * markerScale}px`,
                                  minWidth: `${220 * markerScale}px`,
                                  maxWidth: `${280 * markerScale}px`,
                                  padding: `${12 * markerScale}px`,
                                  borderRadius: `${14 * markerScale}px`,
                                  border: "1px solid rgba(255,255,255,0.16)",
                                  background: "rgba(10,10,10,0.94)",
                                  color: "#ffffff",
                                  boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
                                  backdropFilter: "blur(6px)",
                                  zIndex: 30,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 13 * markerScale,
                                    fontWeight: 800,
                                    marginBottom: 6 * markerScale,
                                    color: token.color,
                                  }}
                                >
                                  {token.name}
                                </div>

                                <div
                                  style={{
                                    fontSize: 11 * markerScale,
                                    lineHeight: 1.45,
                                    color: "#e4e4e7",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {token.note?.trim() ? token.note : "등록된 정보가 없습니다."}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: "0 16px 16px 16px" }}>
            <div style={sectionStyle()}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>전술 메모</div>
              <textarea
                style={{ ...inputStyle(), minHeight: 140, resize: "vertical" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="작전 요약, 이동 계획, 주의 사항 등을 적어두세요."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}