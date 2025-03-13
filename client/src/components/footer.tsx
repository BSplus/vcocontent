import { Link } from "wouter";

export default function Footer() {
  return (
    <footer className="border-t border-primary/20 bg-black/50 mt-16">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-8">
          <img
            src="/attached_assets/VCO_2021_reg_SUB_White.png"
            alt="VCO Logo"
            className="h-12 w-auto object-contain hover:opacity-90 transition-opacity"
          />
          <div className="text-sm text-foreground/60 space-y-4">
            <p className="max-w-4xl">
              All content and pictures on this site are copyrighted material and owned by their respective creators or owners. 
              Publication, copying, broadcasting, or retransmission of the content or pictures in whole or partially without 
              the written permission of the copyright holder is prohibited.
            </p>
            <div className="flex items-center justify-between">
              <p>© Copyright 2020-2025, Virtual Competition Organisation (VCO) GmbH.</p>
              <Link href="/imprint" className="hover:text-primary transition-colors">
                Imprint
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
import { Link } from "wouter";

export default function Footer() {
  return (
    <footer className="border-t py-6 md:py-8">
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
        <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
          © {new Date().getFullYear()} Virtual Competition Organisation. All rights reserved.
        </p>
        <nav className="flex gap-4 text-sm">
          <Link href="/about" className="text-muted-foreground hover:text-foreground">
            About
          </Link>
          <Link href="/terms" className="text-muted-foreground hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
            Privacy
          </Link>
          <Link href="/contact" className="text-muted-foreground hover:text-foreground">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
