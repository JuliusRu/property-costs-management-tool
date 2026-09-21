export async function sendMail(opts: { to: { email: string; name: string }; subject: string; html: string; attachment?: { name: string; content: Buffer } }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is not set");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM_EMAIL ?? "noreply@example.com", name: process.env.MAIL_FROM_NAME ?? "Nebenkosten" },
      to: [opts.to],
      subject: opts.subject,
      htmlContent: opts.html,
      attachment: opts.attachment ? [{ name: opts.attachment.name, content: opts.attachment.content.toString("base64") }] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
  return (await res.json()) as { messageId: string };
}
