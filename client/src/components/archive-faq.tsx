import { ARCHIVE_FAQ } from "@shared/public-content";

export default function ArchiveFaq() {
  return (
    <section aria-labelledby="archive-faq-heading" className="border-t border-foreground/10 pt-9">
      <div className="mb-5">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-primary">Good to know</p>
        <h2 id="archive-faq-heading" className="text-2xl font-bold tracking-wide sm:text-3xl">Archive FAQ</h2>
      </div>
      <dl className="divide-y divide-foreground/10 border-y border-foreground/10">
        {ARCHIVE_FAQ.map(({ question, answer }) => (
          <div key={question} className="grid gap-1 py-4 sm:grid-cols-[minmax(12rem,0.7fr)_1.3fr] sm:gap-6">
            <dt className="font-semibold">{question}</dt>
            <dd className="text-sm leading-relaxed text-foreground/75">{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
