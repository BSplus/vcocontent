import LegalPage from "@/components/legal-page";
import MediaRightsNotice from "@/components/media-rights-notice";

export default function ImprintPage() {
  return <LegalPage title="Imprint">
    <section><h2>Information pursuant to § 5 DDG</h2>
      <p>Virtual Competition Organisation GmbH<br />Lindwurmstraße 88<br />80337 München<br />Germany</p>
      <p>Phone: <a href="tel:+4989452350911">+49 (0) 89 / 45 23 509 – 11</a><br />
        Email: <a href="mailto:info@vco-esports.com">info@vco-esports.com</a></p>
    </section>
    <section><h2>Managing directors</h2><p>Florian Haasper<br />Andreas Pavelic</p></section>
    <section><h2>Commercial register</h2><p>Register court: Amtsgericht München<br />Register number: HRB 255920</p></section>
    <section><h2>VAT identification number</h2><p>VAT identification number pursuant to § 27a UStG: DE331164657</p></section>
    <section><h2>Editorial responsibility</h2>
      <p>Responsible for editorial content pursuant to § 18 (2) MStV:</p>
      <p>Florian Haasper<br />c/o Virtual Competition Organisation GmbH<br />Lindwurmstraße 88<br />80337 München<br />Germany</p>
    </section>
    <section><h2>Consumer dispute resolution</h2>
      <p>Virtual Competition Organisation GmbH is neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board.</p>
    </section>
    <section><h2>Content &amp; external links</h2>
      <p>We are responsible for our own content in accordance with applicable law. We prepare the information in this media gallery with care, but cannot guarantee that all information is complete or up to date. Statutory liability remains unaffected.</p>
      <p>Linked websites are operated by third parties who are responsible for their own content. If you become aware of unlawful gallery content or a linked page, please notify us using the contact details above, including the relevant URL and your reasons. We will assess the report and remove unlawful content or links where required.</p>
    </section>
    <section><h2>Copyright &amp; media downloads</h2>
      <p>Texts, photographs, videos, graphics and other content in the VCO Media Database may be protected by copyright and related rights.</p>
      <MediaRightsNotice />
      <p>No additional private, editorial or commercial usage licence is granted by registration, creator activation or a download button.</p>
    </section>
  </LegalPage>;
}
