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
  Eye,
  PenSquare,
} from "lucide-react";

type Point = { x: number; y: number };
type LineStyle = "solid" | "arrow" | "dashed";
type Mode = "select" | "marker" | "line" | "label";
type AppViewMode = "edit" | "view";

type Token = {
  id: number;
  name: string;
  x: number;
  y: number;
  color: string;
  note: string;
  imageSrc?: string;
};

type LineItem = {
  id: number;
  name: string;
  color: string;
  points: Point[];
  style: LineStyle;
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
  | { type: "token"; id: number; pointerId: number }
  | { type: "label"; id: number; pointerId: number }
  | null;

type ArrowHead = {
  tip: Point;
  left: Point;
  right: Point;
};

const DEFAULT_BG = "/예데지도.webp";
const NATURAL_WIDTH = 695;
const NATURAL_HEIGHT = 780;
const STORAGE_KEY = "yesterday-tactical-map-state-v1";
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
  return Math.max(0.5, Math.min(4, value));
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
      const tail = { x: tip.x - ux * size * 1.8, y: tip.y - uy * size * 1.8 };
      const arrow = getArrowHead(tail, tip, size);
      if (arrow) arrows.push(arrow);
    }
  }

  return arrows;
}

function getDistance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function getPointTowards(a: Point, b: Point, distance: number): Point {
  const length = getDistance(a, b);
  if (length === 0) return { ...b };
  const ratio = Math.max(0, Math.min(1, (length - distance) / length));
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
  };
}

function buildArrowBasePath(points: Point[], trimEnd = 16) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    const start = points[0];
    const end = getPointTowards(points[0], points[1], trimEnd);
    return makePath([start, end]);
  }

  const cloned = [...points];
  const last = cloned[cloned.length - 1];
  const prev = cloned[cloned.length - 2];
  cloned[cloned.length - 1] = getPointTowards(prev, last, trimEnd);
  return makePath(cloned);
}

function getFinalArrowHead(points: Point[], size = 10) {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const tail = getPointTowards(end, prev, size * 1.8);
  return getArrowHead(tail, end, size);
}

function renderSingleArrowHead(arrow: ArrowHead | null, keyPrefix: string, color: string) {
  if (!arrow) return null;
  return (
    <g key={keyPrefix}>
      <line
        x1={arrow.left.x}
        y1={arrow.left.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
      />
      <line
        x1={arrow.right.x}
        y1={arrow.right.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
      />
    </g>
  );
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderArrowMarkers(points: Point[], color: string, keyPrefix: string) {
  return getRepeatedArrowHeads(points, 24, 10).map((arrow, index) => (
    <g key={`${keyPrefix}-${index}`}>
      <line
        x1={arrow.left.x}
        y1={arrow.left.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <line
        x1={arrow.right.x}
        y1={arrow.right.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={2.4}
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

export default function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mapCaptureRef = useRef<HTMLDivElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const markerInputRef = useRef<HTMLInputElement | null>(null);

  const [appViewMode, setAppViewMode] = useState<AppViewMode>("view");
  const isViewMode = appViewMode === "view";

  const [isMobile, setIsMobile] = useState(false);

  const [title, setTitle] = useState("예스터데이 전술지도");
  const [background, setBackground] = useState(DEFAULT_BG);
  const [mode, setMode] = useState<Mode>("select");
  const [toolColor, setToolColor] = useState("#ef4444");
  const [lineStyle, setLineStyle] = useState<LineStyle>("solid");
  const [notes, setNotes] = useState("전술 기록 메모");
  const [customMarkerImage, setCustomMarkerImage] = useState<string>("");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panPointerId, setPanPointerId] = useState<number | null>(null);

  const [tokens, setTokens] = useState<Token[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [draftLine, setDraftLine] = useState<Point[]>([]);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [dragging, setDragging] = useState<DraggingState>(null);
  const [suppressClick, setSuppressClick] = useState(false);

  const [infoTokenId, setInfoTokenId] = useState<number | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 900);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      setTitle(data.title || "예스터데이 전술지도");
      setBackground(data.background || DEFAULT_BG);
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      setLines(Array.isArray(data.lines) ? data.lines : []);
      setLabels(Array.isArray(data.labels) ? data.labels : []);
      setNotes(data.notes || "전술 기록 메모");
      setCustomMarkerImage(data.customMarkerImage || "");
    } catch (error) {
      console.error("로컬 저장 상태 복원 실패", error);
    }
  }, []);

  useEffect(() => {
    const payload = { title, background, tokens, lines, labels, notes, customMarkerImage };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("로컬 저장 실패", error);
    }
  }, [title, background, tokens, lines, labels, notes, customMarkerImage]);

  useEffect(() => {
    const handleWindowPointerUp = () => {
      setDragging(null);
      setIsPanning(false);
      setPanPointerId(null);
      window.setTimeout(() => setSuppressClick(false), 0);
    };

    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
  }, []);

  const selectedObject = useMemo(() => {
    if (!selected) return null;
    if (selected.type === "token") return tokens.find((item) => item.id === selected.id) ?? null;
    if (selected.type === "line") return lines.find((item) => item.id === selected.id) ?? null;
    return labels.find((item) => item.id === selected.id) ?? null;
  }, [selected, tokens, lines, labels]);

  const infoToken = useMemo(() => {
    return tokens.find((item) => item.id === infoTokenId) ?? null;
  }, [infoTokenId, tokens]);

  const infoPopupStyle = useMemo(() => {
    if (!infoToken) return null;

    const popupWidth = 220;
    const popupHeight = 180;
    const gap = 24;

    let left = infoToken.x + gap;
    let top = infoToken.y - 10;
    let transform = "translate(0, -50%)";

    if (left + popupWidth > NATURAL_WIDTH - 12) {
      left = infoToken.x - gap;
      transform = "translate(-100%, -50%)";
    }

    if (top + popupHeight > NATURAL_HEIGHT - 12) {
      top = NATURAL_HEIGHT - 12;
      transform = transform.replace("-50%)", "-100%)");
    }

    if (top < 12) {
      top = 12;
      if (transform === "translate(0, -50%)") transform = "translate(0, 0)";
      if (transform === "translate(-100%, -50%)") transform = "translate(-100%, 0)";
      if (transform === "translate(0, -100%)") transform = "translate(0, 0)";
      if (transform === "translate(-100%, -100%)") transform = "translate(-100%, 0)";
    }

    return { left, top, transform };
  }, [infoToken]);

  const currentDraftPoints = draftLine;

  const getMapPoint = (clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };

    const rect = el.getBoundingClientRect();
    const localX = (clientX - rect.left - pan.x) / zoom;
    const localY = (clientY - rect.top - pan.y) / zoom;

    return {
      x: Math.max(0, Math.min(NATURAL_WIDTH, localX)),
      y: Math.max(0, Math.min(NATURAL_HEIGHT, localY)),
    };
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick) {
      setSuppressClick(false);
      return;
    }

    if (isPanning) return;

    if (isViewMode) {
      setInfoTokenId(null);
      return;
    }

    const point = getMapPoint(e.clientX, e.clientY);

    if (mode === "marker") {
      const next: Token = {
        id: Date.now(),
        name: "마커",
        x: point.x,
        y: point.y,
        color: toolColor,
        note: "",
        imageSrc: customMarkerImage || undefined,
      };
      setTokens((prev) => [...prev, next]);
      setSelected({ type: "token", id: next.id });
      setInfoTokenId(next.id);
      return;
    }

    if (mode === "label") {
      const next: LabelItem = {
        id: Date.now(),
        text: "메모",
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
    setInfoTokenId(null);
  };

  const startTokenDrag = (e: React.PointerEvent, token: Token) => {
    if (isViewMode) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected({ type: "token", id: token.id });
    setInfoTokenId(token.id);
    setDragging({ type: "token", id: token.id, pointerId: e.pointerId });
    setSuppressClick(true);
  };

  const startLabelDrag = (e: React.PointerEvent, label: LabelItem) => {
    if (isViewMode) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected({ type: "label", id: label.id });
    setDragging({ type: "label", id: label.id, pointerId: e.pointerId });
    setSuppressClick(true);
  };

  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isViewMode && mode !== "select") return;
    if (dragging) return;

    const target = e.target as HTMLElement;
    const clickedToken = Boolean(target.closest("[data-map-token='true']"));
    const clickedLabel = Boolean(target.closest("[data-map-label='true']"));
    const clickedLine = Boolean(target.closest("[data-map-line='true']"));

    if (!isViewMode && (clickedToken || clickedLabel || clickedLine)) return;

    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsPanning(true);
    setSuppressClick(true);
    setPanPointerId(e.pointerId);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      if (panPointerId !== null && e.pointerId !== panPointerId) return;
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if (!dragging || isViewMode) return;
    if (e.pointerId !== dragging.pointerId) return;

    const point = getMapPoint(e.clientX, e.clientY);

    if (dragging.type === "token") {
      setTokens((prev) => prev.map((item) => (item.id === dragging.id ? { ...item, x: point.x, y: point.y } : item)));
      return;
    }

    setLabels((prev) => prev.map((item) => (item.id === dragging.id ? { ...item, x: point.x, y: point.y } : item)));
  };

  const endPointerAction = () => {
    setDragging(null);
    setIsPanning(false);
    setPanPointerId(null);
    window.setTimeout(() => setSuppressClick(false), 0);
  };

  const completeLine = () => {
    if (draftLine.length < 2) return;

    const next: LineItem = {
      id: Date.now(),
      name: "전선",
      color: toolColor,
      points: draftLine,
      style: lineStyle,
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
      if (infoTokenId === selected.id) setInfoTokenId(null);
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
      JSON.stringify({ title, background, tokens, lines, labels, notes, customMarkerImage }, null, 2)
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
        setTokens(Array.isArray(data.tokens) ? data.tokens : []);
        setLines(Array.isArray(data.lines) ? data.lines : []);
        setLabels(Array.isArray(data.labels) ? data.labels : []);
        setNotes(data.notes || "전술 기록 메모");
        setCustomMarkerImage(data.customMarkerImage || "");
        setDraftLine([]);
        setSelected(null);
        setInfoTokenId(null);
      } catch {
        alert("JSON 불러오기에 실패했어요.");
      }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const importCustomMarker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCustomMarkerImage(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const clearCustomMarker = () => {
    setCustomMarkerImage("");
  };

  const renameSelected = (value: string) => {
    if (!selected) return;

    if (selected.type === "token") {
      setTokens((prev) => prev.map((item) => (item.id === selected.id ? { ...item, name: value } : item)));
      return;
    }

    if (selected.type === "line") {
      setLines((prev) => prev.map((item) => (item.id === selected.id ? { ...item, name: value } : item)));
      return;
    }

    setLabels((prev) => prev.map((item) => (item.id === selected.id ? { ...item, text: value } : item)));
  };

  const recolorSelected = (value: string) => {
    if (!selected) return;

    if (selected.type === "token") {
      setTokens((prev) => prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item)));
      return;
    }

    if (selected.type === "line") {
      setLines((prev) => prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item)));
      return;
    }

    setLabels((prev) => prev.map((item) => (item.id === selected.id ? { ...item, color: value } : item)));
  };

  const updateSelectedNote = (value: string) => {
    if (!selected || selected.type !== "token") return;
    setTokens((prev) => prev.map((item) => (item.id === selected.id ? { ...item, note: value } : item)));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const toggleViewMode = () => {
    setAppViewMode((prev) => (prev === "edit" ? "view" : "edit"));
    setSelected(null);
    setDraftLine([]);
    setInfoTokenId(null);
  };

  const mapElement = (
    <div
      ref={mapCaptureRef}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        aspectRatio: `${NATURAL_WIDTH} / ${NATURAL_HEIGHT}`,
        overflow: "hidden",
        borderRadius: isViewMode ? 0 : 24,
        border: isViewMode ? "none" : "1px solid #27272a",
        background: "#000",
        margin: "0 auto",
      }}
    >
      <style>
        {`
          @keyframes dashFlow {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -28; }
          }
        `}
      </style>

      <div
        ref={viewportRef}
        style={{
          position: "absolute",
          inset: 0,
          cursor: isPanning ? "grabbing" : mode === "select" || isViewMode ? "grab" : "crosshair",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onClick={handleMapClick}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerAction}
        onPointerCancel={endPointerAction}
        onPointerDown={startPan}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: NATURAL_WIDTH,
            height: NATURAL_HEIGHT,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
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
              userSelect: "none",
              WebkitUserDrag: "none",
            }}
          />

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox={`0 0 ${NATURAL_WIDTH} ${NATURAL_HEIGHT}`}>
            {lines.map((line) => {
              const linePath = makePath(line.points);
              const arrowBasePath = buildArrowBasePath(line.points, 16);

              return (
                <g
                  key={line.id}
                  data-map-line="true"
                  onClick={(e) => {
                    if (isViewMode) return;
                    e.stopPropagation();
                    setSelected({ type: "line", id: line.id });
                  }}
                >
                  <path
                    d={line.style === "arrow" ? arrowBasePath : linePath}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={line.style === "arrow" ? 3.5 : 5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={line.style === "dashed" ? "10 8" : undefined}
                  />

                  {line.style === "arrow" ? (
                    <>
                      <path
                        d={arrowBasePath}
                        fill="none"
                        stroke={line.color}
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="2 18"
                        style={{
                          opacity: 0.95,
                          animation: "dashFlow 0.9s linear infinite",
                        }}
                      />
                      {renderArrowMarkers(line.points, line.color, `${line.id}-arrow-mid`)}
                      {renderSingleArrowHead(getFinalArrowHead(line.points, 10), `${line.id}-arrow-end`, line.color)}
                    </>
                  ) : null}

                  <path d={linePath} fill="none" stroke="transparent" strokeWidth={18} />
                </g>
              );
            })}

            {!isViewMode && currentDraftPoints.length >= 2 ? (
              <>
                <path
                  d={lineStyle === "arrow" ? buildArrowBasePath(currentDraftPoints, 16) : makePath(currentDraftPoints)}
                  fill="none"
                  stroke={toolColor}
                  strokeWidth={lineStyle === "arrow" ? 3.5 : 4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={lineStyle === "dashed" ? "10 8" : undefined}
                />
                {lineStyle === "arrow" ? (
                  <>
                    <path
                      d={buildArrowBasePath(currentDraftPoints, 16)}
                      fill="none"
                      stroke={toolColor}
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="2 18"
                      style={{
                        opacity: 0.95,
                        animation: "dashFlow 0.9s linear infinite",
                      }}
                    />
                    {renderArrowMarkers(currentDraftPoints, toolColor, "draft-arrow-mid")}
                    {renderSingleArrowHead(getFinalArrowHead(currentDraftPoints, 10), "draft-arrow-end", toolColor)}
                  </>
                ) : null}
              </>
            ) : null}

            {!isViewMode &&
              currentDraftPoints.map((point, index) => (
                <circle key={index} cx={point.x} cy={point.y} r={5} fill={toolColor} />
              ))}
          </svg>

          {labels.map((label) => {
            const isSelectedLabel = selected?.type === "label" && selected.id === label.id;
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
                  boxShadow: !isViewMode && isSelectedLabel ? "0 0 0 2px #fff" : undefined,
                  cursor: isViewMode ? "default" : "move",
                  pointerEvents: isViewMode ? "none" : "auto",
                  touchAction: "none",
                }}
                onPointerDown={(e) => startLabelDrag(e, label)}
                onClick={(e) => {
                  if (isViewMode) return;
                  e.stopPropagation();
                  setSelected({ type: "label", id: label.id });
                }}
              >
                {label.text}
              </div>
            );
          })}

          {tokens.map((token) => {
            const isSelectedToken = selected?.type === "token" && selected.id === token.id;
            return (
              <div
                key={token.id}
                data-map-token="true"
                style={{
                  position: "absolute",
                  left: token.x,
                  top: token.y,
                  transform: "translate(-50%, -100%)",
                  touchAction: "none",
                  pointerEvents: "auto",
                  zIndex: infoTokenId === token.id ? 45 : 15,
                }}
                onPointerDown={(e) => {
                  if (isViewMode) {
                    e.stopPropagation();
                    return;
                  }
                  startTokenDrag(e, token);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setInfoTokenId(token.id);

                  if (!isViewMode) {
                    setSelected({ type: "token", id: token.id });
                  }
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    cursor: isViewMode ? "pointer" : "move",
                    pointerEvents: "auto",
                  }}
                >
                  <div
                    style={{
                      borderRadius: 999,
                      border: `2px solid ${!isViewMode && isSelectedToken ? "#ffffff" : "#09090b"}`,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: token.color,
                      color: getContrastingTextColor(token.color),
                      boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
                      pointerEvents: "none",
                    }}
                  >
                    {token.name}
                  </div>

                  {token.imageSrc ? (
                    <img
                      src={token.imageSrc}
                      alt="marker"
                      draggable={false}
                      style={{
                        width: 28,
                        height: 28,
                        objectFit: "contain",
                        display: "block",
                        filter: !isViewMode && isSelectedToken ? "drop-shadow(0 0 4px white)" : "none",
                        pointerEvents: "none",
                        userSelect: "none",
                        WebkitUserDrag: "none",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        transform: "rotate(45deg)",
                        border: `2px solid ${!isViewMode && isSelectedToken ? "#ffffff" : "#09090b"}`,
                        background: token.color,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {infoToken && infoPopupStyle && (
            <div
              style={{
                position: "absolute",
                left: infoPopupStyle.left,
                top: infoPopupStyle.top,
                transform: infoPopupStyle.transform,
                width: 220,
                maxWidth: 220,
                background: "rgba(0,0,0,0.9)",
                border: "1px solid #3f3f46",
                borderRadius: 16,
                padding: 12,
                zIndex: 40,
                boxShadow: "0 16px 32px rgba(0,0,0,0.45)",
                backdropFilter: "blur(8px)",
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, wordBreak: "break-word" }}>{infoToken.name}</div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "inline-block",
                      padding: "4px 8px",
                      borderRadius: 999,
                      background: infoToken.color,
                      color: getContrastingTextColor(infoToken.color),
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    마커 정보
                  </div>
                </div>
                <button
                  onClick={() => setInfoTokenId(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              <div
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.45,
                  color: "#e4e4e7",
                  fontSize: 13,
                  wordBreak: "break-word",
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              >
                {infoToken.note?.trim() || "등록된 메모가 없습니다."}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          zIndex: 20,
        }}
      >
        <button
          style={{ ...buttonStyle(false), width: "auto", background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onClick={() => setZoom((z) => clampZoom(z - 0.2))}
        >
          <ZoomOut size={16} />
        </button>
        <button
          style={{ ...buttonStyle(false), width: "auto", background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onClick={() => setZoom((z) => clampZoom(z + 0.2))}
        >
          <ZoomIn size={16} />
        </button>
        <button
          style={{ ...buttonStyle(false), width: "auto", background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onClick={resetView}
        >
          <Move size={16} />
        </button>
        <button
          style={{
            ...buttonStyle(isViewMode),
            width: "auto",
            background: isViewMode ? "#ffffff" : "rgba(0,0,0,0.65)",
            color: isViewMode ? "#111111" : "#ffffff",
            backdropFilter: "blur(4px)",
          }}
          onClick={toggleViewMode}
        >
          {isViewMode ? <PenSquare size={16} /> : <Eye size={16} />}
          {isViewMode ? "편집 모드" : "관전 모드"}
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          padding: "8px 12px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.65)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(4px)",
          zIndex: 20,
          fontWeight: 700,
        }}
      >
        {title}
      </div>
    </div>
  );

  if (isViewMode) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          background: "#000",
          color: "#fff",
          fontFamily: "Arial, sans-serif",
          position: "relative",
        }}
      >
        {mapElement}

        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={importJson}
        />

        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            zIndex: 50,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            style={{
              ...buttonStyle(false),
              width: "auto",
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(6px)",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
            onClick={() => jsonInputRef.current?.click()}
          >
            <Download size={16} />
            JSON 불러오기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: isMobile ? 8 : 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1800,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "360px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ ...cardStyle(), width: "100%", minWidth: 0 }}>
          <div style={{ padding: 20, borderBottom: "1px solid #27272a", fontWeight: 700, fontSize: 24 }}>예스터데이 전술지도</div>

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
                <button style={buttonStyle(false)} onClick={() => setZoom((z) => clampZoom(z - 0.2))}>
                  <ZoomOut size={16} />
                  축소
                </button>
                <button style={buttonStyle(false)} onClick={() => setZoom((z) => clampZoom(z + 0.2))}>
                  <ZoomIn size={16} />
                  확대
                </button>
                <button style={buttonStyle(false)} onClick={resetView}>
                  <Move size={16} />
                  초기화
                </button>
              </div>
              <div style={{ marginTop: 8 }}>배율: {zoom.toFixed(1)}x</div>
            </div>

            {mode === "line" && (
              <div style={sectionStyle()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>선 작성 중</div>
                    <div style={{ fontSize: 13 }}>지도를 클릭해서 점을 계속 추가하세요.</div>
                  </div>
                  <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>{currentDraftPoints.length}점</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={buttonStyle(false)} onClick={completeLine} disabled={currentDraftPoints.length < 2}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button style={buttonStyle(false)} onClick={() => markerInputRef.current?.click()}>
                <MapPinned size={16} />
                커스텀 마커 업로드
              </button>
              <button style={buttonStyle(false)} onClick={clearCustomMarker}>
                <X size={16} />
                커스텀 마커 해제
              </button>
            </div>

            <input ref={bgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={importBackground} />
            <input ref={jsonInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importJson} />
            <input ref={markerInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={importCustomMarker} />

            {customMarkerImage && (
              <div style={sectionStyle()}>
                <div style={{ marginBottom: 8, fontWeight: 700 }}>현재 커스텀 마커</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 70,
                    background: "#111",
                    borderRadius: 12,
                    border: "1px solid #27272a",
                  }}
                >
                  <img
                    src={customMarkerImage}
                    alt="커스텀 마커 미리보기"
                    draggable={false}
                    style={{
                      width: 34,
                      height: 34,
                      objectFit: "contain",
                      display: "block",
                      userSelect: "none",
                      WebkitUserDrag: "none",
                    }}
                  />
                </div>
              </div>
            )}

            <div style={sectionStyle()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
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
                  <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a", width: "fit-content" }}>{selected.type}</div>

                  <input
                    style={inputStyle()}
                    value={selected.type === "label" ? (selectedObject as LabelItem).text : (selectedObject as Token | LineItem).name}
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

        <div style={{ ...cardStyle(), width: "100%", minWidth: 0 }}>
          <div style={{ padding: 20, borderBottom: "1px solid #27272a", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
              <div style={{ marginTop: 6 }}>선택 모드나 관전 모드에서는 빈 배경을 드래그해 지도를 이동할 수 있습니다.</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>마커 {tokens.length}</div>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>선 {lines.length}</div>
              <div style={{ padding: "4px 10px", borderRadius: 999, background: "#27272a" }}>텍스트 {labels.length}</div>
              <div
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: isViewMode ? "#ffffff" : "#27272a",
                  color: isViewMode ? "#111111" : "#ffffff",
                  fontWeight: 800,
                }}
              >
                {isViewMode ? "관전 모드" : "편집 모드"}
              </div>
            </div>
          </div>

          <div style={{ padding: isMobile ? 8 : 16 }}>{mapElement}</div>

          <div style={{ padding: isMobile ? "0 8px 8px 8px" : "0 16px 16px 16px" }}>
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