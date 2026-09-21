import PDFDocument from "pdfkit";
import type { TenantStatement } from "./allocation.js";
import type { Property } from "./db.js";

export const eur = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const KEY_LABEL: Record<string, string> = {
  area: "nach Wohnfläche (m²)", persons: "nach Personen", units: "je Einheit",
  heating: "nach Heizverbrauch (kWh)", water: "nach Wasserverbrauch (m³)",
};

export function statementPdf(property: Property, s: TenantStatement, portalUrl: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text(`Betriebskostenabrechnung ${s.year}`);
    doc.moveDown(0.3).fontSize(10).fillColor("#555")
      .text(`${property.name} · ${property.address} · Einheit ${s.unit.label}`)
      .text(`Mieter: ${s.tenant.name}`)
      .text(`Abrechnungszeitraum: 01.01.${s.year} – 31.12.${s.year}`)
      .fillColor("#000").moveDown();

    doc.fontSize(11).text("Kostenaufstellung", { underline: true }).moveDown(0.4);
    const colX = [50, 250, 380, 470];
    const hy = doc.y;
    doc.fontSize(9).fillColor("#555");
    doc.text("Kostenart / Anbieter", colX[0], hy, { width: 195 });
    doc.text("Verteilung", colX[1], hy, { width: 125 });
    doc.text("Gesamt", colX[2], hy, { width: 85, align: "right" });
    doc.text("Ihr Anteil", colX[3], hy, { width: 80, align: "right" });
    doc.fillColor("#000").moveDown(0.5);
    for (const l of s.lines) {
      const y = doc.y;
      doc.fontSize(9).text(`${l.description ?? l.category} — ${l.provider}`, colX[0], y, { width: 195 });
      doc.text(`${KEY_LABEL[l.allocation_key]} ${l.basis_unit}/${l.basis_total}`, colX[1], y, { width: 125 });
      doc.text(eur(l.total_cents), colX[2], y, { width: 85, align: "right" });
      doc.text(eur(l.share_cents), colX[3], y, { width: 80, align: "right" });
      doc.moveDown(0.2).fontSize(7).fillColor("#777").text(`Rechnung: ${l.formula}`, colX[0], doc.y, { width: 500 }).fillColor("#000");
      doc.moveDown(0.5);
    }
    doc.moveDown().fontSize(11);
    doc.text(`Summe Ihrer Betriebskosten: ${eur(s.total_cents)}`, 50);
    doc.text(`Geleistete Vorauszahlungen (${s.months_occupied} × ${eur(s.tenant.monthly_prepayment_cents)}): ${eur(s.prepaid_cents)}`);
    doc.moveDown(0.3).fontSize(13)
      .text(s.balance_cents > 0 ? `Nachzahlung: ${eur(s.balance_cents)}` : `Guthaben: ${eur(-s.balance_cents)}`);
    doc.moveDown().fontSize(9).fillColor("#555")
      .text(`Jede Position können Sie mit Originalbeleg im Mieterportal nachvollziehen: ${portalUrl}`)
      .text("Berechnet nach § 556 BGB / BetrKV: Verteilung nach dem angegebenen Schlüssel, Leerstandsanteile verbleiben beim Eigentümer, Rundung auf Cent nach dem Größte-Reste-Verfahren. Einwendungen innerhalb von 12 Monaten nach Zugang.");
    doc.end();
  });
}
