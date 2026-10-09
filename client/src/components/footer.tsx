import { Link } from "wouter";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-secondary/50">
      <div className="mx-auto max-w-[1492px] px-4 py-9 sm:px-6 lg:px-9">
        <div className="grid gap-7 sm:grid-cols-[auto_1fr] sm:items-center">
          <img
            src="/attached_assets/VCO_2021_reg_White_Trans.png"
            alt="VCO Logo"
            className="h-12 w-auto object-contain transition-opacity hover:opacity-90"
          />
          <div className="space-y-4 text-sm text-muted-foreground">
            <p className="max-w-4xl leading-relaxed">
              All content and pictures on this site are copyrighted material and owned by their respective creators or owners. 
              Publication, copying, broadcasting, or retransmission of the content or pictures in whole or partially without 
              the written permission of the copyright holder is prohibited.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p>© Copyright 2020-{new Date().getFullYear()}, Virtual Competition Organisation (VCO) GmbH.</p>
              <Link href="/imprint" className="min-h-10 inline-flex items-center text-xs font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:text-primary">
                Imprint
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}