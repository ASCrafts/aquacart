'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Database,
  FileText,
  Image as ImageIcon,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import useAudioRecorder from '@/hooks/useAudioRecorder';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { InventoryAnalysis, InventoryDraftResponse, InventoryRow } from '@/types/inventory-agent';

/**
 * Photo/voice in, a REVIEWABLE DRAFT out — never a database write.
 *
 * This is the fix for drift bug #6 (artifact.md, section 00): the old
 * "Sync to database" button called Prisma directly with `{ increment }`, so
 * pressing it twice doubled whatever the model extracted. There is no
 * increment left anywhere in this component. What used to be "sync" is now
 * "review, then hand off": the admin can inspect every row's confidence,
 * correct or drop what's wrong, and only then send the survivors to
 * /api/admin/inventory-agent/sync, which itself only validates and returns a
 * draft (see that route's header comment). The draft lands in sessionStorage
 * under `aquacart:stock-draft:<businessDay>` — the exact key
 * StockSheet.tsx already knows how to read — and this component navigates to
 * /admin/stock so the admin declares it the same way they would type it by
 * hand, one deliberate "Save" click, on the stock sheet itself.
 */

/** One row of the on-screen draft: the model's row, plus what the admin has edited. */
interface DraftRow extends InventoryRow {
  /** A client-only id so rows survive edits/reorders without keying on array index. */
  _key: string;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `row-${Date.now()}-${keySeq}`;
}

function confidenceTone(confidence: number): { label: string; className: string } {
  if (confidence >= 0.75) return { label: 'High', className: 'text-aq-tertiary bg-aq-tertiary-fixed/30' };
  if (confidence >= 0.4) return { label: 'Medium', className: 'text-[#92400e] bg-[#fef3c7]' };
  return { label: 'Low', className: 'text-aq-error bg-aq-error-container' };
}

export default function MultimodalInventoryAgent() {
  const { toast } = useToast();
  const router = useRouter();

  // Capture state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasProcessed, setHasProcessed] = useState(false);

  // The reviewable draft
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [transcription, setTranscription] = useState('');
  const [aiSummary, setAiSummary] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const {
    isRecording,
    duration,
    audioBlob,
    audioUrl,
    startRecording,
    stopRecording,
    clearRecording,
    error: audioError,
  } = useAudioRecorder();

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  /* ---------------------------------------------------------------- camera */

  const startCamera = async () => {
    addLog('Requesting camera access...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsCameraActive(true);
      addLog('Camera stream started.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera permission denied.';
      toast({ variant: 'destructive', title: 'Camera Error', description: message });
      addLog(`Camera error: ${message}`);
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setIsCameraActive(false);
    addLog('Camera stream stopped.');
  };

  const captureSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setImageFile(new File([blob], 'snapshot.jpg', { type: 'image/jpeg' }));
        setImagePreview(URL.createObjectURL(blob));
        addLog('Snapshot captured successfully.');
        stopCamera();
      },
      'image/jpeg',
      0.95
    );
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    addLog(`Loaded image file: ${file.name}`);
  };

  /* -------------------------------------------------------------- extract */

  const processInputs = async () => {
    if (!imageFile && !audioBlob) {
      toast({
        variant: 'destructive',
        title: 'Nothing to analyze',
        description: 'Provide an image snapshot/upload OR a voice command.',
      });
      return;
    }

    setIsProcessing(true);
    setHasProcessed(false);
    addLog('Packaging inputs for extraction...');

    try {
      const payload = new FormData();
      if (imageFile) payload.append('image', imageFile);
      if (audioBlob) payload.append('audio', audioBlob, 'command.webm');

      addLog('Sending request to /api/admin/inventory-agent...');
      const res = await fetch('/api/admin/inventory-agent', { method: 'POST', body: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Processing failed');

      const analysis = data as InventoryAnalysis;
      setRows(analysis.rows.map((row) => ({ ...row, _key: nextKey() })));
      setTranscription(analysis.transcription);
      setAiSummary(analysis.aiSummary);
      setHasProcessed(true);
      addLog(`Parsed ${analysis.rows.length} row(s) from the model.`);
      toast({
        title: '✨ Extracted',
        description:
          analysis.rows.length > 0
            ? 'Review each row below before sending it to the stock sheet.'
            : 'No fish were confidently matched — nothing to review.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not parse inputs.';
      addLog(`Error during extraction: ${message}`);
      toast({ variant: 'destructive', title: 'Extraction Failed', description: message });
    } finally {
      setIsProcessing(false);
    }
  };

  /* --------------------------------------------------------- draft editing */

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }

  function dropRow(key: string) {
    setRows((prev) => prev.filter((r) => r._key !== key));
    addLog('Dropped a row from the draft.');
  }

  /* ------------------------------------------------------------ hand off */

  const sendToStockSheet = async () => {
    const kept = rows.filter((r) => (r.productId || r.slug) && (r.declaredKg > 0 || r.pricePerKg > 0));
    if (!kept.length) {
      toast({
        variant: 'destructive',
        title: 'Nothing to send',
        description: 'Every row is either dropped, unmatched, or has no kilos or price set.',
      });
      return;
    }

    setIsSyncing(true);
    addLog(`Sending ${kept.length} row(s) to /api/admin/inventory-agent/sync for validation...`);

    try {
      const res = await fetch('/api/admin/inventory-agent/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: kept.map((r) => ({
            productId: r.productId || undefined,
            slug: r.slug || undefined,
            name: r.name,
            declaredKg: r.declaredKg,
            pricePerKg: r.pricePerKg,
            confidence: r.confidence,
            note: r.note,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not validate the draft');

      const draft = data as InventoryDraftResponse & { dropped?: number };

      // Never written to the database from here — StockSheet.tsx reads
      // exactly this key and merges it into its own editable state, so the
      // admin still presses Save themselves.
      try {
        window.sessionStorage.setItem(
          `aquacart:stock-draft:${draft.day}`,
          JSON.stringify({ day: draft.day, rows: draft.rows })
        );
      } catch {
        throw new Error('Could not stage the draft — sessionStorage is unavailable.');
      }

      addLog(`Draft staged for ${draft.day}: ${draft.rows.length} row(s) kept, ${draft.dropped ?? 0} dropped by the server.`);
      toast({
        title: '📋 Sent to the stock sheet',
        description: `${draft.rows.length} row(s) are pre-filled there — nothing is saved until you press Save on that screen.`,
      });

      router.push('/admin/stock');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prepare the draft.';
      addLog(`Sync error: ${message}`);
      toast({ variant: 'destructive', title: 'Could not hand off', description: message });
    } finally {
      setIsSyncing(false);
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto py-4 px-4 sm:px-6">
      {/* ─── Column 1 & 2: Captures & Live Feed ─── */}
      <div className="xl:col-span-2 space-y-6">
        <div className="glass-strong border border-aq-outline-variant/20 rounded-3xl p-6 shadow-aq-lg">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-aq-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white animate-pulse" />
              </div>
              <h2 className="text-lg font-bold text-aq-on-surface">Multimodal Inventory Capture</h2>
            </div>
            {hasProcessed && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-aq-tertiary bg-aq-tertiary-fixed/30 px-3 py-1 rounded-full flex items-center gap-1">
                <BadgeCheck className="w-3.5 h-3.5" /> Extracted
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Visual Capture Card */}
            <div className="flex flex-col rounded-2xl bg-aq-surface-container-low border border-aq-outline-variant/10 overflow-hidden">
              <div className="p-4 bg-aq-surface-container-high/40 border-b border-aq-outline-variant/10 flex items-center justify-between">
                <span className="text-xs font-bold text-aq-on-surface-variant flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-aq-primary" /> Visual Input
                </span>
                {isCameraActive && (
                  <span className="text-[10px] bg-aq-error/20 text-aq-error px-2 py-0.5 rounded-full font-bold animate-pulse">
                    LIVE
                  </span>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center items-center p-4 min-h-[220px] relative">
                {isCameraActive ? (
                  <div className="relative w-full h-full min-h-[200px] flex items-center justify-center rounded-xl overflow-hidden bg-black">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover aspect-[4/3]" />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                      <button
                        onClick={captureSnapshot}
                        className="touch-target h-10 px-4 rounded-xl bg-aq-gradient-primary text-white font-bold text-xs shadow-aq-button flex items-center gap-1 hover:scale-105 transition-transform"
                      >
                        <Camera className="w-3.5 h-3.5" /> Snap
                      </button>
                      <button
                        onClick={stopCamera}
                        className="touch-target h-10 px-4 rounded-xl bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center gap-1 hover:bg-aq-surface"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : imagePreview ? (
                  <div className="relative w-full h-full min-h-[200px] rounded-xl overflow-hidden shadow-aq-sm border border-aq-outline-variant/20">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a blob/object URL, not a remote host next/image can optimize */}
                    <img src={imagePreview} alt="Captured" className="w-full h-full object-cover aspect-[4/3]" />
                    <button
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                        addLog('Removed image input.');
                      }}
                      className="touch-target absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black text-white transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-4">
                    <div className="w-12 h-12 rounded-2xl bg-aq-primary-fixed flex items-center justify-center mb-3">
                      <Camera className="w-6 h-6 text-aq-primary" />
                    </div>
                    <p className="text-xs font-semibold text-aq-on-surface">Invoice, weighing scale, or catch photo</p>
                    <p className="text-[10px] text-aq-on-surface-variant mt-1 mb-4">
                      Snap live using camera or upload a file
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={startCamera}
                        className="touch-target h-9 px-3 rounded-lg bg-aq-gradient-primary text-white font-bold text-xs flex items-center gap-1 hover:scale-102 transition-transform"
                      >
                        <Camera className="w-3.5 h-3.5" /> Use Camera
                      </button>
                      <label className="touch-target h-9 px-3 rounded-lg bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer hover:bg-aq-surface">
                        <ImageIcon className="w-3.5 h-3.5 text-aq-secondary" /> Upload File
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Voice Capture Card */}
            <div className="flex flex-col rounded-2xl bg-aq-surface-container-low border border-aq-outline-variant/10 overflow-hidden">
              <div className="p-4 bg-aq-surface-container-high/40 border-b border-aq-outline-variant/10 flex items-center justify-between">
                <span className="text-xs font-bold text-aq-on-surface-variant flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-aq-tertiary" /> Voice Command
                </span>
                {audioBlob && (
                  <span className="text-[10px] bg-aq-tertiary/20 text-aq-tertiary px-2 py-0.5 rounded-full font-bold">
                    READY
                  </span>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center items-center p-4 min-h-[220px]">
                {isRecording ? (
                  <div className="flex flex-col items-center">
                    <div className="relative w-16 h-16 rounded-full bg-aq-error/20 flex items-center justify-center mb-3 animate-pulse">
                      <div className="absolute inset-0 rounded-full border border-aq-error/40 animate-ping opacity-60" />
                      <Mic className="w-6 h-6 text-aq-error" />
                    </div>
                    <span className="text-xs font-bold text-aq-on-surface font-mono">{formatDuration(duration)}</span>
                    <span className="text-[10px] text-aq-error font-medium mt-1">Recording active... Speak now</span>
                    <button
                      onClick={stopRecording}
                      className="touch-target h-9 px-4 rounded-lg bg-aq-error text-white font-bold text-xs mt-3 flex items-center gap-1 hover:bg-red-700"
                    >
                      <Square className="w-3.5 h-3.5" /> Stop
                    </button>
                  </div>
                ) : audioUrl ? (
                  <div className="flex flex-col items-center w-full px-2">
                    <div className="w-12 h-12 rounded-full bg-aq-tertiary-fixed flex items-center justify-center mb-2">
                      <BadgeCheck className="w-6 h-6 text-aq-tertiary" />
                    </div>
                    <p className="text-xs font-semibold text-aq-on-surface mb-3">Audio message recorded</p>
                    <audio src={audioUrl} controls className="w-full max-w-[240px] h-9 mb-3" />
                    <button
                      onClick={clearRecording}
                      className="touch-target h-9 px-3 rounded-lg bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center gap-1 hover:bg-aq-surface"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Record Again
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-4">
                    <button
                      onClick={startRecording}
                      className="touch-target w-14 h-14 rounded-full bg-aq-tertiary-fixed/60 hover:bg-aq-tertiary-fixed text-aq-tertiary flex items-center justify-center shadow-aq-md hover:scale-105 active:scale-95 transition-all"
                    >
                      <Mic className="w-6 h-6" />
                    </button>
                    <p className="text-xs font-semibold text-aq-on-surface mt-3">Speak stock instructions</p>
                    <p className="text-[10px] text-aq-on-surface-variant mt-1 max-w-[200px]">
                      "12 kilos of seer fish landed, 450 a kilo" or "sardine price is 180 today"
                    </p>
                    {audioError && (
                      <p className="text-[10px] text-aq-error font-medium mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {audioError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={processInputs}
              disabled={isProcessing || (!imageFile && !audioBlob)}
              className="touch-target h-12 px-6 rounded-xl bg-aq-gradient-primary text-white font-semibold text-sm shadow-aq-button flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none hover:scale-[1.01] transition-transform"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Run extraction
                </>
              )}
            </button>
          </div>
        </div>

        <div className="glass-strong border border-aq-outline-variant/20 rounded-3xl p-5 shadow-aq-md">
          <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider mb-3 block">
            System logs & telemetry
          </span>
          <div className="bg-aq-surface-container-high/60 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[11px] text-aq-on-surface-variant border border-aq-outline-variant/10 space-y-1">
            {logs.length === 0 ? (
              <span className="text-aq-outline/60 italic">Waiting for capture triggers...</span>
            ) : (
              logs.map((log, idx) => <div key={idx}>{log}</div>)
            )}
          </div>
        </div>
      </div>

      {/* ─── Column 3: Review draft & hand off ─── */}
      <div className="space-y-6">
        <div className="glass-strong border border-aq-outline-variant/20 rounded-3xl p-6 shadow-aq-lg h-full flex flex-col">
          <div className="flex items-center gap-2 mb-4 border-b border-aq-outline-variant/10 pb-3">
            <div className="w-8 h-8 rounded-xl bg-aq-tertiary/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-aq-tertiary" />
            </div>
            <div>
              <h3 className="text-base font-bold text-aq-on-surface">Review draft</h3>
              <p className="text-[10px] text-aq-on-surface-variant">
                Nothing here is saved until you press Save on the stock sheet
              </p>
            </div>
          </div>

          {!hasProcessed ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
              <Database className="w-10 h-10 text-aq-outline/30 mb-3" />
              <p className="text-xs font-semibold text-aq-on-surface">No data loaded</p>
              <p className="text-[10px] text-aq-on-surface-variant mt-1 max-w-[200px]">
                Submit image and/or voice data to see extracted rows here.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="w-10 h-10 text-aq-outline/30 mb-3" />
              <p className="text-xs font-semibold text-aq-on-surface">No rows left</p>
              <p className="text-[10px] text-aq-on-surface-variant mt-1 max-w-[200px]">
                Every row was dropped, or nothing was confidently matched. Run extraction again.
              </p>
            </div>
          ) : (
            <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
              {rows.map((row) => {
                const tone = confidenceTone(row.confidence);
                const unmatched = !row.productId && !row.slug;
                return (
                  <div
                    key={row._key}
                    className={cn(
                      'rounded-2xl border p-3 space-y-2.5',
                      unmatched
                        ? 'border-aq-error/40 bg-aq-error-container/20'
                        : 'border-aq-outline-variant/20 bg-aq-surface-container-low'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-aq-on-surface truncate">{row.name || 'Unnamed'}</p>
                        <p className="text-[10px] text-aq-on-surface-variant truncate">{row.note}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', tone.className)}>
                          {tone.label} {Math.round(row.confidence * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => dropRow(row._key)}
                          className="touch-target p-1.5 rounded-lg text-aq-error hover:bg-aq-error-container/40"
                          aria-label={`Drop ${row.name || 'row'}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {unmatched && (
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-aq-error">
                        <AlertCircle className="w-3 h-3" /> No product matched — fix the slug or drop this row.
                      </div>
                    )}

                    <div>
                      <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-wider block mb-1">
                        Product slug
                      </label>
                      <input
                        type="text"
                        value={row.slug}
                        onChange={(e) => updateRow(row._key, { slug: e.target.value, productId: '' })}
                        placeholder="e.g. seer-fish"
                        className="touch-target w-full h-9 px-2.5 rounded-lg border border-aq-outline-variant/30 bg-aq-surface-container-lowest text-xs font-mono focus:border-aq-primary outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-tight block mb-1">
                          Landed (kg)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          inputMode="decimal"
                          value={row.declaredKg || ''}
                          onChange={(e) => updateRow(row._key, { declaredKg: parseFloat(e.target.value) || 0 })}
                          className="touch-target w-full h-9 px-2 rounded-lg border border-aq-outline-variant/30 bg-aq-surface-container-lowest text-xs font-medium focus:border-aq-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-tight block mb-1">
                          Price (₹/kg)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          inputMode="decimal"
                          value={row.pricePerKg || ''}
                          onChange={(e) => updateRow(row._key, { pricePerKg: parseFloat(e.target.value) || 0 })}
                          className="touch-target w-full h-9 px-2 rounded-lg border border-aq-outline-variant/30 bg-aq-surface-container-lowest text-xs font-medium focus:border-aq-primary outline-none"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(transcription || aiSummary) && hasProcessed && (
            <div className="mt-3 space-y-2">
              {transcription && (
                <div className="rounded-xl bg-aq-surface-container/60 p-2.5 border border-aq-outline-variant/10 text-[11px]">
                  <span className="font-bold text-aq-on-surface-variant block mb-0.5">Heard:</span>
                  <p className="text-aq-on-surface italic">&quot;{transcription}&quot;</p>
                </div>
              )}
              {aiSummary && (
                <div className="rounded-xl bg-aq-surface-container/60 p-2.5 border border-aq-outline-variant/10 text-[11px]">
                  <span className="font-bold text-aq-on-surface-variant block mb-0.5">Summary:</span>
                  <p className="text-aq-on-surface-variant leading-relaxed">{aiSummary}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 border-t border-aq-outline-variant/10 pt-4">
            <button
              onClick={sendToStockSheet}
              disabled={isSyncing || !hasProcessed || rows.length === 0}
              className="touch-target w-full h-12 rounded-xl bg-aq-gradient-teal text-white font-bold text-sm shadow-aq-button flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none hover:scale-[1.01] transition-transform"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Preparing draft...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Send {rows.length || ''} row(s) to stock sheet{' '}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
