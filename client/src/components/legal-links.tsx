import { Link } from "wouter";

export default function LegalLinks() {
  return <nav aria-label="Legal information" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <Link href="/imprint" className="inline-flex min-h-11 items-center text-primary underline">Imprint</Link>
    <Link href="/privacy-policy" className="inline-flex min-h-11 items-center text-primary underline">Privacy Policy</Link>
    <Link href="/support" className="inline-flex min-h-11 items-center text-primary underline">Contact VCO</Link>
  </nav>;
}
