import { Link } from "wouter";

export default function Footer() {
  return (
    <footer className="border-t border-primary/20 bg-black/50 mt-16">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-8">
          <img
            src="/attached_assets/VCO_2021_reg_White_Trans.png"
            alt="VCO Logo"
            className="h-[200px] w-auto object-contain hover:opacity-90 transition-opacity"
          />
          <div className="text-sm text-foreground/60 space-y-4">
            <p className="max-w-4xl">
              All content and pictures on this site are copyrighted material and owned by their respective creators or owners. 
              Publication, copying, broadcasting, or retransmission of the content or pictures in whole or partially without 
              the written permission of the copyright holder is prohibited.
            </p>
            <div className="flex items-center justify-between">
              <p>© Copyright 2020-{new Date().getFullYear()}, Virtual Competition Organisation (VCO) GmbH.</p>
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