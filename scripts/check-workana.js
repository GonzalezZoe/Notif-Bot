// Revisa las búsquedas configuradas de Workana, detecta trabajos nuevos
// desde la última corrida y envía un email con los que no se hayan visto antes.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");

const STATE_PATH = path.join(__dirname, "..", "state", "seen.json");
const STATE_MAX_AGE_DAYS = 30;

// Cada búsqueda es una URL de listado de Workana. Se puede agregar más
// (otras skills, categorías, idiomas) agregando entradas acá.
const SEARCHES = [
  {
    label: "Shopify",
    url: "https://www.workana.com/jobs?skills=shopify",
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { firstRun: true, seen: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return { firstRun: false, seen: raw.seen || {} };
  } catch {
    return { firstRun: true, seen: {} };
  }
}

function saveState(seen) {
  const cutoff = Date.now() - STATE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pruned = {};
  for (const [slug, seenAt] of Object.entries(seen)) {
    if (seenAt >= cutoff) pruned[slug] = seenAt;
  }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ seen: pruned }, null, 2) + "\n");
}

async function scrapeSearch(page, search) {
  await page.goto(search.url, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Cierra el banner de cookies si aparece, no debería bloquear el DOM pero
  // por las dudas lo saca de encima para futuras corridas con headless: false.
  try {
    await page.locator("text=Aceptar todas las cookies").first().click({ timeout: 3000 });
  } catch {
    // no pasa nada si no aparece
  }

  await page.waitForSelector(".project-item", { timeout: 20000 });

  const jobs = await page.$$eval(".project-item", (nodes) =>
    nodes
      .map((node) => {
        const linkEl = node.querySelector('a[href^="/job/"]');
        if (!linkEl) return null;
        const href = linkEl.getAttribute("href");
        const slug = href.replace(/^\/job\//, "").split("?")[0];
        const title = (linkEl.textContent || "").trim();
        const published =
          node.querySelector(".project-main-details .date")?.textContent.trim() ||
          node.querySelector(".date")?.textContent.trim() ||
          "";
        const bids =
          node.querySelector(".project-main-details .bids")?.textContent.trim() || "";
        const description =
          node.querySelector(".text-expander-content")?.textContent.trim() || "";
        const skills = Array.from(node.querySelectorAll(".skills .skill")).map((s) =>
          s.textContent.trim()
        );
        const budget =
          node.querySelector(".budget .values > span")?.textContent.trim() ||
          node.querySelector(".budget")?.textContent.trim() ||
          "";
        const country =
          node.querySelector(".project-author .country .country-name")?.textContent.trim() || "";

        return { slug, title, url: `https://www.workana.com/job/${slug}`, published, bids, description, skills, budget, country };
      })
      .filter(Boolean)
  );

  return jobs;
}

function renderEmailHtml(newJobs) {
  const rows = newJobs
    .map(
      (job) => `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #e5e5e5;">
          <a href="${job.url}" style="font-size:16px;font-weight:600;color:#0b5cff;text-decoration:none;">${escapeHtml(job.title)}</a>
          <div style="margin:4px 0;color:#666;font-size:13px;">
            ${escapeHtml(job.published)}${job.bids ? " · " + escapeHtml(job.bids) : ""}${job.budget ? " · " + escapeHtml(job.budget) : ""}${job.country ? " · " + escapeHtml(job.country) : ""}
          </div>
          <div style="margin:8px 0;color:#333;font-size:14px;">${escapeHtml(job.description).slice(0, 300)}${job.description.length > 300 ? "…" : ""}</div>
          ${job.skills.length ? `<div style="margin-top:6px;">${job.skills.map((s) => `<span style="display:inline-block;background:#eef2ff;color:#3730a3;font-size:11px;padding:2px 8px;border-radius:10px;margin:2px 4px 0 0;">${escapeHtml(s)}</span>`).join("")}</div>` : ""}
        </td>
      </tr>`
    )
    .join("");

  return `<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;">
    <h2 style="color:#111;">${newJobs.length} trabajo${newJobs.length === 1 ? "" : "s"} nuevo${newJobs.length === 1 ? "" : "s"} de Shopify en Workana</h2>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:20px;">Workana Shopify Bot</p>
  </body></html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendEmail(newJobs) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, TO_EMAIL } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !TO_EMAIL) {
    throw new Error(
      "Faltan variables de entorno GMAIL_USER, GMAIL_APP_PASSWORD o TO_EMAIL."
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const subject =
    newJobs.length === 1
      ? `Nuevo trabajo Shopify en Workana: ${newJobs[0].title}`
      : `${newJobs.length} trabajos nuevos de Shopify en Workana`;

  await transporter.sendMail({
    from: `Workana Shopify Bot <${GMAIL_USER}>`,
    to: TO_EMAIL,
    subject,
    html: renderEmailHtml(newJobs),
  });
}

async function main() {
  const { firstRun, seen } = loadState();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    locale: "es-AR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const allJobs = [];
  const bySlug = new Map();

  try {
    for (const search of SEARCHES) {
      const jobs = await scrapeSearch(page, search);
      for (const job of jobs) {
        if (!bySlug.has(job.slug)) {
          bySlug.set(job.slug, job);
          allJobs.push(job);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (allJobs.length === 0) {
    throw new Error(
      "No se encontró ningún trabajo en la página de Workana. Es probable que el sitio haya cambiado su estructura o esté bloqueando el bot."
    );
  }

  const newJobs = allJobs.filter((job) => !(job.slug in seen));

  if (firstRun) {
    console.log(`Primera corrida: se guardan ${allJobs.length} trabajos existentes sin notificar.`);
  } else if (newJobs.length > 0) {
    console.log(`Encontrados ${newJobs.length} trabajos nuevos. Enviando email...`);
    await sendEmail(newJobs);
    console.log("Email enviado.");
  } else {
    console.log("Sin trabajos nuevos.");
  }

  const now = Date.now();
  for (const job of allJobs) {
    seen[job.slug] = seen[job.slug] || now;
  }
  saveState(seen);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
