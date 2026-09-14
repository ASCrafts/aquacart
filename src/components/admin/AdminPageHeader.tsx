export default function AdminPageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-aq-on-surface md:text-2xl">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-xs leading-snug text-aq-on-surface-variant md:text-sm">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
