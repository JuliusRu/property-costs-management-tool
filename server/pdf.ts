import PDFDocument from "pdfkit";
import type { TenantStatement } from "./allocation.js";
import type { Property } from "./db.js";

export const eur = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const de = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const qty = (n: number) => (n ? n.toLocaleString("de-DE", { minimumFractionDigits: n % 1 ? 3 : 0, maximumFractionDigits: 3 }) : "");

const CAT_DE: Record<string, string> = {
  property_tax: "Grundsteuer", water_sewage: "Wasser/Abwasser", rainwater: "Niederschlagswasser", heating: "Heizung", hot_water: "Warmwasser",
  elevator: "Aufzug", street_cleaning: "Straßenreinigung", waste: "Müllabfuhr", cleaning: "Gebäudereinigung", pest_control: "Ungezieferbekämpfung",
  garden: "Gartenpflege", lighting: "Allgemeinstrom", chimney: "Schornsteinfeger", insurance: "Versicherung", caretaker: "Hausmeister",
  cable: "Kabel/Antenne", laundry: "Wäschepflege", other: "Sonstige Betriebskosten",
};

/** Statement PDF in the layout German tenants know: account · distribution · quantities (total / yours) · costs (total / yours). */
export function statementPdf(property: Property, s: TenantStatement, portalUrl: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Betriebskostenabrechnung ${s.year} ${s.tenant.name}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const L = 50, R = 545, W = R - L;
    const periodStart = s.tenant.move_in && s.tenant.move_in > `${s.year}-01-01` ? s.tenant.move_in : `${s.year}-01-01`;
    const periodEnd = s.tenant.move_out && s.tenant.move_out < `${s.year}-12-31` ? s.tenant.move_out : `${s.year}-12-31`;

    // ---- header ----
    const head = property.address.startsWith(property.name) ? property.address : `${property.name}, ${property.address}`;
    doc.font("Helvetica-Bold").fontSize(12).text(`${head} / 01.01.${s.year} - 31.12.${s.year} - Einzelabrechnung`, L, 50, { width: W });
    doc.font("Helvetica").fontSize(9).fillColor("#333")
      .text(`${s.unit.label}`, L, 72, { width: W, align: "right" })
      .text(`Nutzungszeitraum: ${de(periodStart)} - ${de(periodEnd)}`, L, 84, { width: W, align: "right" })
      .fillColor("#000");
    doc.fontSize(10).text(`Mieter: ${s.tenant.name}`, L, 84);

    // ---- 1. table ----
    let y = 115;
    doc.font("Helvetica-Bold").fontSize(11).text("1. Einzelabrechnungsrelevante Ausgaben", L, y); y += 20;
    const cols = { konto: L, vert: 175, mgG: 300, mgA: 360, ausG: 425, ausA: 490 };
    const wG = 55, wA = 50;
    doc.fontSize(8.5).font("Helvetica-Bold");
    doc.text("Konto", cols.konto, y).text("Verteilung", cols.vert, y);
    doc.text("Abrechnungsmengen", cols.mgG, y - 10, { width: 110, align: "center" }).text("Gesamt", cols.mgG, y, { width: wG, align: "right" }).text("Ihr Anteil", cols.mgA, y, { width: wA, align: "right" });
    doc.text("Ausgaben", cols.ausG, y - 10, { width: 115, align: "center" }).text("Gesamt", cols.ausG, y, { width: wG, align: "right" }).text("Ihr Anteil", cols.ausA, y, { width: wA + 5, align: "right" });
    y += 12; doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).stroke(); y += 6;
    doc.font("Helvetica-Bold").text("1) Betriebskosten (auf Mieter umlegbar nach BetrKV)", L, y); y += 14;
    doc.font("Helvetica");
    const rowH = 13;
    for (const l of s.lines) {
      if (y > 720) { doc.addPage(); y = 60; }
      const konto = (l.description && l.description.length <= 34 ? l.description : CAT_DE[l.category] ?? l.category).replace(/ \d{4}$/, "");
      doc.text(konto, cols.konto, y, { width: 120, height: rowH, ellipsis: true });
      doc.text(l.distribution, cols.vert, y, { width: 120, height: rowH, ellipsis: true });
      doc.text(qty(l.basis_total), cols.mgG, y, { width: wG, align: "right" });
      doc.text(qty(l.basis_unit), cols.mgA, y, { width: wA, align: "right" });
      doc.text(eur(l.total_cents).replace(" €", ""), cols.ausG, y, { width: wG, align: "right" });
      doc.text(eur(l.share_cents).replace(" €", ""), cols.ausA, y, { width: wA + 5, align: "right" });
      y += rowH;
    }
    y += 4; doc.moveTo(cols.mgG, y).lineTo(R, y).stroke(); y += 6;
    const buildingTotal = s.lines.reduce((a, l) => a + l.total_cents, 0);
    doc.font("Helvetica-Bold").text("Zwischensumme:", cols.mgG, y, { width: 120, align: "right" })
      .text(eur(buildingTotal).replace(" €", ""), cols.ausG, y, { width: wG, align: "right" })
      .text(eur(s.total_cents).replace(" €", ""), cols.ausA, y, { width: wA + 5, align: "right" });
    y += 30;

    // ---- 2. prepayments ----
    if (y > 620) { doc.addPage(); y = 60; }
    doc.font("Helvetica-Bold").fontSize(11).text(`Betriebskostenvorauszahlung für ${s.year}:`, L, y); y += 18;
    doc.font("Helvetica").fontSize(10);
    if (s.prepaid_from_payments) {
      for (const p of s.payments) { doc.text(`${de(p.paid_on)}${p.note ? " " + p.note : ""}`, L, y).text(eur(p.amount_cents), 300, y, { width: 100, align: "right" }); y += 13; }
    } else {
      doc.text(`Monatlich ${eur(s.tenant.monthly_prepayment_cents)}`, L, y); y += 13;
      doc.text(`${s.months_occupied} x ${eur(s.tenant.monthly_prepayment_cents)}`, L, y); y += 13;
    }
    doc.font("Helvetica-Bold").text("Summe:", L, y).text(eur(s.prepaid_cents), 300, y, { width: 100, align: "right" }); y += 28;

    // ---- 3. result ----
    doc.font("Helvetica-Bold").fontSize(11).text(`Betriebskostenabrechnung für den Zeitraum vom ${de(periodStart)} bis ${de(periodEnd)}:`, L, y); y += 18;
    doc.font("Helvetica").fontSize(10);
    const byCat = new Map<string, number>();
    for (const l of s.lines) byCat.set(l.category, (byCat.get(l.category) ?? 0) + l.share_cents);
    for (const [cat, cents] of byCat) { doc.text(CAT_DE[cat] ?? cat, L, y).text(eur(cents), 300, y, { width: 100, align: "right" }); y += 13; }
    doc.font("Helvetica-Bold").text("Gesamtsumme:", L, y).text(eur(s.total_cents), 300, y, { width: 100, align: "right" }); y += 22;
    doc.font("Helvetica").text("Betriebskosten abzüglich geleisteter Vorauszahlungen:", L, y).text(eur(s.balance_cents), 300, y, { width: 100, align: "right" }); y += 20;
    const due = s.balance_cents > 0;
    doc.font("Helvetica-Bold").fontSize(11).text(due ? "Hieraus ergibt sich eine Nachzahlung in Höhe von:" : "Hieraus ergibt sich ein Guthaben in Höhe von:", L, y, { underline: true })
      .text(eur(Math.abs(s.balance_cents)), 300, y, { width: 100, align: "right", underline: true }); y += 24;
    doc.font("Helvetica").fontSize(10);
    const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    doc.text(due ? `Bitte überweisen Sie den Betrag bis spätestens ${de(deadline)}.` : `Das Guthaben wird Ihnen innerhalb von 30 Tagen überwiesen.`, L, y); y += 22;
    if (s.suggested_prepayment_cents > 0 && Math.abs(s.suggested_prepayment_cents - s.tenant.monthly_prepayment_cents) >= 500) {
      const up = s.suggested_prepayment_cents > s.tenant.monthly_prepayment_cents;
      doc.font("Helvetica-Bold").text(`Aufgrund der ${up ? "gestiegenen" : "gesunkenen"} Kosten ${up ? "erhöht" : "verringert"} sich die Betriebskostenvorauszahlung ab dem 01.01.${s.year + 1} auf ${eur(s.suggested_prepayment_cents)} (§ 560 Abs. 4 BGB). Wir bitten Sie, die monatliche Zahlung anzupassen.`, L, y, { width: W }); y += 34;
    }
    doc.font("Helvetica").fontSize(8.5).fillColor("#555")
      .text(`Jede Position können Sie mit Originalbeleg im Mieterportal nachvollziehen: ${portalUrl}`, L, y, { width: W }).moveDown(0.3)
      .text(s.tenant.registered_at ? `Anmeldung mit Ihrer E-Mail ${s.tenant.email} und Ihrem Passwort.` : `Einmalige Registrierung mit E-Mail ${s.tenant.email} und Registrierungscode ${s.tenant.access_code}; danach Anmeldung mit Passwort.`, { width: W }).moveDown(0.3)
      .text("Berechnet nach § 556 BGB / BetrKV: Verteilung nach dem angegebenen Schlüssel, Leerstandsanteile verbleiben beim Eigentümer, Rundung auf Cent nach dem Größte-Reste-Verfahren. Einwendungen innerhalb von 12 Monaten nach Zugang.", { width: W });
    doc.end();
  });
}
