// Generates realistic-looking German provider invoices as PDFs into samples/.
// These are what the simulated "inbox sync" pulls in during the demo.
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

mkdirSync("samples", { recursive: true });

type Sample = { file: string; provider: string; address: string; title: string; customer: string; period: string; lines: [string, string][]; total: string; note?: string };

const samples: Sample[] = [
  {
    file: "stawag-wasser-2025.pdf", provider: "STAWAG Stadtwerke Aachen AG", address: "Lombardenstraße 12–22, 52070 Aachen",
    title: "Jahresabrechnung Trinkwasser und Abwasser", customer: "Kundennummer 4471 2035 · Verbrauchsstelle Lindenstraße 12, 52062 Aachen",
    period: "Abrechnungszeitraum: 01.01.2025 – 31.12.2025",
    lines: [["Trinkwasser 143 m³ × 1,98 €/m³", "283,14 €"], ["Grundpreis Wasserzähler 12 Monate", "96,00 €"], ["Schmutzwasser 143 m³ × 2,41 €/m³", "344,63 €"], ["Niederschlagswasser 210 m² × 0,92 €/m²", "193,20 €"], ["Umsatzsteuer 7 % auf Trinkwasser", "26,54 €"]],
    total: "943,51 €",
  },
  {
    file: "ewv-erdgas-heizung-2025.pdf", provider: "EWV Energie- und Wasser-Versorgung GmbH", address: "Willy-Brandt-Platz 2, 52222 Stolberg",
    title: "Jahresrechnung Erdgas – Zentralheizung", customer: "Vertragskonto 90 331 178 · Lindenstraße 12, 52062 Aachen (Heizungsanlage)",
    period: "Lieferzeitraum: 01.01.2025 – 31.12.2025",
    lines: [["Arbeitspreis 14.300 kWh × 11,84 ct/kWh", "1.693,12 €"], ["Grundpreis 12 Monate × 14,90 €", "178,80 €"], ["darin enthaltene CO₂-Kosten (2,874 t CO₂ × 55,00 €/t) — Angabe nach CO2KostAufG", "158,07 €"], ["Umsatzsteuer 19 % auf 1.871,92 €", "355,66 €"]],
    total: "2.227,58 €",
    note: "Emissionsfaktor Erdgas 0,201 kg CO₂/kWh. Die Aufteilung der CO₂-Kosten zwischen Vermieter und Mieter richtet sich nach dem CO2KostAufG.",
  },
  {
    file: "awa-abfall-2025.pdf", provider: "AWA Entsorgung GmbH", address: "Zum Hagelkreuz 24, 52249 Eschweiler",
    title: "Gebührenbescheid Abfallentsorgung 2025", customer: "Objekt-Nr. 2025-0871 · Lindenstraße 12, 52062 Aachen",
    period: "Gebührenzeitraum: 01.01.2025 – 31.12.2025",
    lines: [["Restmüll 240 l, 14-täglich", "412,80 €"], ["Bioabfall 120 l, 14-täglich", "118,40 €"], ["Papier 240 l, 4-wöchentlich", "0,00 €"], ["Sperrmüllpauschale", "24,00 €"]],
    total: "555,20 €",
  },
  {
    file: "hausmeister-service-2025.pdf", provider: "Hausmeisterservice Krings", address: "Trierer Straße 88, 52078 Aachen",
    title: "Rechnung Nr. 2025-1187", customer: "Objekt: Lindenstraße 12, 52062 Aachen",
    period: "Leistungszeitraum: 01.01.2025 – 31.12.2025",
    lines: [["Hausmeistertätigkeiten (Reinigung Treppenhaus, Winterdienst, Kontrollgänge) 12 Monate", "1.440,00 €"], ["Reparatur Haustürschließer (Material + Arbeit)", "186,50 €"], ["Umsatzsteuer 19 %", "309,04 €"]],
    total: "1.935,54 €",
    note: "Hinweis: Reparaturen sind keine umlagefähigen Betriebskosten.",
  },
];

for (const s of samples) {
  const doc = new PDFDocument({ size: "A4", margin: 60 });
  doc.pipe(createWriteStream(`samples/${s.file}`));
  doc.fontSize(16).text(s.provider).fontSize(9).fillColor("#555").text(s.address).fillColor("#000").moveDown(2);
  doc.fontSize(10).text("Herrn").text("Julius Rummel").text("Lindenstraße 12").text("52062 Aachen").moveDown(2);
  doc.fontSize(14).text(s.title).moveDown(0.5).fontSize(10).text(s.customer).text(s.period).text("Rechnungsdatum: 15.02.2026").moveDown(1.5);
  for (const [label, amount] of s.lines) {
    const y = doc.y;
    doc.text(label, 60, y, { width: 360 });
    doc.text(amount, 440, y, { width: 100, align: "right" });
    doc.moveDown(0.4);
  }
  doc.moveDown(0.5).moveTo(60, doc.y).lineTo(540, doc.y).stroke().moveDown(0.5);
  const y = doc.y;
  doc.fontSize(12).text("Rechnungsbetrag gesamt", 60, y).text(s.total, 440, y, { width: 100, align: "right" });
  doc.moveDown(2).fontSize(9).fillColor("#555");
  if (s.note) doc.text(s.note);
  doc.text("Der Betrag wird am 01.03.2026 von Ihrem Konto eingezogen. Diese Rechnung wurde maschinell erstellt.");
  doc.end();
  console.log("wrote samples/" + s.file);
}
