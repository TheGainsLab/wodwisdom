import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

export default function BarcodeScannerView({
  onScanned,
  onClose,
}: {
  onScanned: (code: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (!mounted || !scannerRef.current) return;

        const scannerId = 'barcode-scanner-' + Date.now();
        scannerRef.current.id = scannerId;

        const scanner = new Html5Qrcode(scannerId);
        html5QrRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 280, height: 120 },
            aspectRatio: 1.0,
          },
          (decodedText: string) => {
            // Stop scanning after first result
            scanner.stop().catch(() => {});
            html5QrRef.current = null;
            onScanned(decodedText);
          },
          () => {
            // Ignore scan failures (normal during scanning)
          }
        );

        if (mounted) setStarting(false);
      } catch (e: any) {
        if (mounted) {
          setStarting(false);
          if (e?.message?.includes('Permission') || e?.name === 'NotAllowedError') {
            setError('Camera permission denied. Please allow camera access and try again.');
          } else {
            setError('Could not start camera. Try entering the barcode manually.');
          }
        }
      }
    })();

    return () => {
      mounted = false;
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
      }
    };
  }, []);

  return (
    <div className="nutrition-overlay">
      <div className="nutrition-overlay-header">
        <button className="menu-btn" onClick={onClose}><X size={20} /></button>
        <h2>Scan Barcode</h2>
      </div>

      <div className="nutrition-overlay-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {starting && !error && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>Starting camera...</p>
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--accent)', fontSize: 14, marginBottom: 16 }}>{error}</p>
            <button className="engine-btn engine-btn-secondary" onClick={onClose}>
              Enter Manually
            </button>
          </div>
        )}

        <div className="nutrition-scanner-wrap" style={{ display: error ? 'none' : 'block' }}>
          <div ref={scannerRef} />
        </div>

        {!starting && !error && (
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            Point camera at barcode
          </p>
        )}
      </div>
    </div>
  );
}
