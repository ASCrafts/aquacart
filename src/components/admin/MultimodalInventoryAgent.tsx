'use client';

import { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, Mic, MicOff, RefreshCw, CheckCircle, Database, Play, Square, X, AlertCircle, Edit2, Sparkles, FileText, BadgeCheck } from 'lucide-react';
import useAudioRecorder from '@/hooks/useAudioRecorder';
import { useToast } from '@/hooks/use-toast';
import { InventoryAnalysis, InventoryIntent } from '@/types/inventory-agent';

export default function MultimodalInventoryAgent() {
  const { toast } = useToast();
  
  // States
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasProcessed, setHasProcessed] = useState(false);

  // Editable fields for verification screen
  const [formData, setFormData] = useState<InventoryAnalysis>({
    intent: 'UNKNOWN',
    sku: '',
    name: '',
    quantity: 0,
    stockKg: 0,
    price: 0,
    aiSummary: '',
    transcription: '',
  });
  const [customDescription, setCustomDescription] = useState('');
  const [customCategory, setCustomCategory] = useState('Fish');

  // Camera references
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Audio Hook
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

  // Logs helper
  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Camera Management
  const startCamera = async () => {
    addLog('Requesting camera access...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
      addLog('Camera stream started.');
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Camera Error',
        description: err.message || 'Microphone/Camera permission denied.',
      });
      addLog(`Camera error: ${err.message || String(err)}`);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraActive(false);
    addLog('Camera stream stopped.');
  };

  const captureSnapshot = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'snapshot.jpg', { type: 'image/jpeg' });
            setImageFile(file);
            setImagePreview(URL.createObjectURL(blob));
            addLog('Snapshot captured successfully.');
            stopCamera();
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      addLog(`Loaded image file: ${file.name}`);
    }
  };

  // Submit to API endpoint
  const processInputs = async () => {
    if (!imageFile && !audioBlob) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Provide an image snapshot/upload OR a voice command.',
      });
      return;
    }

    setIsProcessing(true);
    setHasProcessed(false);
    addLog('Packaging files for Gemini Gemma-4 extraction...');

    try {
      const payload = new FormData();
      if (imageFile) {
        payload.append('image', imageFile);
      }
      if (audioBlob) {
        payload.append('audio', audioBlob, 'command.webm');
      }

      addLog('Sending request to backend processing API /api/admin/inventory-agent...');
      const res = await fetch('/api/admin/inventory-agent', {
        method: 'POST',
        body: payload,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Processing failed');
      }

      setFormData(data);
      setCustomCategory(data.category || 'Fish');
      setHasProcessed(true);
      addLog('Successfully parsed multimodal response from Gemma 4.');
      toast({
        title: '✨ Extracted Successfully',
        description: 'Review the details before syncing to the database.',
      });
    } catch (err: any) {
      addLog(`Error during extraction: ${err.message}`);
      toast({
        variant: 'destructive',
        title: 'Extraction Failed',
        description: err.message || 'Could not parse inputs.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Sync to database
  const syncToDatabase = async () => {
    setIsSyncing(true);
    addLog('Initiating database sync with MySQL (via Prisma client)...');

    try {
      const res = await fetch('/api/admin/inventory-agent/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          category: customCategory,
          description: customDescription,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Database sync failed');
      }

      addLog(`Prisma response: ${data.message}`);
      toast({
        title: '🎉 Inventory Synced!',
        description: data.message,
      });

      // Reset states
      setImageFile(null);
      setImagePreview(null);
      clearRecording();
      setHasProcessed(false);
    } catch (err: any) {
      addLog(`Sync error: ${err.message}`);
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: err.message || 'Failed to update MySQL.',
      });
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
        
        {/* Multimodal Input Panel */}
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
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover aspect-[4/3]"></video>
                    <canvas ref={canvasRef} className="hidden"></canvas>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                      <button
                        onClick={captureSnapshot}
                        className="h-10 px-4 rounded-xl bg-aq-gradient-primary text-white font-bold text-xs shadow-aq-button flex items-center gap-1 hover:scale-105 transition-transform"
                      >
                        <Camera className="w-3.5 h-3.5" /> Snap
                      </button>
                      <button
                        onClick={stopCamera}
                        className="h-10 px-4 rounded-xl bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center gap-1 hover:bg-aq-surface"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : imagePreview ? (
                  <div className="relative w-full h-full min-h-[200px] rounded-xl overflow-hidden shadow-aq-sm border border-aq-outline-variant/20">
                    <img src={imagePreview} alt="Captured" className="w-full h-full object-cover aspect-[4/3]" />
                    <button
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                        addLog('Removed image input.');
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black text-white transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-4">
                    <div className="w-12 h-12 rounded-2xl bg-aq-primary-fixed flex items-center justify-center mb-3">
                      <Camera className="w-6 h-6 text-aq-primary" />
                    </div>
                    <p className="text-xs font-semibold text-aq-on-surface">Invoice, Shelf, or Product Image</p>
                    <p className="text-[10px] text-aq-on-surface-variant mt-1 mb-4">Snap live using camera or upload a file</p>
                    <div className="flex gap-2">
                      <button
                        onClick={startCamera}
                        className="h-9 px-3 rounded-lg bg-aq-gradient-primary text-white font-bold text-xs flex items-center gap-1 hover:scale-102 transition-transform"
                      >
                        <Camera className="w-3.5 h-3.5" /> Use Camera
                      </button>
                      <label className="h-9 px-3 rounded-lg bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer hover:bg-aq-surface">
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
                    {/* Pulsing microphone effect */}
                    <div className="relative w-16 h-16 rounded-full bg-aq-error/20 flex items-center justify-center mb-3 animate-pulse">
                      <div className="absolute inset-0 rounded-full border border-aq-error/40 animate-ping opacity-60"></div>
                      <Mic className="w-6 h-6 text-aq-error" />
                    </div>
                    <span className="text-xs font-bold text-aq-on-surface font-mono">{formatDuration(duration)}</span>
                    <span className="text-[10px] text-aq-error font-medium mt-1">Recording active... Speak now</span>
                    <button
                      onClick={stopRecording}
                      className="h-9 px-4 rounded-lg bg-aq-error text-white font-bold text-xs mt-3 flex items-center gap-1 hover:bg-red-700"
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
                      className="h-9 px-3 rounded-lg bg-aq-surface-container-lowest text-aq-on-surface border border-aq-outline-variant/30 font-bold text-xs flex items-center gap-1 hover:bg-aq-surface"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Record Again
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-4">
                    <button
                      onClick={startRecording}
                      className="w-14 h-14 rounded-full bg-aq-tertiary-fixed/60 hover:bg-aq-tertiary-fixed text-aq-tertiary flex items-center justify-center shadow-aq-md hover:scale-105 active:scale-95 transition-all"
                    >
                      <Mic className="w-6 h-6" />
                    </button>
                    <p className="text-xs font-semibold text-aq-on-surface mt-3">Speak Stock Instructions</p>
                    <p className="text-[10px] text-aq-on-surface-variant mt-1 max-w-[200px]">
                      "Add 15 fillets to stock" or "Set pricing for prawns to 299"
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

          {/* Trigger button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={processInputs}
              disabled={isProcessing || (!imageFile && !audioBlob)}
              className="h-12 px-6 rounded-xl bg-aq-gradient-primary text-white font-semibold text-sm shadow-aq-button flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none hover:scale-[1.01] transition-transform"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing Multimodal Input...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Run Multimodal Extraction
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Transaction logs */}
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

      {/* ─── Column 3: Verification & Sync Screen ─── */}
      <div className="space-y-6">
        
        <div className="glass-strong border border-aq-outline-variant/20 rounded-3xl p-6 shadow-aq-lg h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4 border-b border-aq-outline-variant/10 pb-3">
              <div className="w-8 h-8 rounded-xl bg-aq-tertiary/20 flex items-center justify-center">
                <FileText className="w-4 h-4 text-aq-tertiary" />
              </div>
              <div>
                <h3 className="text-base font-bold text-aq-on-surface">Verification Screen</h3>
                <p className="text-[10px] text-aq-on-surface-variant">Verify & correct AI extractions</p>
              </div>
            </div>

            {hasProcessed ? (
              <div className="space-y-4">
                
                {/* Intent Selector */}
                <div>
                  <label className="text-[11px] font-bold text-aq-on-surface-variant uppercase tracking-wider block mb-1">
                    Detected Intent
                  </label>
                  <select
                    value={formData.intent}
                    onChange={(e) => setFormData({ ...formData, intent: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-semibold focus:border-aq-primary outline-none"
                  >
                    <option value="ADD_STOCK">➕ ADD STOCK</option>
                    <option value="REMOVE_STOCK">➖ REMOVE STOCK</option>
                    <option value="UPDATE_PRICE">🏷️ UPDATE PRICE</option>
                    <option value="UNKNOWN">❓ UNKNOWN</option>
                  </select>
                </div>

                {/* SKU / Slug */}
                <div>
                  <label className="text-[11px] font-bold text-aq-on-surface-variant uppercase tracking-wider block mb-1">
                    SKU / Slug
                  </label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-medium focus:border-aq-primary outline-none"
                    placeholder="e.g. fresh-salmon"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="text-[11px] font-bold text-aq-on-surface-variant uppercase tracking-wider block mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-medium focus:border-aq-primary outline-none"
                  />
                </div>

                {/* Quantity, Weight & Price */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-tight block mb-1">
                      Qty (Pcs)
                    </label>
                    <input
                      type="number"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })}
                      className="w-full h-10 px-2 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-medium focus:border-aq-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-tight block mb-1">
                      Weight (Kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.stockKg}
                      onChange={(e) => setFormData({ ...formData, stockKg: parseFloat(e.target.value) || 0 })}
                      className="w-full h-10 px-2 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-medium focus:border-aq-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-aq-on-surface-variant uppercase tracking-tight block mb-1">
                      Price (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                      className="w-full h-10 px-2 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs font-medium focus:border-aq-primary outline-none"
                    />
                  </div>
                </div>

                {/* Category & Description for New Products */}
                <div className="border-t border-aq-outline-variant/10 pt-3 mt-3">
                  <span className="text-[10px] font-bold text-aq-outline uppercase tracking-wider mb-2 block">
                    Default metadata (for new items)
                  </span>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-semibold text-aq-on-surface-variant block mb-1">
                        Category
                      </label>
                      <select
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs outline-none"
                      >
                        <option value="Fish">🐟 Fish</option>
                        <option value="Shellfish">🦐 Shellfish</option>
                        <option value="Fillet">🍣 Fillet</option>
                        <option value="Whole">Whole Fish</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-aq-on-surface-variant block mb-1">
                        Description
                      </label>
                      <textarea
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                        className="w-full p-3 rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low text-xs min-h-[60px] resize-none outline-none"
                        placeholder="Description for new products..."
                      />
                    </div>
                  </div>
                </div>

                {/* Audio Log */}
                {formData.transcription && (
                  <div className="rounded-xl bg-aq-surface-container/60 p-3 border border-aq-outline-variant/10 mt-3 text-xs">
                    <span className="font-bold text-aq-on-surface-variant block mb-1">Speech Transcription:</span>
                    <p className="text-aq-on-surface italic">"{formData.transcription}"</p>
                  </div>
                )}

                {/* AI Summary */}
                {formData.aiSummary && (
                  <div className="rounded-xl bg-aq-surface-container/60 p-3 border border-aq-outline-variant/10 mt-2 text-xs">
                    <span className="font-bold text-aq-on-surface-variant block mb-1">Conflict Resolution & Reason:</span>
                    <p className="text-aq-on-surface-variant text-[11px] leading-relaxed">{formData.aiSummary}</p>
                  </div>
                )}

              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Database className="w-10 h-10 text-aq-outline/30 mb-3" />
                <p className="text-xs font-semibold text-aq-on-surface">No Data Loaded</p>
                <p className="text-[10px] text-aq-on-surface-variant mt-1 max-w-[200px]">
                  Submit image and voice data to see extracted fields here.
                </p>
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-aq-outline-variant/10 pt-4">
            <button
              onClick={syncToDatabase}
              disabled={isSyncing || !hasProcessed}
              className="w-full h-12 rounded-xl bg-aq-gradient-teal text-white font-bold text-sm shadow-aq-button flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none hover:scale-[1.01] transition-transform"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Synchronizing MySQL...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" /> Confirm & Send to Database
                </>
              )}
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
