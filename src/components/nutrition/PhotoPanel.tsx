import { useState, useRef } from 'react';
import { Camera, Check, Loader2, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import FoodDetailSheet from './FoodDetailSheet';

export interface ImageFoodResult {
  identified: { food_name: string; serving_size: string; description: string };
  found: boolean;
  confidence?: string;
  entry_data?: {
    food_id: string;
    food_name: string;
    serving_id: string;
    serving_description: string | null;
    number_of_units: number;
    calories: number;
    protein: number;
    carbohydrate: number;
    fat: number;
    fiber: number;
    sugar: number;
    sodium: number;
  };
  selected?: boolean;
  adjusted?: boolean;
}

export default function PhotoPanel({
  mealType,
  dateStr,
  onLogged,
}: {
  mealType: string;
  dateStr: string;
  onLogged: () => void;
}) {
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageResults, setImageResults] = useState<ImageFoodResult[]>([]);
  const [imageLogging, setImageLogging] = useState(false);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Adjust/detail for a specific result
  const [adjustingIdx, setAdjustingIdx] = useState<number | null>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageProcessing(true);
    setImageResults([]);
    setImageError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const imageType = file.type.includes('png') ? 'png' : 'jpeg';

      const { data, error } = await supabase.functions.invoke('nutrition-image-complete', {
        body: { imageBase64: base64, imageType },
      });

      if (error) {
        setImageError(`Image analysis failed: ${error.message || 'Unknown error'}`);
      } else if (!data?.success) {
        setImageError(data?.error || 'Image analysis returned no results');
      } else if (data.data.foods?.length > 0) {
        setImageResults(
          data.data.foods.map((f: any) => ({
            ...f,
            selected: f.found,
            confidence: f.confidence || (f.found ? 'high' : 'low'),
          }))
        );
      } else {
        setImageError('No foods identified in the image. Try a clearer photo.');
      }
    } catch (e: any) {
      setImageError(`Image analysis failed: ${e.message || 'Network error'}`);
    }
    setImageProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleResult = (idx: number) => {
    setImageResults(prev =>
      prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r)
    );
  };

  // When user adjusts portions via the detail sheet
  const handleAdjusted = (idx: number, updatedEntry: any) => {
    setImageResults(prev =>
      prev.map((r, i) => i === idx ? {
        ...r,
        entry_data: updatedEntry,
        found: true,
        selected: true,
        adjusted: true,
      } : r)
    );
    setAdjustingIdx(null);
  };

  const logResults = async () => {
    const selected = imageResults.filter(r => r.found && r.selected && r.entry_data);
    if (selected.length === 0) return;

    setImageLogging(true);
    setImageError('');
    try {
      const results = await Promise.all(
        selected.map(r =>
          supabase.functions.invoke('food-log', {
            body: {
              ...r.entry_data,
              meal_type: mealType,
              logged_at: new Date(dateStr + 'T12:00:00.000Z').toISOString(),
            },
          })
        )
      );
      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        setImageError(`Failed to log ${failed.length} item(s)`);
      } else {
        onLogged();
      }
    } catch (e: any) {
      setImageError(`Failed to log foods: ${e.message || 'Network error'}`);
    }
    setImageLogging(false);
  };

  const selectedCount = imageResults.filter(r => r.found && r.selected).length;
  const totalCal = imageResults
    .filter(r => r.found && r.selected && r.entry_data)
    .reduce((sum, r) => sum + (r.entry_data?.calories || 0), 0);

  // Show food detail for adjusting portions
  if (adjustingIdx !== null) {
    const result = imageResults[adjustingIdx];
    if (result?.found && result.entry_data) {
      return (
        <FoodDetailSheet
          foodId={result.entry_data.food_id}
          foodName={result.entry_data.food_name}
          prefillServingId={result.entry_data.serving_id}
          prefillAmount={result.entry_data.number_of_units}
          mealType={mealType}
          dateStr={dateStr}
          onClose={() => setAdjustingIdx(null)}
          onLogged={onLogged}
          onAddToMeal={(item) => handleAdjusted(adjustingIdx, item)}
        />
      );
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleImageSelect}
        style={{ display: 'none' }}
      />

      {!imageProcessing && imageResults.length === 0 && (
        <button
          className="engine-btn engine-btn-secondary"
          style={{ width: '100%', padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera size={32} />
          <span>Take or upload a food photo</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI will identify foods and estimate nutrition</span>
        </button>
      )}

      {imageError && <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{imageError}</p>}

      {imageProcessing && (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 8, fontSize: 14 }}>Analyzing your food photo...</p>
        </div>
      )}

      {imageResults.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Identified Foods — tap to select, pencil to adjust
          </div>
          {imageResults.map((result, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                background: result.selected ? 'rgba(255,58,58,0.08)' : 'var(--surface2)',
                border: result.selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                opacity: result.found ? 1 : 0.5,
              }}
            >
              {/* Checkbox */}
              <button
                onClick={() => result.found && toggleResult(idx)}
                style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 1,
                  border: result.selected ? '2px solid var(--accent)' : '2px solid var(--border)',
                  background: result.selected ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: result.found ? 'pointer' : 'default',
                }}
              >
                {result.selected && <Check size={14} color="white" />}
              </button>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>
                    {result.found ? result.entry_data!.food_name : result.identified.food_name}
                  </span>
                  {result.confidence && result.found && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: result.confidence === 'high' ? 'rgba(34,197,94,0.15)' : result.confidence === 'medium' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                      color: result.confidence === 'high' ? '#4ade80' : result.confidence === 'medium' ? '#facc15' : '#f87171',
                    }}>
                      {result.confidence}
                    </span>
                  )}
                  {result.adjusted && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase' }}>
                      Adjusted
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  {result.found ? (
                    <>
                      {result.entry_data!.number_of_units} {result.entry_data!.serving_description || 'serving'}
                      {' — '}
                      {Math.round(result.entry_data!.calories)} cal | {Math.round(result.entry_data!.protein)}g P | {Math.round(result.entry_data!.carbohydrate)}g C | {Math.round(result.entry_data!.fat)}g F
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Not found in database</span>
                  )}
                </div>
              </div>

              {/* Adjust button */}
              {result.found && (
                <button
                  onClick={() => setAdjustingIdx(idx)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                  title="Adjust portion"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          ))}

          {/* Running total */}
          {selectedCount > 0 && (
            <div className="nutrition-running-total" style={{ marginTop: 4 }}>
              <span>Total: <span className="nutrition-running-total-value">{Math.round(totalCal)}</span> cal</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className="engine-btn engine-btn-secondary"
              style={{ flex: 1 }}
              onClick={() => { setImageResults([]); fileInputRef.current?.click(); }}
            >
              Retake
            </button>
            <button
              className="engine-btn engine-btn-primary"
              style={{ flex: 1 }}
              onClick={logResults}
              disabled={selectedCount === 0 || imageLogging}
            >
              {imageLogging ? 'Logging...' : `Log ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
