type Props = {
  title: string;
  description?: string;
};

export function SectionHeader({ title, description }: Props) {
  return (
    <div className="flex flex-col gap-1 border-b border-[color:var(--clack-border-subtle)] pb-4">
      <span className="clack-section-label">Clack Control Surface</span>
      <h1 className="text-[20px] font-semibold tracking-tight text-[var(--clack-text-1)]">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-[12px] leading-relaxed text-[var(--clack-text-3)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
