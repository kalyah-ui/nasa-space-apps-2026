export function SectionPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section aria-label={title} className="placeholder">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}