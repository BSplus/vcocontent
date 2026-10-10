import { useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";
import LegalLinks from "@/components/legal-links";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} | VCO Media Database`; }, [title]);
  return <div className="min-h-screen bg-background">
    <MainNavigation />
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <Link href="/" className="inline-flex min-h-11 items-center text-primary underline">Back to Home</Link>
      <p className="vco-kicker mt-7">VCO Media Database / Legal information</p>
      <h1 className="my-6 text-4xl sm:text-6xl">{title}</h1>
      <LegalLinks />
      <article lang="en" className="mt-8 space-y-8 break-words text-base leading-relaxed [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:leading-tight [&_p]:mb-3 [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </article>
    </main>
    <Footer />
  </div>;
}
