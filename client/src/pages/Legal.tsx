import { Link } from "react-router-dom";
import { Wordmark } from "../ui";
import { LangSwitch, useT } from "../i18n";

// Fill the placeholders in brackets before going public — an Impressum is mandatory under § 5 DDG (formerly TMG).
const OPERATOR = {
  name: "[Vorname Nachname]",
  street: "[Straße Hausnummer]",
  city: "[PLZ Ort]",
  email: "[kontakt@billnest.de]",
  phone: "",
  vat: "", // USt-IdNr., falls vorhanden — Kleinunternehmer nach § 19 UStG haben keine
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5"><Link to="/"><Wordmark /></Link><LangSwitch /></header>
      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="display text-4xl">{title}</h1>
        <div className="prose-sm mt-8 space-y-6 text-[15px] leading-relaxed text-ink-soft [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink">{children}</div>
        <p className="mt-12 text-sm"><Link to="/" className="font-semibold text-cobalt hover:underline">← {t("legal.back")}</Link></p>
      </main>
    </div>
  );
}

export function Impressum() {
  return (
    <Shell title="Impressum">
      <p>Angaben gemäß § 5 DDG</p>
      <p>{OPERATOR.name}<br />{OPERATOR.street}<br />{OPERATOR.city}</p>
      <p>E-Mail: {OPERATOR.email}{OPERATOR.phone && <><br />Telefon: {OPERATOR.phone}</>}</p>
      {OPERATOR.vat ? <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {OPERATOR.vat}</p> : <p>Kleinunternehmer im Sinne von § 19 UStG; es wird keine Umsatzsteuer ausgewiesen.</p>}
      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>{OPERATOR.name}, Anschrift wie oben.</p>
      <h2>Haftung für Inhalte</h2>
      <p>Billnest berechnet Betriebskostenabrechnungen nach den in der Anwendung benannten Regeln und zeigt den Rechenweg. Die Anwendung ersetzt keine Rechtsberatung. Für die Richtigkeit der eingegebenen Daten und die rechtliche Prüfung im Einzelfall ist der Nutzer verantwortlich.</p>
      <h2>Streitschlichtung</h2>
      <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </Shell>
  );
}

export function Datenschutz() {
  return (
    <Shell title="Datenschutzerklärung">
      <h2>1. Verantwortlicher</h2>
      <p>{OPERATOR.name}, {OPERATOR.street}, {OPERATOR.city}, E-Mail {OPERATOR.email}.</p>
      <h2>2. Hosting</h2>
      <p>Diese Anwendung wird auf einem Server von Oracle Cloud in Frankfurt am Main (Deutschland) betrieben. Beim Aufruf werden technisch notwendige Daten (IP-Adresse, Zeitpunkt, aufgerufene Seite, Browsertyp) in Server-Protokollen verarbeitet, Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO (sicherer Betrieb). Protokolle werden nach spätestens 14 Tagen gelöscht.</p>
      <h2>3. Cookies</h2>
      <p>Wir setzen ausschließlich ein technisch notwendiges Sitzungs-Cookie nach der Anmeldung (Vermieter bzw. Mieter). Es enthält keine personenbezogenen Daten und läuft nach 12 Stunden ab. Es gibt kein Tracking, keine Analyse-Dienste und keine Werbe-Cookies. Die Spracheinstellung wird lokal im Browser gespeichert.</p>
      <h2>4. Warteliste</h2>
      <p>Wenn Sie sich in die Warteliste eintragen, speichern wir Ihre E-Mail-Adresse und optional die Zahl Ihrer Einheiten, um Sie einmalig über den Start zu informieren (Art. 6 Abs. 1 lit. a DSGVO). Sie können die Einwilligung jederzeit per E-Mail widerrufen; die Daten werden dann gelöscht.</p>
      <h2>5. Nutzung als Vermieter</h2>
      <p>Als Vermieter geben Sie Daten zu Gebäuden, Einheiten, Mietern (Name, E-Mail, Ein- und Auszug, Vorauszahlungen) sowie Dokumente (Rechnungen, Bescheide, Mietverträge) ein. Diese Daten verarbeiten wir in Ihrem Auftrag zur Erstellung der Betriebskostenabrechnung (Art. 6 Abs. 1 lit. b DSGVO). Hochgeladene Dokumente werden auf dem oben genannten Server gespeichert.</p>
      <h2>6. Auslesen von Dokumenten durch KI</h2>
      <p>Zum Auslesen hochgeladener Dokumente (Betrag, Zeitraum, Kostenart, Vertragsklauseln) übermitteln wir den Dokumentinhalt an OpenRouter, Inc. (USA) und darüber an das jeweils konfigurierte Sprachmodell. Die Übermittlung erfolgt nur beim Hochladen und nur für das jeweilige Dokument; die Ergebnisse werden Ihnen zur Bestätigung angezeigt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO; die Übermittlung in die USA stützt sich auf die Standardvertragsklauseln der EU-Kommission. Sie können jede Angabe auch manuell erfassen, ohne dass ein Dokument übermittelt wird.</p>
      <h2>7. Versand von Abrechnungen</h2>
      <p>Abrechnungen werden per E-Mail über Brevo (Sendinblue GmbH, Berlin) an die von Ihnen hinterlegte Adresse des Mieters versendet. Brevo verarbeitet Empfängeradresse, Betreff und Anhang zum Zweck der Zustellung.</p>
      <h2>8. Mieterportal</h2>
      <p>Mieter erhalten Zugang zu ihrer eigenen Abrechnung und den dahinterliegenden Belegen ihres Gebäudes. Der Zugang erfolgt über einen einmaligen Registrierungscode und ein selbst gewähltes Passwort, das nur als Hash gespeichert wird.</p>
      <h2>9. Ihre Rechte</h2>
      <p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO) sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde. Wenden Sie sich dazu an die oben genannte Adresse.</p>
      <h2>10. Speicherdauer</h2>
      <p>Daten eines Vermieterkontos bleiben gespeichert, solange das Konto besteht; Abrechnungen und Belege unterliegen den handels- und steuerrechtlichen Aufbewahrungsfristen des Vermieters. Auf Wunsch löschen wir ein Konto vollständig.</p>
      <p className="text-xs">Stand: September 2026. Diese Erklärung wurde nach bestem Wissen erstellt und ist vor dem kommerziellen Start anwaltlich zu prüfen.</p>
    </Shell>
  );
}
