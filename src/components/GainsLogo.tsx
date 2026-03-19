export default function GainsLogo({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontWeight: 800, letterSpacing: '0.04em' }}>
      G<span style={{ color: 'var(--accent)' }}>AI</span>NS
    </span>
  );
}
