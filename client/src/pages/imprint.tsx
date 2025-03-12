import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ImprintPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <div className="prose prose-invert max-w-4xl">
          <h1>Legal Notice</h1>
          
          <h2>Information pursuant to § 5 TMG</h2>
          <p>
            Virtual Competition Organisation GmbH<br />
            Schlüterstraße 39<br />
            10629 Berlin<br />
            Germany
          </p>

          <h3>Represented by</h3>
          <p>
            Florian Haasper<br />
            Managing Director
          </p>

          <h3>Contact</h3>
          <p>
            Phone: +49 (0)30 700 14 35-0<br />
            Email: info@vco-esports.com
          </p>

          <h3>Register Entry</h3>
          <p>
            Registration in the Commercial Register.<br />
            Register Court: District Court of Berlin-Charlottenburg<br />
            Register Number: HRB 205335 B
          </p>

          <h3>VAT ID</h3>
          <p>
            Sales tax identification number according to § 27 a of the Sales Tax Law:<br />
            DE323358044
          </p>

          <h3>Responsible for content according to § 55 Abs. 2 RStV</h3>
          <p>
            Florian Haasper<br />
            Virtual Competition Organisation GmbH<br />
            Schlüterstraße 39<br />
            10629 Berlin<br />
            Germany
          </p>
        </div>
      </div>
    </div>
  );
}
