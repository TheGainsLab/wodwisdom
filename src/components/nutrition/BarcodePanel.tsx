import { useState } from 'react';
import { ScanBarcode, Loader2, Camera } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import BarcodeScannerView from './BarcodeScannerView';

export default function BarcodePanel({
  mealType,
  dateStr,
  onLogged,
}: {
  mealType: string;
  dateStr: string;
  onLogged: () => void;
}) {
  const [barcodeValue, setBarcodeValue] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<any>(null);
  const [barcodeError, setBarcodeError] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return;

    setBarcodeValue(code);
    setBarcodeLoading(true);
    setBarcodeResult(null);
    setBarcodeError('');

    try {
      const { data, error } = await supabase.functions.invoke('nutrition-barcode', {
        body: { barcode: code.trim() },
      });

      if (error || !data?.success) {
        setBarcodeError(data?.message || data?.error || 'Product not found');
      } else {
        setBarcodeResult(data.data);
      }
    } catch {
      setBarcodeError('Failed to look up barcode');
    }
    setBarcodeLoading(false);
  };

  const logResult = async () => {
    if (!barcodeResult?.entry_data) return;

    setBarcodeError('');
    try {
      const { error } = await supabase.functions.invoke('food-log', {
        body: {
          ...barcodeResult.entry_data,
          meal_type: mealType,
          logged_at: new Date(dateStr + 'T12:00:00.000Z').toISOString(),
        },
      });
      if (error) { setBarcodeError(`Failed to log: ${error.message}`); return; }
      onLogged();
    } catch (e: any) {
      setBarcodeError(`Failed to log: ${e.message || 'Network error'}`);
    }
  };

  const handleScanned = (code: string) => {
    setShowScanner(false);
    lookupBarcode(code);
  };

  if (showScanner) {
    return (
      <BarcodeScannerView
        onScanned={handleScanned}
        onClose={() => setShowScanner(false)}
      />
    );
  }

  return (
    <>
      {/* Scan with camera button */}
      <button
        className="engine-btn engine-btn-secondary"
        style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
        onClick={() => setShowScanner(true)}
      >
        <Camera size={18} />
        Scan with Camera
      </button>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
        or enter barcode manually
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={barcodeValue}
          onChange={e => setBarcodeValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookupBarcode(barcodeValue)}
          placeholder="Enter barcode number..."
          inputMode="numeric"
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            fontSize: 14,
          }}
        />
        <button className="engine-btn engine-btn-primary" onClick={() => lookupBarcode(barcodeValue)} disabled={barcodeLoading}>
          <ScanBarcode size={18} />
        </button>
      </div>

      {barcodeLoading && (
        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-dim)' }}>
          <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 6, fontSize: 13 }}>Looking up barcode...</p>
        </div>
      )}

      {barcodeError && (
        <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{barcodeError}</p>
      )}

      {barcodeResult && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={logResult}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '12px 14px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--text)',
              textAlign: 'left',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {barcodeResult.entry_data.food_name}
            </span>
            {barcodeResult.product_info?.brand && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{barcodeResult.product_info.brand}</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
              {barcodeResult.entry_data.serving_description}
              {' — '}
              {Math.round(barcodeResult.entry_data.calories)} cal | {Math.round(barcodeResult.entry_data.protein)}g P | {Math.round(barcodeResult.entry_data.carbohydrate)}g C | {Math.round(barcodeResult.entry_data.fat)}g F
            </span>
            <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontWeight: 500 }}>Tap to log</span>
          </button>
        </div>
      )}
    </>
  );
}
