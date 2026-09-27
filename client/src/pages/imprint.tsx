import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import MainNavigation from "@/components/main-navigation";

export default function ImprintPage() {
  return (
    <div className="min-h-screen bg-background">
      <MainNavigation />
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <div className="prose prose-invert max-w-4xl">
          <h1>IMPRINT</h1>

          <h2>INFORMATION PURSUANT TO § 5 TMG</h2>
          <p>
            Virtual Competition Organisation GmbH<br />
            Lindwurmstrasse 88<br />
            80337 Munich
          </p>

          <h3>MANAGING DIRECTORS</h3>
          <p>
            Florian Haasper<br />
            Andreas Pavelic
          </p>

          <h3>Contact</h3>
          <p>
            Phone: +49 (0) 89 / 45 23 509 – 11<br />
            Email: info@vco-esports.com<br />
            Tax number: 143/190/4186
          </p>

          <h3>REGISTER ENTRY</h3>
          <p>
            Handelsregister: HRB 255920<br />
            Register court: Amtsgericht München
          </p>

          <h2>DISCLAIMER</h2>

          <h3>LIABILITY FOR CONTENTS</h3>
          <p>
            As service providers, we are liable for own contents of these websites according to Sec. 7, paragraph 1 German Telemedia Act (TMG). However, according to Sec. 8 to 10 German Telemedia Act (TMG), service providers are not obligated to permanently monitor submitted or stored information or to search for evidences that indicate illegal activities.
          </p>
          <p>
            Legal obligations to removing information or to blocking the use of information remain unchallenged. In this case, liability is only possible at the time of knowledge about a specific violation of law. Illegal contents will be removed immediately at the time we get knowledge of them.
          </p>

          <h3>LIABILITY FOR LINKS</h3>
          <p>
            Our offer includes links to external third party websites. We have no influence on the contents of those websites, therefore we cannot guarantee for those contents. Providers or administrators of linked websites are always responsible for their own contents.
          </p>
          <p>
            The linked websites had been checked for possible violations of law at the time of the establishment of the link. Illegal contents were not detected at the time of the linking. A permanent monitoring of the contents of linked websites cannot be imposed without reasonable indications that there has been a violation of law. Illegal links will be removed immediately at the time we get knowledge of them.
          </p>

          <h3>COPYRIGHT</h3>
          <p>
            Contents and compilations published on these websites by the providers are subject to German copyright laws. Reproduction, editing, distribution as well as the use of any kind outside the scope of the copyright law require a written permission of the author or originator. Downloads and copies of these websites are permitted for private use only.
          </p>
          <p>
            The commercial use of our contents without permission of the originator is prohibited. Copyright laws of third parties are respected as long as the contents on these websites do not originate from the provider. Contributions of third parties on this site are indicated as such. However, if you notice any violations of copyright law, please inform us. Such contents will be removed immediately.
          </p>
        </div>
      </div>
    </div>
  );
}