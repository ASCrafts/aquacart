'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Save, Sparkles, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  HIGHLIGHT_MAX_LENGTH,
  HIGHLIGHTS_MAX,
  MICRO_KEYS,
  NOTE_MAX_LENGTH,
  NUTRIENT_ORDER,
  NUTRIENTS,
  NutritionSchema,
  type NutrientKey,
  type Nutrition,
} from '@/lib/nutrition';

/**
 * The admin form over `NutritionSchema` — the "Nutrition" tab body inside
 * `/admin/products/[id]`'s "Edit details" page (see that page.tsx: it already
 * imports this component with `productId={product.id}` inside an
 * `.aq-card-static` wrapper, so this file owns only the form, not the card
 * chrome around it).
 *
 * Every figure is optional and per 100 g raw. Validation runs through the
 * exact same `NutritionSchema` the API enforces — not a hand-copied set of
 * rules that could drift from it — so a save that would be rejected server
 * side is already flagged red before the request goes out, under the same
 * field, with the same words.
 */
export interface NutritionEditorProps {
  productId: string;
}

type FieldValues = Record<NutrientKey, string>;
type HighlightSlots = [string, string, string];

const EMPTY_FIELDS: FieldValues = NUTRIENT_ORDER.reduce((acc, key) => {
  acc[key] = '';
  return acc;
}, {} as FieldValues);

function toFieldValues(nutrition: Nutrition | null): FieldValues {
  const next = { ...EMPTY_FIELDS };
  if (!nutrition) return next;
  for (const key of NUTRIENT_ORDER) {
    const value = nutrition[key];
    if (value !== undefined) next[key] = String(value);
  }
  return next;
}

function toHighlightSlots(nutrition: Nutrition | null): HighlightSlots {
  const highlights = nutrition?.highlights ?? [];
  return [highlights[0] ?? '', highlights[1] ?? '', highlights[2] ?? ''];
}

interface ProductOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Turns whatever `/api/products` hands back into `{ id, name, slug }`.
 *
 * That endpoint predates this rewrite and is being brought onto Prisma
 * elsewhere; until it lands this reads defensively (`id` or the old `_id`) so
 * the picker works the day it is fixed, with no coordination needed here, and
 * degrades to an empty list rather than throwing if the shape is anything
 * else.
 */
function normalizeProductList(data: unknown): ProductOption[] {
  if (!Array.isArray(data)) return [];
  const out: ProductOption[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = record.id ?? record._id;
    const { name, slug } = record;
    if (typeof id === 'string' && typeof name === 'string' && typeof slug === 'string') {
      out.push({ id, name, slug });
    }
  }
  return out;
}

const inputClass =
  'h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low pr-14 text-right tabular-nums focus-visible:border-aq-primary focus-visible:ring-1 focus-visible:ring-aq-primary/20';

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="mt-1 text-[11px] font-medium text-aq-error">{messages[0]}</p>;
}

function NumberField({
  nutrientKey,
  value,
  error,
  onChange,
}: {
  nutrientKey: NutrientKey;
  value: string;
  error?: string[];
  onChange: (next: string) => void;
}) {
  const meta = NUTRIENTS[nutrientKey];
  return (
    <div>
      <Label htmlFor={`nutrition-${nutrientKey}`} className="text-xs font-semibold text-aq-on-surface-variant">
        {meta.label}
      </Label>
      <div className="relative mt-1">
        <Input
          id={`nutrition-${nutrientKey}`}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={meta.max}
          placeholder="—"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error && error.length > 0 ? true : undefined}
          className={cn(inputClass, error && error.length > 0 && 'border-aq-error/60')}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-aq-outline">
          {meta.unit}
        </span>
      </div>
      <FieldError messages={error} />
    </div>
  );
}

export default function NutritionEditor({ productId }: NutritionEditorProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wasInvalid, setWasInvalid] = useState(false);

  const [fields, setFields] = useState<FieldValues>(EMPTY_FIELDS);
  const [highlightSlots, setHighlightSlots] = useState<HighlightSlots>(['', '', '']);
  const [note, setNote] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [copySourceId, setCopySourceId] = useState<string>('');
  const [copying, setCopying] = useState(false);

  const applyNutrition = useCallback((nutrition: Nutrition | null) => {
    setFields(toFieldValues(nutrition));
    setHighlightSlots(toHighlightSlots(nutrition));
    setNote(nutrition?.note ?? '');
    setFieldErrors({});
    setFormErrors([]);
  }, []);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/products/${productId}/nutrition`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load nutrition.');
      applyNutrition((data.nutrition as Nutrition | null) ?? null);
      setWasInvalid(Boolean(data.invalid));
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not load nutrition',
        description: error instanceof Error ? error.message : 'Please reload the page.',
      });
    } finally {
      setLoading(false);
    }
  }, [productId, applyNutrition, toast]);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  useEffect(() => {
    // The picker's own list, loaded once and independently of the
    // load/save cycle above — a failure here should never block editing this
    // fish's own figures.
    let cancelled = false;
    fetch('/api/products', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (!cancelled) {
          setProducts(normalizeProductList(data).filter((p) => p.id !== productId));
        }
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const handleCopyFrom = useCallback(async () => {
    if (!copySourceId) return;
    setCopying(true);
    try {
      const response = await fetch(`/api/admin/products/${copySourceId}/nutrition`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load that fish.');
      applyNutrition((data.nutrition as Nutrition | null) ?? null);
      toast({
        title: 'Figures copied in',
        description: `Loaded from ${
          typeof data.name === 'string' ? data.name : 'the selected fish'
        }. Nothing is saved until you press Save below.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not copy figures',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setCopying(false);
    }
  }, [copySourceId, applyNutrition, toast]);

  const handleClear = useCallback(() => {
    applyNutrition(null);
  }, [applyNutrition]);

  const handleSave = useCallback(async () => {
    setFieldErrors({});
    setFormErrors([]);

    // Build the candidate blob straight from the controlled inputs: blank
    // fields are simply absent, matching the schema's "absent, not null"
    // convention for a figure nobody has entered.
    const candidate: Record<string, unknown> = {};
    for (const key of NUTRIENT_ORDER) {
      const raw = fields[key].trim();
      if (raw !== '') candidate[key] = Number(raw);
    }
    const highlights = highlightSlots.map((h) => h.trim()).filter((h) => h.length > 0);
    if (highlights.length > 0) candidate.highlights = highlights;
    const trimmedNote = note.trim();
    if (trimmedNote !== '') candidate.note = trimmedNote;

    const parsed = NutritionSchema.safeParse(candidate);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      setFieldErrors(flat.fieldErrors);
      setFormErrors(flat.formErrors);
      toast({
        variant: 'destructive',
        title: 'Those figures did not check out',
        description: flat.formErrors[0] ?? 'Fix the highlighted fields and try again.',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/products/${productId}/nutrition`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutrition: parsed.data }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(data.fieldErrors ?? {});
        setFormErrors(data.formErrors ?? []);
        throw new Error(data.message || 'The save did not go through.');
      }
      setWasInvalid(false);
      toast({
        title: 'Nutrition saved',
        description: 'The product page picks this up on next load.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }, [fields, highlightSlots, note, productId, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-aq-on-surface-variant">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading nutrition…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {wasInvalid ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            The figures stored for this fish no longer pass validation — probably written by an
            older shape of this form. The panel on the product page is already showing nothing
            rather than a broken figure. Fill in what you can below and save to replace it.
          </p>
        </div>
      ) : null}

      {formErrors.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-aq-error/30 bg-aq-error-container/40 p-3 text-xs font-medium text-aq-error">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <ul className="space-y-0.5">
            {formErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ─── Copy from another fish ─── */}
      <div className="rounded-xl border border-aq-outline-variant/25 bg-aq-surface-container-low p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-aq-primary" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-wide text-aq-on-surface-variant">
            Copy from another fish
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={copySourceId} onValueChange={setCopySourceId}>
            <SelectTrigger className="h-11 flex-1 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-lowest">
              <SelectValue placeholder={products.length ? 'Choose a fish…' : 'No other fish yet'} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={!copySourceId || copying}
            onClick={() => void handleCopyFrom()}
            className="h-11 rounded-xl border-aq-outline-variant/30"
          >
            {copying ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            Load figures
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-aq-on-surface-variant">
          Fills the form below from the selected fish so you can adjust it — nothing is written
          until you press Save.
        </p>
      </div>

      {/* ─── Macros — the four tiles the customer panel leads with ─── */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-aq-on-surface-variant">
          Macros, per 100 g raw
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField
            nutrientKey="omega3Mg"
            value={fields.omega3Mg}
            error={fieldErrors.omega3Mg}
            onChange={(v) => setFields((f) => ({ ...f, omega3Mg: v }))}
          />
          <NumberField
            nutrientKey="protein"
            value={fields.protein}
            error={fieldErrors.protein}
            onChange={(v) => setFields((f) => ({ ...f, protein: v }))}
          />
          <NumberField
            nutrientKey="energyKcal"
            value={fields.energyKcal}
            error={fieldErrors.energyKcal}
            onChange={(v) => setFields((f) => ({ ...f, energyKcal: v }))}
          />
          <NumberField
            nutrientKey="fat"
            value={fields.fat}
            error={fieldErrors.fat}
            onChange={(v) => setFields((f) => ({ ...f, fat: v }))}
          />
        </div>
      </div>

      {/* ─── Micros ─── */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-aq-on-surface-variant">
          Everything else in the panel&apos;s <code>&lt;details&gt;</code>
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {MICRO_KEYS.map((key) => (
            <NumberField
              key={key}
              nutrientKey={key}
              value={fields[key]}
              error={fieldErrors[key]}
              onChange={(v) => setFields((f) => ({ ...f, [key]: v }))}
            />
          ))}
        </div>
      </div>

      {/* ─── Highlights ─── */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-aq-on-surface-variant">
          Highlights — up to {HIGHLIGHTS_MAX}, shown as chips
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {highlightSlots.map((value, index) => (
            <Input
              key={index}
              value={value}
              maxLength={HIGHLIGHT_MAX_LENGTH}
              placeholder={`Highlight ${index + 1}`}
              onChange={(e) =>
                setHighlightSlots((slots) => {
                  const next = [...slots] as HighlightSlots;
                  next[index] = e.target.value;
                  return next;
                })
              }
              className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus-visible:border-aq-primary focus-visible:ring-1 focus-visible:ring-aq-primary/20"
            />
          ))}
        </div>
        <FieldError messages={fieldErrors.highlights} />
      </div>

      {/* ─── Note ─── */}
      <div className="space-y-2">
        <Label htmlFor="nutrition-note" className="text-xs font-bold uppercase tracking-wide text-aq-on-surface-variant">
          Note
        </Label>
        <Textarea
          id="nutrition-note"
          value={note}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One or two sentences of context — e.g. how much a figure swings with season."
          className="min-h-[72px] rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low resize-none focus-visible:border-aq-primary focus-visible:ring-1 focus-visible:ring-aq-primary/20"
        />
        <div className="flex items-center justify-between">
          <FieldError messages={fieldErrors.note} />
          <p className="ml-auto text-[11px] text-aq-outline">
            {note.length}/{NOTE_MAX_LENGTH}
          </p>
        </div>
      </div>

      {/* ─── Actions ─── */}
      <div className="flex flex-col-reverse gap-2 border-t border-aq-outline-variant/20 pt-4 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClear}
          disabled={saving}
          className="h-11 rounded-xl text-aq-on-surface-variant"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Clear all figures
        </Button>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="h-11 rounded-xl bg-aq-gradient-primary font-semibold text-white shadow-aq-button"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Save nutrition
        </Button>
      </div>
    </div>
  );
}
