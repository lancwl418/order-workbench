"use client";

// The one supplier-order-number display: shows the platformOid returned at
// place time and links to the supplier's console when configured.

export function SupplierOrderLink({
  platformOid,
  consoleUrl,
  className,
}: {
  platformOid: string;
  consoleUrl?: string | null;
  className?: string;
}) {
  if (consoleUrl) {
    return (
      <a
        href={consoleUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="打开供应商后台"
        className={`font-mono text-primary hover:underline ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {platformOid}
      </a>
    );
  }
  return <span className={`font-mono text-muted-foreground ${className ?? ""}`}>{platformOid}</span>;
}
