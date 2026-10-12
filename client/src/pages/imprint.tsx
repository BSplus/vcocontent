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
    <section aria-labelledby="game-content-conditions"><h2 id="game-content-conditions">Simulation &amp; game content</h2>
      <p>Media created in simulations and games may include rights of publishers, developers and other third parties in addition to the photographer’s rights. Creation, upload, publication and reuse must comply with the applicable provider terms, end user licence agreements (EULAs) and any applicable media or content policies.</p>
      <p>Availability on this platform and permission from VCO do not replace any required third-party rights or permissions. Statutorily permitted uses and mandatory rights remain unaffected.</p>
      <p>The following examples are non-exhaustive. Check the documents applicable to your game version, platform, region and intended use:</p>
      <ul>
        <li><strong>iRacing:</strong>{" "}
          <a href="https://www.iracing.com/terms-use-eula/">Terms of Use and EULA</a> for the iRacing simulation service;{" "}
          <a href="https://www.iracing.com/eu-terms-use-eula/">Supplemental EU Terms</a> for EU users;{" "}
          <a href="https://www.iracing.com/broadcast-policy/">Broadcast Policy</a> for racing broadcasts and streams, not a general photo-reuse licence.
        </li>
        <li><strong>Le Mans Ultimate:</strong>{" "}
          <a href="https://store.steampowered.com/eula/2399420_eula_1">End User Access and License Agreement</a> supplied by Studio 397 for the PC game on Steam.
        </li>
        <li><strong>RaceRoom:</strong>{" "}
          <a href="https://game.raceroom.com/en/about/eula/">End-User Licence Agreement</a> for RaceRoom Racing Experience on PC/Steam.
        </li>
        <li><strong>Gran Turismo 7:</strong>{" "}
          <a href="https://www.playstation.com/en-gb/legal/software-eula/">PlayStation Software Application End User Licence Agreement</a> for software, including its sharing and user-generated-content provisions;{" "}
          <a href="https://www.playstation.com/en-gb/legal/psn-terms-of-service/">PlayStation Terms of Service</a> for PlayStation online services and content sharing. These are English-language UK pages with regional provisions; check the terms for your region.
        </li>
        <li><strong>Assetto Corsa Competizione:</strong>{" "}
          <a href="https://store.steampowered.com/eula/805550_eula_0">End-User License Agreement</a> supplied by KUNOS Simulazioni for the PC game on Steam; console/platform terms may differ.
        </li>
      </ul>
      <p>These examples and links are provided for information only. They do not incorporate third-party terms into a contract with VCO, confirm that any particular use is permitted, or imply a partnership with or endorsement by the named providers. This notice does not require visitors to accept third-party terms merely to browse this platform.</p>
    </section>
  </LegalPage>;
}
